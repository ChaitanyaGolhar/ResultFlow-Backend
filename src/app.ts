import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

export const app: Express = express();

// Security Middlewares
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

import routes from './routes';

// Static File Serving
// For local MVP, we serve templates and thumbnails statically
app.use('/storage', express.static(process.env.STORAGE_LOCAL_PATH || './storage'));

// API Routes
app.use('/api/v1', routes);

// Health Check
app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'ok', // TODO: Implement actual checks
      redis: 'ok',
      storage: 'ok'
    },
    version: '1.0.0'
  });
});

// Basic Error Handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: []
    }
  });
});
