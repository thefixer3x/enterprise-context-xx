/**
 * Structured Logger for Enterprise MCP
 * Based on standalone-mcp-submodule/src/utils/logger.ts
 */

import winston from 'winston';
import { config } from '../config/environment.js';

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  config.LOG_FORMAT === 'json'
    ? winston.format.json()
    : winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level.toUpperCase()}]: ${message} ${stack || ''} ${metaStr}`;
      })
);

// Create logger instance
export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: logFormat,
  defaultMeta: {
    service: 'enterprise-mcp',
    version: '1.0.0'
  },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true
    })
  ]
});

// Add file transport for production
if (config.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }));

  logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }));
}

// Helper functions for structured logging
export const logRequest = (
  method: string,
  url: string,
  status: number,
  duration: number,
  requestId?: string
) => {
  logger.info('HTTP Request', {
    method,
    url,
    status,
    duration: `${duration}ms`,
    requestId
  });
};

export const logError = (error: Error, context?: Record<string, unknown>) => {
  logger.error('Application Error', {
    message: error.message,
    stack: error.stack,
    name: error.name,
    ...context
  });
};

export const logApiCall = (
  operation: string,
  endpoint: string,
  duration: number,
  success: boolean,
  metadata?: Record<string, unknown>
) => {
  logger.info('API Call', {
    operation,
    endpoint,
    duration: `${duration}ms`,
    success,
    ...metadata
  });
};

export const logRetry = (
  attempt: number,
  maxRetries: number,
  endpoint: string,
  reason: string
) => {
  logger.warn('Request Retry', {
    attempt,
    maxRetries,
    endpoint,
    reason
  });
};
