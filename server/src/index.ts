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

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

/**
 * Returns a normalized message for unhandled server errors.
 *
 * @param error Unknown thrown value from middleware/route stack.
 * @returns Safe string message for API error responses.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected server error.';
}

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use('/scores', scoresRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: getErrorMessage(error) });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${PORT}`);
});
