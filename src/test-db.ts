import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url || url.includes('USER:PASSWORD')) {
    console.error('\n❌ DATABASE_URL is missing or still has placeholders.');
    console.error('   Open .env and paste your External URL from Render → side-quest-db → Connect\n');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  try {
    const result = await pool.query('SELECT version()');
    console.log('\n✅ Database connected!\n');
    console.log(result.rows[0].version);
    console.log('');
  } catch (err) {
    console.error('\n❌ Connection failed:\n', err instanceof Error ? err.message : err);
    console.error('\nCheck: External URL in .env, password rotated on Render if exposed.\n');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
