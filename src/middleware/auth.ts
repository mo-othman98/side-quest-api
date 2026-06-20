import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? '';

export interface AuthPayload {
  userId: string;
  email: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!JWT_SECRET) {
    res.status(503).json({ error: 'Auth is not configured' });
    return;
  }

  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function signAccessToken(payload: AuthPayload): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  if (!JWT_SECRET) {
    next();
    return;
  }

  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }

  try {
    req.auth = jwt.verify(header.slice(7), JWT_SECRET) as AuthPayload;
  } catch {
    // Ignore invalid tokens for optional auth routes.
  }

  next();
}
