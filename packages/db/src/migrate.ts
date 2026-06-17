import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '..', '.env') });

const url = process.env.DATABASE_URL ?? "";
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const migrationsFolder = join(__dirname, '..', 'migrations');

console.log(`Connecting to ${url}`);
console.log(`Running migrations from ${migrationsFolder}`);

await migrate(db, { migrationsFolder });

console.log('Migrations applied successfully');
await client.end();
