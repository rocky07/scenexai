// Quick connection check for the RDS PostgreSQL database, using a username and password.
// Run: PGHOST=... PGUSER=postgres PGPASSWORD=... node --env-file=.env check-db.js
import fs from 'node:fs';
import pg from 'pg';

const { PGHOST, PGPORT = '5432', PGDATABASE = 'postgres', PGUSER, PGPASSWORD, PGSSLROOTCERT } = process.env;

if (!PGHOST || !PGUSER || !PGPASSWORD) {
  console.error('Set PGHOST, PGUSER and PGPASSWORD (in server/.env or your shell).');
  process.exit(1);
}

// Verify the server certificate when the RDS CA bundle is provided (recommended).
// Without it, the connection is encrypted but the server identity is not checked.
const ssl = PGSSLROOTCERT
  ? { ca: fs.readFileSync(PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true }
  : { rejectUnauthorized: false };

const client = new pg.Client({
  host: PGHOST,
  port: Number(PGPORT),
  database: PGDATABASE,
  user: PGUSER,
  password: PGPASSWORD,
  ssl,
  connectionTimeoutMillis: 10_000,
});

try {
  await client.connect();
  const { rows } = await client.query('SELECT version()');
  console.log('Connected:', rows[0].version);
} catch (err) {
  console.error('Database error:', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
