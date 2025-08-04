import type { VercelRequest, VercelResponse } from '@vercel/node';
import { app } from '../src/server.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Ensure proper Content-Type for JSON responses
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }
  
  // Handle the request with Express app
  return app(req, res);
}