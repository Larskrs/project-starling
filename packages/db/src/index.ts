import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

console.log('Connecting to database...');
console.log(process.env.DATABASE_URL);
const client = postgres(process.env.DATABASE_URL ?? 'postgres://starling:starling@localhost:5432/starling');
console.log(client.name)

export const db = drizzle(client, { schema });
export * from './schema.js';
