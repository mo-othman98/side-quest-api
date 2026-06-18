import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes('USER:PASSWORD')) {
    console.error('Set DATABASE_URL in .env first');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, '../migrations/001_initial.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  try {
    await pool.query(sql);
    console.log('✅ Migration complete');
  } catch (err) {
    console.error('❌ Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
