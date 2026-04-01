import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../lib/firebase-admin';

export async function verifyToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    return;
  }

  const token = authorizationHeader.split('Bearer ')[1]?.trim();

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
