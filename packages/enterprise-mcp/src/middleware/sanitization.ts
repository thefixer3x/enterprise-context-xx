/**
 * Input Sanitization Middleware
 * Protects against XSS, SQL injection, and other input-based attacks
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Sanitize a string to prevent XSS attacks
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return input;

  return input
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Escape HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    // Remove null bytes
    .replace(/\0/g, '')
    .trim();
}

/**
 * Sanitize content but preserve formatting (for memory content)
 */
export function sanitizeContent(input: string): string {
  if (typeof input !== 'string') return input;

  return input
    // Remove script tags only
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove on* event handlers
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    // Remove javascript: urls
    .replace(/javascript:/gi, '')
    // Remove null bytes
    .replace(/\0/g, '')
    .trim();
}

/**
 * Validate API key format
 */
export function validateApiKeyFormat(apiKey: string): boolean {
  // Expected formats: lano_xxx, lms_live_xxx, lms_test_xxx
  const validPatterns = [
    /^lano_[a-zA-Z0-9_-]{8,}$/,
    /^lms_live_[a-zA-Z0-9]{32,}$/,
    /^lms_test_[a-zA-Z0-9]{32,}$/,
  ];

  return validPatterns.some(pattern => pattern.test(apiKey));
}

/**
 * Recursively sanitize all string values in an object
 */
export function sanitizeObject<T>(obj: T, preserveContent = false): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return (preserveContent ? sanitizeContent(obj) : sanitizeString(obj)) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, preserveContent)) as T;
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Preserve content fields that need formatting
      const isContentField = ['content', 'description', 'text', 'body'].includes(key);
      sanitized[key] = sanitizeObject(value, preserveContent || isContentField);
    }
    return sanitized as T;
  }

  return obj;
}

/**
 * Express middleware to sanitize request body
 */
export const sanitizationMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (req.body && typeof req.body === 'object') {
    const originalBody = JSON.stringify(req.body);
    req.body = sanitizeObject(req.body);
    const sanitizedBody = JSON.stringify(req.body);

    if (originalBody !== sanitizedBody) {
      logger.debug('Request body sanitized', {
        requestId: req.requestId,
        path: req.path,
      });
    }
  }

  next();
};

/**
 * Validate common malicious patterns
 */
export function detectMaliciousPatterns(input: string): {
  isMalicious: boolean;
  patterns: string[];
} {
  const patterns: string[] = [];

  // SQL injection patterns
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b.*\b(FROM|INTO|SET|TABLE)\b)/i,
    /(--)|(\/\*.*\*\/)/,
    /(\bOR\b.*=.*\bOR\b)/i,
    /('.*--)/,
  ];

  // Command injection patterns
  const cmdPatterns = [
    /(;|\||`|\$\()/,
    /(\b(rm|wget|curl|bash|sh|chmod)\b.*-)/i,
  ];

  // Path traversal patterns
  const pathPatterns = [
    /(\.\.\/)|(\.\.\\)/,
  ];

  for (const pattern of sqlPatterns) {
    if (pattern.test(input)) {
      patterns.push('sql_injection');
      break;
    }
  }

  for (const pattern of cmdPatterns) {
    if (pattern.test(input)) {
      patterns.push('command_injection');
      break;
    }
  }

  for (const pattern of pathPatterns) {
    if (pattern.test(input)) {
      patterns.push('path_traversal');
      break;
    }
  }

  return {
    isMalicious: patterns.length > 0,
    patterns,
  };
}

/**
 * Middleware to detect and block malicious inputs
 */
export const maliciousInputDetection = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.body && typeof req.body === 'object') {
    const bodyString = JSON.stringify(req.body);
    const detection = detectMaliciousPatterns(bodyString);

    if (detection.isMalicious) {
      logger.warn('Malicious input detected', {
        requestId: req.requestId,
        path: req.path,
        patterns: detection.patterns,
        ip: req.ip,
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Request contains invalid or potentially malicious content',
          requestId: req.requestId,
        },
      });
      return;
    }
  }

  next();
};
