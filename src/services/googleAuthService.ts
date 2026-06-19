import { OAuth2Client } from 'google-auth-library';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  if (!client) {
    client = new OAuth2Client(GOOGLE_CLIENT_ID);
  }
  return client;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
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

export function isGoogleAuthConfigured(): boolean {
  return !!GOOGLE_CLIENT_ID;
}
