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

  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Running ${file}...`);
      await pool.query(sql);
    }
    console.log('✅ All migrations complete');
  } catch (err) {
    console.error('❌ Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
