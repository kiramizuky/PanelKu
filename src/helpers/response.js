import { HTTP } from '../config/constants.js';

/**
 * Standardized API response helpers.
 */
export const success = (res, data = {}, message = 'Success', statusCode = HTTP.OK) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
};

export const created = (res, data = {}, message = 'Created successfully') => {
  return success(res, data, message, HTTP.CREATED);
};

export const error = (res, message = 'An error occurred', statusCode = HTTP.SERVER_ERROR, errors = null) => {
  // Support swapped argument order (e.g. error(res, 500, 'Error text') or error(res, 500, new Error('...')))
  if (typeof message === 'number' && (typeof statusCode === 'string' || statusCode instanceof Error || typeof statusCode === 'object')) {
    const temp = message;
    message = statusCode;
    statusCode = temp;
  }

  let msgText = 'An error occurred';
  if (message instanceof Error) {
    msgText = message.message || 'An error occurred';
  } else if (typeof message === 'string') {
    msgText = message;
  } else if (message && typeof message === 'object') {
    msgText = message.message || JSON.stringify(message);
  } else if (message !== undefined && message !== null) {
    msgText = String(message);
  }

  const finalStatus = (typeof statusCode === 'number' && statusCode >= 100 && statusCode <= 599)
    ? statusCode
    : HTTP.SERVER_ERROR;

  const payload = {
    success: false,
    message: msgText,
    timestamp: new Date().toISOString(),
  };
  if (errors) payload.errors = errors;
  return res.status(finalStatus).json(payload);
};

export const badRequest = (res, message = 'Bad request', errors = null) => {
  return error(res, message, HTTP.BAD_REQUEST, errors);
};

export const unauthorized = (res, message = 'Unauthorized') => {
  return error(res, message, HTTP.UNAUTHORIZED);
};

export const forbidden = (res, message = 'Forbidden') => {
  return error(res, message, HTTP.FORBIDDEN);
};

export const notFound = (res, message = 'Not found') => {
  return error(res, message, HTTP.NOT_FOUND);
};

export const conflict = (res, message = 'Conflict') => {
  return error(res, message, HTTP.CONFLICT);
};

export const paginated = (res, { data, total, page, limit }) => {
  return res.status(HTTP.OK).json({
    success: true,
    data,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / limit),
    },
    timestamp: new Date().toISOString(),
  });
};

export const successResponse = success;
export const errorResponse = error;
