const PROFANITY = [
  'asshole',
  'bastard',
  'bitch',
  'bollocks',
  'bullshit',
  'cock',
  'cunt',
  'damn',
  'dick',
  'faggot',
  'fuck',
  'motherfucker',
  'nigga',
  'nigger',
  'piss',
  'pussy',
  'retard',
  'shit',
  'slut',
  'twat',
  'whore',
];

export type UsernameValidationResult =
  | { ok: true; username: string }
  | { ok: false; error: string };

export function validateUsername(raw: string): UsernameValidationResult {
  const username = raw.trim();

  if (username.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters' };
  }

  if (username.length > 24) {
    return { ok: false, error: 'Username must be at most 24 characters' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { ok: false, error: 'Use only letters, numbers, and underscores' };
  }

  if (/^\d+$/.test(username)) {
    return { ok: false, error: 'Username cannot be only numbers' };
  }

  const normalized = username.toLowerCase();
  for (const word of PROFANITY) {
    if (normalized.includes(word)) {
      return { ok: false, error: 'Please choose a different username' };
    }
  }

  return { ok: true, username };
}
