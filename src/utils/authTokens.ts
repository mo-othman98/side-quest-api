import crypto from 'crypto';

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function verificationExpiry(hours = 24): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
