import { OAuth2Client } from 'google-auth-library';

function getAllowedAudiences(): string[] {
  const ids = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
  ].filter((id): id is string => !!id?.trim());

  return [...new Set(ids.map((id) => id.trim()))];
}

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  const audiences = getAllowedAudiences();
  if (audiences.length === 0) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  if (!client) {
    client = new OAuth2Client(audiences[0]);
  }
  return client;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export function getGoogleAuthStatus() {
  return {
    web: !!process.env.GOOGLE_CLIENT_ID,
    ios: !!process.env.GOOGLE_IOS_CLIENT_ID,
    android: !!process.env.GOOGLE_ANDROID_CLIENT_ID,
  };
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const audiences = getAllowedAudiences();
  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: audiences.length === 1 ? audiences[0] : audiences,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Invalid Google token');
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() || payload.email.split('@')[0],
    emailVerified: payload.email_verified === true,
  };
}

export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Invalid Google access token');
  }

  const data = (await response.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    email_verified?: boolean;
  };

  if (!data.sub || !data.email) {
    throw new Error('Google profile missing email');
  }

  return {
    googleId: data.sub,
    email: data.email.toLowerCase(),
    name: data.name?.trim() || data.email.split('@')[0],
    emailVerified: data.email_verified === true,
  };
}

export function isGoogleAuthConfigured(): boolean {
  return getAllowedAudiences().length > 0;
}

export function googleAuthErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/audience|recipient/i.test(message)) {
    return 'Server rejected the Google token. On Render, add GOOGLE_IOS_CLIENT_ID to match your iOS OAuth client.';
  }

  if (/google_id|password_hash|null value in column/i.test(message)) {
    return 'Database needs updating. Run migrations on the production database.';
  }

  if (/invalid google token|invalid google access token/i.test(message)) {
    return 'Google session expired or invalid. Please try again.';
  }

  return 'Google sign-in failed';
}
