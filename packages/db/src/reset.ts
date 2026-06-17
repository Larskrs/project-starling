import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '..', '.env') });

const url = process.env.DATABASE_URL ?? '';
const sql = postgres(url, { max: 1 });

console.log('Dropping all tables and types...');

await sql`DROP SCHEMA public CASCADE`;
await sql`CREATE SCHEMA public`;
await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;

console.log('Done — run db:migrate to rebuild');
await sql.end();
