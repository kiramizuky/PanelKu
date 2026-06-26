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
  const payload = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };
  if (errors) payload.errors = errors;
  return res.status(statusCode).json(payload);
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
