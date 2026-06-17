import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env.DATABASE_URL ?? 'postgres://starling:starling@localhost:5432/starling';
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

console.log(`Connecting to ${url}`);
console.log(`Running migrations from ${migrationsFolder}`);

await migrate(db, { migrationsFolder });

console.log('Migrations applied successfully');
await client.end();
