import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import {
  users, companies, productions,
  companyMembers, productionMembers, productionRoles,
} from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '..', '.env') });

const scrypt = promisify(_scrypt);
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key  = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

const client = postgres(process.env.DATABASE_URL ?? '', { max: 1 });
const db = drizzle(client);

console.log('Seeding...');

async function upsertUser() {
  const [inserted] = await db.insert(users).values({
    email:           'larskrs@smage.org',
    name:            'Lars Kristian',
    first_name:      'Lars',
    last_name:       'Kristian',
    hashedPassword:  await hashPassword('password'),
    isEmailVerified: true,
    role:            'admin',
  }).onConflictDoNothing().returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(users).where(eq(users.email, 'larskrs@smage.org'));
  return existing!;
}

async function upsertCompany() {
  const [inserted] = await db.insert(companies).values({
    name: 'NRK',
    slug: 'nrk',
  }).onConflictDoNothing().returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(companies).where(eq(companies.slug, 'nrk'));
  return existing!;
}

const user    = await upsertUser();
console.log(`  User: ${user.email}`);

const company = await upsertCompany();
console.log(`  Company: ${company.name}`);

await db.insert(companyMembers).values({
  companyId: company.id,
  userId:    user.id,
  role:      'owner',
}).onConflictDoNothing();

const [production] = await db.insert(productions).values({
  companyId: company.id,
  name:      'Melodi Grand Prix',
  slug:      'melodi-grand-prix',
}).onConflictDoNothing().returning();

if (production) {
  console.log(`  Production: ${production.name}`);

  const allPermissions = (1n << 6n) - 1n;

  const [adminRole] = await db.insert(productionRoles).values({
    productionId: production.id,
    name:         'Administrator',
    hue:          250,
    permissions:  allPermissions,
  }).returning();

  await db.insert(productionMembers).values({
    productionId: production.id,
    userId:       user.id,
    roleId:       adminRole!.id,
  }).onConflictDoNothing();
}

console.log('Seed complete — password: password');
await client.end();
