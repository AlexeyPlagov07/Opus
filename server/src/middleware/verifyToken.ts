/**
 * Authentication middleware for protected API routes.
 *
 * Validates Firebase ID tokens from Authorization headers and enriches the
 * request context with the authenticated user identity.
 */
import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../lib/firebase-admin';

/**
 * Extracts a bearer token from an Authorization header.
 *
 * @param authorizationHeader Raw Authorization header value.
 * @returns Parsed token string, or null when header is missing/invalid.
 */
function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies Firebase ID token and populates req.user.
 *
 * @param req Express request.
 * @param res Express response.
 * @param next Express next callback.
 * @returns Promise that resolves after auth succeeds or response is sent.
 */
export async function verifyToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    return;
  }

  const token = extractBearerToken(authorizationHeader);

  if (!token) {
    res.status(401).json({ error: 'Missing Firebase ID token.' });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized.' });
  }
}
