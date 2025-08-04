import { app } from './server.js';
import { config } from '@/config/environment';

// Export the Express app for Vercel
export default app;

// Only start the server if not in a serverless environment
if (!process.env.VERCEL) {
  const port = process.env.PORT || config.PORT || 3000;
  app.listen(port, () => {
    console.log(`Enterprise Context Service running on port ${port}`);
  });
}