import winston from 'winston';
import path from 'path';
import appConfig from './app.js';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  if (Object.keys(meta).length) log += ` | ${JSON.stringify(meta)}`;
  return log;
});

const logger = winston.createLogger({
  level: appConfig.logs.level,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
    }),
    new winston.transports.File({
      filename: path.join(appConfig.logs.path, 'error.log'),
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(appConfig.logs.path, 'combined.log'),
      maxsize: 10485760,
      maxFiles: 10,
    }),
  ],
});

export default logger;
