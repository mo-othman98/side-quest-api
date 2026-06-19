import pg from 'pg';

export function sanitizeUsername(raw: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (base.length >= 3) return base.slice(0, 24);
  return `adventurer_${Math.floor(Math.random() * 9000 + 1000)}`;
}

export async function uniqueUsername(
  pool: pg.Pool,
  preferred: string
): Promise<string> {
  let candidate = sanitizeUsername(preferred);
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`,
      [candidate]
    );
    if (existing.rows.length === 0) return candidate;
    candidate = `${sanitizeUsername(preferred).slice(0, 18)}_${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  return `user_${Date.now()}`;
}
