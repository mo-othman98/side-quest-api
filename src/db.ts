import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new pg.Pool({
      connectionString,
      ssl: connectionString.includes('localhost')
        ? undefined
        : { rejectUnauthorized: false },
    })
  : null;
