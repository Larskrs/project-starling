import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });

const client = postgres(process.env.DATABASE_URL ?? 'postgres://starling:starling@localhost:5432/starling');

export const db = drizzle(client, { schema });
export * from './schema.js';