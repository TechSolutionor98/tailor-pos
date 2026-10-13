import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config';
import { connectDb } from './db';
import { authRouter } from './routes/auth';
import { userRouter } from './routes/users';
import { ledgerRouter } from './routes/ledgers';
import { productRouter } from './routes/products';
import { jobCardRouter } from './routes/jobcards';
import { saleRouter } from './routes/sales';
import { dashboardRouter } from './routes/dashboard';
import { auditRouter } from './routes/audit';
import { measurementRouter } from './routes/measurements';
import { settingsRouter } from './routes/settings';
import { errorHandler, notFound } from './middleware';
import { asyncHandler } from './middleware';

/**
 * The Express app on its own, with no `listen`.
 *
 * `index.ts` starts it as a normal server for local development; on Vercel the
 * same app is handed to a serverless function, which cannot bind a port.
 */
export const app = express();

app.set('trust proxy', 1);

// Same-origin in production (the site proxies /api to this app), so CORS only
// matters when the API is called from somewhere else. Set CORS_ORIGIN to a
// comma-separated list to allow specific sites.
const allowed = (config.corsOrigin ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors(
    allowed.length > 0
      ? { origin: allowed, credentials: false }
      : {}, // no list configured: allow any origin (tokens still required)
  ),
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));
app.use(express.json({ limit: '2mb' }));

// Health check must not need the database, so it can report the API is up
// even when Mongo is unreachable.
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Everything below needs Mongo. The connection is cached, so this is a no-op
// on a warm container and a single connect on a cold one.
app.use(
  '/api',
  asyncHandler(async (_req, _res, next) => {
    await connectDb();
    next();
  }),
);

app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/ledgers', ledgerRouter);
app.use('/api/products', productRouter);
app.use('/api/jobcards', jobCardRouter);
app.use('/api/measurements', measurementRouter);
app.use('/api/sales', saleRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/audit', auditRouter);
app.use('/api/settings', settingsRouter);

app.use('/api', notFound);
app.use(errorHandler);

export default app;
