import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, or } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';
import { users, userRoleEnum } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '..', '.env') });

// ── Parse argv: -u <id|email>  -r <role> ─────────────────────────────────────

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const identifier = arg('-u');
const role        = arg('-r') as typeof userRoleEnum.enumValues[number] | undefined;

if (!identifier || !role) {
  console.error('Usage: npm run set-role -- -u <userId|email> -r <admin|user>');
  process.exit(1);
}

const validRoles = userRoleEnum.enumValues;
if (!validRoles.includes(role)) {
  console.error(`Invalid role "${role}". Valid values: ${validRoles.join(', ')}`);
  process.exit(1);
}

// ── Connect ───────────────────────────────────────────────────────────────────

const url    = process.env.DATABASE_URL ?? '';
const client = postgres(url, { max: 1 });
const db     = drizzle(client);

// ── Look up user by UUID or email ─────────────────────────────────────────────

const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

const [user] = await db
  .select({ id: users.id, email: users.email, role: users.role })
  .from(users)
  .where(isUuid ? eq(users.id, identifier) : eq(users.email, identifier))
  .limit(1);

if (!user) {
  console.error(`No user found for "${identifier}"`);
  await client.end();
  process.exit(1);
}

if (user.role === role) {
  console.log(`User ${user.email} already has role "${role}" — nothing to do.`);
  await client.end();
  process.exit(0);
}

await db.update(users).set({ role }).where(eq(users.id, user.id));

console.log(`✓ ${user.email} (${user.id}): ${user.role} → ${role}`);
await client.end();
