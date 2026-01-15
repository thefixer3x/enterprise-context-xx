/**
 * Request ID Middleware
 * Generates unique request IDs for distributed tracing
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Middleware to add request ID to each request
 * - Uses X-Request-Id header if provided by client
 * - Otherwise generates a new UUID
 * - Sets response header for client correlation
 */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Use existing request ID from header or generate new one
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();

  // Attach to request object
  req.requestId = requestId;

  // Set response header for client correlation
  res.setHeader('X-Request-Id', requestId);

  next();
};
