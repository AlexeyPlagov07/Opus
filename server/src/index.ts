/**
 * Express API entrypoint.
 *
 * Bootstraps middleware, mounts feature routes, and installs fallback/error
 * handlers for the Opus backend service.
 */
import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import scoresRouter from './routes/scores';

export const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const ALLOW_VERCEL_PREVIEW_ORIGINS = process.env.ALLOW_VERCEL_PREVIEW_ORIGINS !== 'false';

/**
 * Returns a normalized message for unhandled server errors.
 *
 * @param error Unknown thrown value from middleware/route stack.
 * @returns Safe string message for API error responses.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected server error.';
}

/**
 * Validates whether a request origin is allowed by CORS policy.
 *
 * @param requestOrigin Origin header value from incoming request.
 * @returns True when origin is explicitly configured or allowed preview domain.
 */
function isAllowedOrigin(requestOrigin: string | undefined): boolean {
  if (!requestOrigin) {
    return true;
  }

  if (CLIENT_ORIGINS.includes(requestOrigin)) {
    return true;
  }

  if (ALLOW_VERCEL_PREVIEW_ORIGINS && /\.vercel\.app$/i.test(requestOrigin)) {
    return true;
  }

  return false;
}

app.use(
  cors({
    origin: (requestOrigin, callback) => {
      if (isAllowedOrigin(requestOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS origin not allowed.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Range'],
    exposedHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Content-Type'],
    credentials: true,
  })
);
app.use(express.json());

app.get(['/', '/api'], (_req, res) => {
  res.status(200).json({ ok: true, service: 'opus-backend' });
});

app.get(['/health', '/api/health'], (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use('/scores', scoresRouter);
app.use('/api/scores', scoresRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: getErrorMessage(error) });
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${PORT}`);
  });
}
