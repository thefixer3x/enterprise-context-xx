/**
 * Error Handler Middleware for Enterprise MCP
 * Based on standalone-mcp-submodule/src/middleware/errorHandler.ts
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  code?: string;
  retryable?: boolean;
}

export class ValidationError extends Error {
  statusCode = 400;
  isOperational = true;
  code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  statusCode = 401;
  isOperational = true;
  code = 'AUTHENTICATION_ERROR';

  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends Error {
  statusCode = 429;
  isOperational = true;
  code = 'RATE_LIMITED';
  retryAfter: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter: number = 60) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class TimeoutError extends Error {
  statusCode = 504;
  isOperational = true;
  code = 'TIMEOUT';
  retryable = true;

  constructor(message: string = 'Request timeout') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ServiceUnavailableError extends Error {
  statusCode = 503;
  isOperational = true;
  code = 'SERVICE_UNAVAILABLE';
  retryable = true;

  constructor(message: string = 'Service temporarily unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * Normalize any error to a consistent format
 */
export function normalizeError(error: unknown, requestId?: string): {
  success: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    retryable?: boolean;
    details?: unknown;
  };
} {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        requestId,
        retryable: false,
        details: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }))
      }
    };
  }

  if (error instanceof Error) {
    const appError = error as AppError;
    return {
      success: false,
      error: {
        code: appError.code || 'INTERNAL_ERROR',
        message: appError.message,
        requestId,
        retryable: appError.retryable ?? false
      }
    };
  }

  return {
    success: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'An unexpected error occurred',
      requestId,
      retryable: false
    }
  };
}

/**
 * Express error handler middleware
 */
export const errorHandler = (
  error: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal server error';
  let details: unknown = undefined;

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    details = error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
      code: err.code
    }));
  }

  // Log error
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel]('Request Error', {
    statusCode,
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    requestId: (req as any).requestId
  });

  // Send error response
  const response: Record<string, unknown> = {
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message,
      requestId: (req as any).requestId,
      retryable: error.retryable ?? false
    }
  };

  if (details) {
    (response.error as any).details = details;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development' && error.stack) {
    (response.error as any).stack = error.stack;
  }

  res.status(statusCode).json(response);
};

/**
 * Async error handler wrapper
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
