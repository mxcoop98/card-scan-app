import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Uses DATABASE_URL from env. Locally this is your own Postgres;
// on Railway it's injected as ${{Postgres.DATABASE_URL}}.
// Railway's public Postgres URL needs SSL; the internal one doesn't.
// We enable SSL automatically when the host isn't localhost.
const connectionString = process.env.DATABASE_URL || '';
const isLocal = /localhost|127\.0\.0\.1|\.railway\.internal/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

export const query = (text, params) => pool.query(text, params);
