const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();

/* =========================================================
   CONFIGURATION
========================================================= */

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const FRONTEND_URL = process.env.FRONTEND_URL?.trim();

const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);

const isMongoConfigured = () => {
  const uri = process.env.MONGODB_URI;

  return (
    typeof uri === 'string' &&
    uri.trim() !== '' &&
    !uri.includes('<') &&
    !uri.includes('>')
  );
};

/* =========================================================
   APP INITIALIZATION
========================================================= */

app.set('trust proxy', 1);

/* =========================================================
   SECURITY / MIDDLEWARE
========================================================= */

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests such as:
      // Postman
      // curl
      // server-to-server requests
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`CORS blocked origin: ${origin}`);

      return callback(
        new Error(`CORS policy: Origin ${origin} is not allowed`)
      );
    },

    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],

    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization'
    ],

    credentials: true,

    optionsSuccessStatus: 204
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

/* =========================================================
   MONGODB CONNECTION
========================================================= */

const connectDB = async () => {
  if (!isMongoConfigured()) {
    console.warn(
      'WARNING: MONGODB_URI is not configured.'
    );

    console.warn(
      'The API will start, but database operations will return HTTP 503.'
    );

    return false;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    });

    console.log(
      'SUCCESS: MongoDB Atlas Connected Successfully'
    );

    console.log(
      `MongoDB Host: ${mongoose.connection.host}`
    );

    console.log(
      `MongoDB Database: ${mongoose.connection.name}`
    );

    return true;
  } catch (error) {
    console.error(
      'ERROR: MongoDB Connection Failed'
    );

    console.error(error.message);

    return false;
  }
};

/* =========================================================
   MONGODB EVENTS
========================================================= */

mongoose.connection.on('connected', () => {
  console.log('MongoDB connection established');
});

mongoose.connection.on('error', (error) => {
  console.error(
    'MongoDB connection error:',
    error.message
  );
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
});

/* =========================================================
   DATABASE CHECK
========================================================= */

const ensureDatabase = (res) => {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      success: false,
      error: 'Database is unavailable',
      message:
        'MongoDB Atlas is not connected. Check MONGODB_URI and MongoDB Atlas network access.'
    });

    return false;
  }

  return true;
};

/* =========================================================
   USER MODEL
========================================================= */

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must contain at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters']
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: [150, 'Email cannot exceed 150 characters'],
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address'
      ]
    },

    role: {
      type: String,
      enum: ['user', 'admin', 'teacher', 'student', 'staff'],
      default: 'user'
    },

    createdAt: {
      type: Date,
      default: Date.now
    },

    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    versionKey: false
  }
);

/*
  Automatically update updatedAt
*/
userSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

userSchema.pre(
  ['findOneAndUpdate', 'findByIdAndUpdate'],
  function (next) {
    this.set({ updatedAt: new Date() });
    next();
  }
);

const User = mongoose.model('User', userSchema);

/* =========================================================
   ROOT ROUTE
========================================================= */

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'MERN Backend API is running',
    environment: NODE_ENV,
    version: '1.0.0'
  });
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get('/api/health', (req, res) => {
  const databaseConnected =
    mongoose.connection.readyState === 1;

  res.status(databaseConnected ? 200 : 503).json({
    success: databaseConnected,

    status: databaseConnected
      ? 'OK'
      : 'DEGRADED',

    message: databaseConnected
      ? 'Backend API and database are running'
      : 'Backend API is running but database is unavailable',

    timestamp: new Date().toISOString(),

    environment: NODE_ENV,

    server: {
      port: PORT,
      uptime: process.uptime()
    },

    database: {
      status: databaseConnected
        ? 'connected'
        : 'disconnected',

      name: databaseConnected
        ? mongoose.connection.name
        : null
    }
  });
});

/* =========================================================
   GET ALL USERS
========================================================= */

app.get('/api/users', async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) return;

    const users = await User.find()
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   CREATE USER
========================================================= */

app.post('/api/users', async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) return;

    const { name, email, role } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
      });
    }

    const existingUser = await User.findOne({
      email: email.toLowerCase().trim()
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'A user with this email already exists'
      });
    }

    const user = await User.create({
      name,
      email,
      role
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: user
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   GET USER BY ID
========================================================= */

app.get('/api/users/:id', async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) return;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   UPDATE USER
========================================================= */

app.put('/api/users/:id', async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) return;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const { name, email, role } = req.body;

    const updateData = {};

    if (name !== undefined) {
      updateData.name = name;
    }

    if (email !== undefined) {
      updateData.email = email.toLowerCase().trim();
    }

    if (role !== undefined) {
      updateData.role = role;
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true
      }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   DELETE USER
========================================================= */

app.delete('/api/users/:id', async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) return;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const user = await User.findByIdAndDelete(
      req.params.id
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
      data: user
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   404 HANDLER
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {
  console.error('API ERROR:', error);

  /*
    CORS error
  */
  if (error.message?.startsWith('CORS policy')) {
    return res.status(403).json({
      success: false,
      error: 'CORS error',
      message: error.message
    });
  }

  /*
    MongoDB duplicate key error
  */
  if (error.code === 11000) {
    const duplicateField =
      Object.keys(error.keyPattern || {})[0] || 'field';

    return res.status(409).json({
      success: false,
      error: `Duplicate value for ${duplicateField}`
    });
  }

  /*
    Mongoose validation error
  */
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(
      (err) => err.message
    );

    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors
    });
  }

  /*
    Invalid MongoDB ObjectId
  */
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'Invalid resource ID'
    });
  }

  /*
    Default error
  */
  res.status(500).json({
    success: false,
    error:
      NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message
  });
});

/* =========================================================
   START SERVER
========================================================= */

const startServer = async () => {
  await connectDB();

  const server = app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log('');
      console.log('==========================================');
      console.log('       MERN BACKEND API STARTED');
      console.log('==========================================');
      console.log(`Environment : ${NODE_ENV}`);
      console.log(`Port        : ${PORT}`);
      console.log(`Health      : /api/health`);
      console.log(`Users       : /api/users`);
      console.log('==========================================');
      console.log('');
    }
  );

  /* =======================================================
     GRACEFUL SHUTDOWN
  ======================================================= */

  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down...`);

    server.close(async () => {
      console.log('HTTP server closed');

      try {
        await mongoose.connection.close();

        console.log('MongoDB connection closed');
        console.log('Application shutdown complete');

        process.exit(0);
      } catch (error) {
        console.error(
          'Error while closing MongoDB:',
          error.message
        );

        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

/* =========================================================
   START APPLICATION
========================================================= */

startServer().catch((error) => {
  console.error(
    'FATAL ERROR: Unable to start application'
  );

  console.error(error);

  process.exit(1);
});