/**
 * Regression guard for email verification.
 *
 *     tsx apps/api/src/lib/email/verification.test.ts
 *
 * (Standalone, same convention as the other tests here. Needs a database, and
 * SKIPS cleanly without one — see invites.test.ts for why.)
 */
import { eq } from 'drizzle-orm';
import { db, emailVerifications, users } from '@starling/db';

const mod = await import(process.argv[2] ?? './verification.ts') as typeof import('./verification.js');
const { issueVerification, verifyEmailToken, VERIFICATION_TTL_HOURS } = mod;

let failed = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function assert(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}
function eqv(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}

try {
  await db.execute('select 1');
} catch {
  console.log('emailVerification: SKIPPED — no database reachable (docker compose up -d postgres)');
  process.exit(0);
}

const stamp = Date.now();
const made: string[] = [];

async function makeUser(tag: string) {
  const email = `${tag}.${stamp}@example.com`;
  made.push(email);
  const [row] = await db.insert(users).values({
    email, name: `${tag} Tester`, first_name: tag, last_name: 'Tester', hashedPassword: 'x',
  }).returning();
  return row!;
}

console.log('emailVerification');

try {
  await check('a fresh token verifies the address and marks the account', async () => {
    const user  = await makeUser('verify');
    const token = await issueVerification(user);

    const result = await verifyEmailToken(token);
    assert(result.ok, 'expected the token to verify');
    if (!result.ok) return;
    eqv(result.email, user.email, 'verified address');
    eqv(result.alreadyVerified, false, 'first verification');

    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    eqv(row!.isEmailVerified, true, 'the account flag');
  });

  await check('the link works exactly once', async () => {
    const user  = await makeUser('once');
    const token = await issueVerification(user);
    await verifyEmailToken(token);

    const second = await verifyEmailToken(token);
    assert(!second.ok, 'a used link must not work again');
    if (!second.ok) eqv(second.reason, 'notFound', 'rejection reason');
  });

  await check('the plaintext token is never stored', async () => {
    const user  = await makeUser('hash');
    const token = await issueVerification(user);

    const [row] = await db.select().from(emailVerifications)
      .where(eq(emailVerifications.userId, user.id)).limit(1);
    assert(!JSON.stringify(row).includes(token), 'the token is recoverable from the row');
    eqv(row!.tokenHash.length, 64, 'expected a sha-256 hex digest');
  });

  await check('re-sending kills the previous link', async () => {
    const user  = await makeUser('resend');
    const first = await issueVerification(user);
    const second = await issueVerification(user);

    const stale = await verifyEmailToken(first);
    assert(!stale.ok, 'the superseded link must stop working');

    const fresh = await verifyEmailToken(second);
    assert(fresh.ok, 'the newest link should work');
  });

  await check('an expired link is refused', async () => {
    const user  = await makeUser('expired');
    const token = await issueVerification(user);
    await db.update(emailVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailVerifications.userId, user.id));

    const result = await verifyEmailToken(token);
    assert(!result.ok, 'expected a rejection');
    if (!result.ok) eqv(result.reason, 'expired', 'rejection reason');

    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    eqv(row!.isEmailVerified, false, 'an expired link must not verify anything');
  });

  await check('a link stops applying once the address changes', async () => {
    const user  = await makeUser('moved');
    const token = await issueVerification(user);

    await db.update(users).set({ email: `moved-new.${stamp}@example.com` }).where(eq(users.id, user.id));
    made.push(`moved-new.${stamp}@example.com`);

    const result = await verifyEmailToken(token);
    assert(!result.ok, 'expected a rejection');
    if (!result.ok) eqv(result.reason, 'emailChanged', 'rejection reason');

    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    eqv(row!.isEmailVerified, false, 'the new address must not inherit the old proof');
  });

  await check('an unknown token is simply not found', async () => {
    const result = await verifyEmailToken('not-a-real-token');
    assert(!result.ok, 'expected a rejection');
    if (!result.ok) eqv(result.reason, 'notFound', 'rejection reason');
  });

  await check('the window is the advertised 24 hours', async () => {
    const user = await makeUser('ttl');
    await issueVerification(user);

    const [row] = await db.select().from(emailVerifications)
      .where(eq(emailVerifications.userId, user.id)).limit(1);
    const hours = (row!.expiresAt.getTime() - Date.now()) / 3_600_000;
    assert(Math.abs(hours - VERIFICATION_TTL_HOURS) < 0.1, `expected ~${VERIFICATION_TTL_HOURS}h, got ${hours.toFixed(2)}`);
  });
} finally {
  for (const email of made) await db.delete(users).where(eq(users.email, email));
}

console.log(failed === 0 ? '\nall ok' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
