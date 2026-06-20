import { GoogleProfile, verifyGoogleAccessToken, verifyGoogleIdToken } from '../services/googleAuthService';

export async function resolveGoogleProfile(
  idToken?: string,
  accessToken?: string
): Promise<GoogleProfile> {
  const errors: string[] = [];

  // iOS / Expo Go: access token + userinfo is more reliable than id_token audience checks
  if (accessToken?.trim()) {
    try {
      return await verifyGoogleAccessToken(accessToken.trim());
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'access token verification failed');
    }
  }

  if (idToken?.trim()) {
    try {
      return await verifyGoogleIdToken(idToken.trim());
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'id token verification failed');
    }
  }

  throw new Error(errors.join(' | ') || 'No Google credentials provided');
}

export function googleAuthErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/audience|recipient/i.test(message)) {
    return 'Server rejected the Google token. Check GOOGLE_IOS_CLIENT_ID on Render.';
  }

  if (/google_id|password_hash|null value in column|does not exist/i.test(message)) {
    return 'Database needs updating. Run: npm run migrate (with production DATABASE_URL).';
  }

  if (/duplicate key|unique constraint/i.test(message)) {
    return 'An account with this email already exists. Try email/password login.';
  }

  if (/invalid google token|invalid google access token|google profile missing email/i.test(message)) {
    return 'Google did not share a valid profile. Try again or use email sign-up.';
  }

  if (/JWT_SECRET/i.test(message)) {
    return 'Server auth is misconfigured (JWT_SECRET).';
  }

  if (message && message.length < 220) {
    return message;
  }

  return 'Google sign-in failed';
}
