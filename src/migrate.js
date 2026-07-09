// Runs schema.sql against the database. Safe to run repeatedly
// because every statement uses IF NOT EXISTS. Called on API boot
// so Railway needs no manual psql step.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const sql = await readFile(join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration applied (schema up to date).');
}
