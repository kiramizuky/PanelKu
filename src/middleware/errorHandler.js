import logger from '../config/logger.js';
import { HTTP } from '../config/constants.js';

/**
 * Global error handler middleware.
 * Must be registered LAST in Express middleware chain.
 */
export const errorHandler = (err, req, res, next) => {
  // Log error
  logger.error(`${err.name}: ${err.message}`, {
    path: req.path,
    method: req.method,
    user: req.user?.username,
    stack: err.stack,
  });

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(HTTP.UNPROCESSABLE).json({
      success: false,
      message: 'Validation error',
      errors,
    });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(HTTP.CONFLICT).json({
      success: false,
      message: `Duplicate value for: ${field}`,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(HTTP.UNAUTHORIZED).json({
      success: false,
      message: 'Invalid token',
    });
  }

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(HTTP.BAD_REQUEST).json({
      success: false,
      message: 'File too large',
    });
  }

  // Custom app error
  const statusCode = err.statusCode || HTTP.SERVER_ERROR;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * 404 handler — register before errorHandler.
 */
export const notFoundHandler = (req, res) => {
  res.status(HTTP.NOT_FOUND).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  });
};

/**
 * Custom error class with HTTP status.
 */
export class AppError extends Error {
  constructor(message, statusCode = HTTP.SERVER_ERROR) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}
