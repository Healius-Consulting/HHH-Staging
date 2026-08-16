import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { portalAppOrigins } from './config.js';
import { HttpError } from '../domain/common/errors.js';
import { createAuthRouter } from '../transport/public/auth.router.js';
import { createDirectoryRouter } from '../transport/public/directory.router.js';
import { createPortalSetupRouter } from '../transport/portal/setup.router.js';
import { createPublicEligibilityRouter } from '../transport/public/eligibility.router.js';
import { createPortalEligibilityRouter } from '../transport/portal/eligibility.router.js';
import { createPortalPrescriptionRouter } from '../transport/portal/prescription.router.js';
import { createPortalOrderRouter } from '../transport/portal/order.router.js';
import { createPublicPaymentRouter } from '../transport/public/payment.router.js';
import { createPortalPaymentRouter } from '../transport/portal/payment.router.js';
import { createPortalFulfilmentRouter } from '../transport/portal/fulfilment.router.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || portalAppOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new HttpError(403, 'CORS origin denied.', 'CORS_DENIED'));
      }
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Mount v1 routers
  app.use('/v1', createAuthRouter());
  app.use('/v1', createDirectoryRouter());
  app.use('/v1', createPortalSetupRouter());
  app.use('/v1', createPublicEligibilityRouter());
  app.use('/v1', createPortalEligibilityRouter());
  app.use('/v1', createPortalPrescriptionRouter());
  app.use('/v1', createPortalOrderRouter());
  app.use('/v1', createPublicPaymentRouter());
  app.use('/v1', createPortalPaymentRouter());
  app.use('/v1', createPortalFulfilmentRouter());

  // Health check endpoint (storage neutral)
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', runtime: 'sql-connect', timestamp: new Date().toISOString() });
  });

  // Global error handler (prevents information leakage)
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId || (req.headers['x-request-id'] as string) || 'unknown';

    if (error instanceof HttpError) {
      res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
      });
      return;
    }

    // Generic fallback for unhandled exceptions
    console.error('Unhandled server error:', { error, requestId });
    res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    });
  });

  return app;
}
