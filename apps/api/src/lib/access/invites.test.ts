/**
 * Regression guard for the invite rules.
 *
 *     tsx apps/api/src/lib/access/invites.test.ts
 *
 * (Standalone, same convention as the other tests here — the repo has no test
 * runner. Exits non-zero on failure.)
 *
 * Unlike docs/email, this one needs a database: what is worth testing is
 * exactly the part that lives in SQL — one-time use, expiry, revocation, and
 * the conditional UPDATE that stops a capped link being over-redeemed. It
 * creates its own company and deletes it again, so it is safe against a dev
 * database. With no database reachable it SKIPS rather than fails, so
 * `npm test` still passes on a fresh checkout.
 */
import { eq } from 'drizzle-orm';
import { db, companies, productions, productionRoles, productionMembers, productionInvites, users } from '@starling/db';

const invites = await import(process.argv[2] ?? './invites.ts') as typeof import('./invites.js');
const {
  issueInvite, lookupInvite, acceptInvite, listInvites, revokeInvite, redeemForAuth,
} = invites;

// ── Harness ───────────────────────────────────────────────────────────────────

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
  console.log('invites: SKIPPED — no database reachable (docker compose up -d postgres)');
  process.exit(0);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const stamp = Date.now();
const [company] = await db.insert(companies).values({ name: 'Invite Test Co', slug: `invite-test-${stamp}` }).returning();
const [production] = await db.insert(productions).values({
  companyId: company!.id, name: 'Dancing with the stars', slug: `dancing-${stamp}`,
}).returning();
const [role] = await db.insert(productionRoles).values({
  productionId: production!.id, name: 'Crew', hue: 200,
}).returning();

async function makeUser(tag: string) {
  const [row] = await db.insert(users).values({
    email: `${tag}.${stamp}@example.com`, name: `${tag} Tester`,
    first_name: tag, last_name: 'Tester', hashedPassword: 'x',
  }).returning();
  return row!;
}

const inviter = await makeUser('lars');
const guest   = await makeUser('guest');
const other   = await makeUser('other');

console.log('invites');

try {
  // ── Link invites ────────────────────────────────────────────────────────────

  await check('a link invite resolves to what it grants, without redeeming it', async () => {
    const { token } = await issueInvite({ productionId: production!.id, roleId: role!.id, createdBy: inviter.id });

    const found = await lookupInvite(token);
    assert(found.ok, 'expected the invite to resolve');
    if (!found.ok) return;

    eqv(found.preview.production.name, 'Dancing with the stars', 'production name');
    eqv(found.preview.company.name, 'Invite Test Co', 'company name');
    eqv(found.preview.inviterName, 'lars', 'inviter name');
    eqv(found.preview.roleName, 'Crew', 'role name');
    eqv(found.preview.email, null, 'a link invite is not bound to an address');
    eqv(found.invite.useCount, 0, 'looking does not redeem');
  });

  await check('the plaintext token is never stored', async () => {
    const { token, invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id });
    assert(!invite.tokenHash.includes(token), 'the token itself is in the row');
    eqv(invite.tokenHash.length, 64, 'expected a sha-256 hex digest');

    const [row] = await db.select().from(productionInvites).where(eq(productionInvites.id, invite.id)).limit(1);
    assert(!JSON.stringify(row).includes(token), 'the token is recoverable from the row');
  });

  await check('accepting joins the production with the invited role', async () => {
    const { token } = await issueInvite({ productionId: production!.id, roleId: role!.id, createdBy: inviter.id });

    const result = await acceptInvite(token, guest);
    assert(result.ok, 'expected acceptance');
    if (!result.ok) return;
    eqv(result.alreadyMember, false, 'first acceptance');

    const [member] = await db.select().from(productionMembers)
      .where(eq(productionMembers.userId, guest.id)).limit(1);
    assert(Boolean(member), 'no membership row was created');
    eqv(member!.roleId, role!.id, 'the invited role should be applied');
  });

  await check('re-opening a link after joining does not burn a use', async () => {
    const { token, invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id });
    await acceptInvite(token, other);
    const second = await acceptInvite(token, other);

    assert(second.ok, 'expected the second acceptance to succeed');
    if (!second.ok) return;
    eqv(second.alreadyMember, true, 'second acceptance');

    const [row] = await db.select().from(productionInvites).where(eq(productionInvites.id, invite.id)).limit(1);
    eqv(row!.useCount, 1, 'use count after re-opening');
  });

  await check('a spent invite is kept, but not left sitting in the pending list', async () => {
    const { token, invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id, maxUses: 1 });
    await acceptInvite(token, await makeUser('cap-a'));

    const [row] = await db.select().from(productionInvites).where(eq(productionInvites.id, invite.id)).limit(1);
    eqv(row?.useCount, 1, 'the spent row should survive with its use counted');

    const rows = await listInvites(production!.id);
    assert(!rows.some(r => r.id === invite.id), 'a spent invite should not be listed');
  });

  await check('whoever used a spent invite can still open it', async () => {
    const user = await makeUser('reopen');
    const { token } = await issueInvite({ productionId: production!.id, createdBy: inviter.id, maxUses: 1 });
    await acceptInvite(token, user);

    const anonymous = await lookupInvite(token);
    assert(!anonymous.ok, 'a spent invite is closed to a stranger');
    if (!anonymous.ok) eqv(anonymous.reason, 'exhausted', 'rejection reason');

    const asMember = await lookupInvite(token, user.id);
    assert(asMember.ok, 'the member should be shown the way in');
    if (asMember.ok) eqv(asMember.alreadyMember, true, 'alreadyMember');

    const again = await acceptInvite(token, user);
    assert(again.ok, 're-accepting should succeed');
    if (again.ok) eqv(again.alreadyMember, true, 'alreadyMember');
  });

  await check('a capped link stops at its limit', async () => {
    const { token } = await issueInvite({ productionId: production!.id, createdBy: inviter.id, maxUses: 1 });
    const first = await acceptInvite(token, await makeUser('cap-b'));
    assert(first.ok, 'the first use should succeed');

    const second = await acceptInvite(token, await makeUser('cap-c'));
    assert(!second.ok, 'the second use should be refused');
    if (!second.ok) eqv(second.reason, 'exhausted', 'rejection reason');
  });

  await check('a link with uses left survives being used once', async () => {
    const { token, invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id, maxUses: 3 });
    await acceptInvite(token, await makeUser('multi-a'));

    const [row] = await db.select().from(productionInvites).where(eq(productionInvites.id, invite.id)).limit(1);
    assert(Boolean(row), 'a multi-use link must not be deleted on first use');
    eqv(row!.useCount, 1, 'use count');

    const second = await acceptInvite(token, await makeUser('multi-b'));
    assert(second.ok, 'the second person should still get in');
  });

  await check('two simultaneous redemptions cannot both take the last seat', async () => {
    const { token, invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id, maxUses: 1 });
    const [a, b] = await Promise.all([
      acceptInvite(token, await makeUser('race-a')),
      acceptInvite(token, await makeUser('race-b')),
    ]);

    eqv([a!.ok, b!.ok].filter(Boolean).length, 1, 'exactly one should win');

    const [row] = await db.select().from(productionInvites).where(eq(productionInvites.id, invite.id)).limit(1);
    eqv(row?.useCount, 1, 'the last seat should be taken exactly once');
  });

  // ── Emailed invites ─────────────────────────────────────────────────────────

  await check('an emailed invite is single-use and expires in an hour', async () => {
    const { invite } = await issueInvite({
      productionId: production!.id, createdBy: inviter.id, email: 'Someone@Example.com',
    });

    eqv(invite.maxUses, 1, 'emailed invites are single-use');
    eqv(invite.email, 'someone@example.com', 'the address should be normalised');

    const hours = (invite.expiresAt.getTime() - Date.now()) / 3_600_000;
    assert(hours > 0.9 && hours <= 1.01, `expected ~1 hour, got ${hours.toFixed(2)}`);
  });

  await check('inviting the same address again replaces the pending invite', async () => {
    const { token: first }  = await issueInvite({ productionId: production!.id, createdBy: inviter.id, email: 'Twice@Example.com' });
    const { token: second, invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id, email: 'twice@example.com' });

    const old = await lookupInvite(first);
    assert(!old.ok, 'the earlier link should stop working');
    if (!old.ok) eqv(old.reason, 'revoked', 'rejection reason');
    assert((await lookupInvite(second)).ok, 'the newest link should work');

    const pending = (await listInvites(production!.id)).filter(r => r.email === 'twice@example.com');
    eqv(pending.length, 1, 'one pending row per address');
    eqv(pending[0]!.id, invite.id, 'the pending row is the newest');
  });

  await check('an accepted email invite leaves the pending list', async () => {
    const target = await makeUser('accepted');
    const { token, invite } = await issueInvite({
      productionId: production!.id, createdBy: inviter.id, email: target.email,
    });

    const result = await acceptInvite(token, target);
    assert(result.ok, 'expected acceptance');

    const rows = await listInvites(production!.id);
    assert(!rows.some(r => r.id === invite.id), 'an accepted invitation should not read as pending');
  });

  await check('a forwarded invite cannot be claimed by someone else', async () => {
    const target = await makeUser('bound');
    const { token } = await issueInvite({
      productionId: production!.id, createdBy: inviter.id, email: target.email,
    });

    const thief = await acceptInvite(token, await makeUser('thief'));
    assert(!thief.ok, 'a different address should be refused');
    if (!thief.ok) eqv(thief.reason, 'emailMismatch', 'rejection reason');

    const rightful = await acceptInvite(token, target);
    assert(rightful.ok, 'the addressee should be able to accept');

    const again = await acceptInvite(token, await makeUser('bound-second'));
    assert(!again.ok, 'a used single-use invite should be spent');
  });

  // ── Expiry and revocation ───────────────────────────────────────────────────

  await check('an expired invite is refused', async () => {
    const { token, invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id });
    await db.update(productionInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(productionInvites.id, invite.id));

    const found = await lookupInvite(token);
    assert(!found.ok, 'expected a rejection');
    if (!found.ok) eqv(found.reason, 'expired', 'rejection reason');

    const accepted = await acceptInvite(token, await makeUser('late'));
    assert(!accepted.ok, 'an expired invite must not be redeemable');
  });

  await check('a revoked invite stops working but keeps its row', async () => {
    const { token, invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id });

    eqv(await revokeInvite(production!.id, invite.id), true, 'revoke should report success');

    const found = await lookupInvite(token);
    assert(!found.ok, 'expected a rejection');
    if (!found.ok) eqv(found.reason, 'revoked', 'rejection reason');

    const [row] = await db.select().from(productionInvites).where(eq(productionInvites.id, invite.id)).limit(1);
    assert(Boolean(row?.revokedAt), 'the row should survive, marked revoked');
  });

  await check('an invite cannot be revoked through another production', async () => {
    const { invite } = await issueInvite({ productionId: production!.id, createdBy: inviter.id });
    const [otherProduction] = await db.insert(productions).values({
      companyId: company!.id, name: 'Other', slug: `other-${stamp}`,
    }).returning();

    eqv(await revokeInvite(otherProduction!.id, invite.id), false, 'cross-production revoke must fail');
  });

  await check('an unknown token is simply not found', async () => {
    const found = await lookupInvite('not-a-real-token');
    assert(!found.ok, 'expected a rejection');
    if (!found.ok) eqv(found.reason, 'notFound', 'rejection reason');
  });

  // ── Listing and the auth hand-off ───────────────────────────────────────────

  await check('the listing shows live invites only, and never a token', async () => {
    const { invite: revoked } = await issueInvite({ productionId: production!.id, createdBy: inviter.id });
    await revokeInvite(production!.id, revoked.id);
    const { invite: live } = await issueInvite({ productionId: production!.id, createdBy: inviter.id });

    const rows = await listInvites(production!.id);
    assert(rows.some(r => r.id === live.id), 'the live invite is missing');
    assert(!rows.some(r => r.id === revoked.id), 'a revoked invite should not be listed');
    assert(!JSON.stringify(rows).includes('tokenHash'), 'the listing must not expose hashes');
  });

  await check('register/login get a landing path back when an invite applies', async () => {
    const { token } = await issueInvite({ productionId: production!.id, createdBy: inviter.id });
    const outcome = await redeemForAuth(token, await makeUser('fresh'));

    eqv(outcome.accepted, true, 'acceptance');
    eqv(outcome.path, `/c/${company!.slug}/p/${production!.slug}/dashboard`, 'landing path');

    const stale = await redeemForAuth('nope', await makeUser('stale'));
    eqv(stale.accepted, false, 'a bad token should not throw');
    eqv(stale.reason, 'notFound', 'rejection reason');
  });
} finally {
  // Cascades through productions, invites, roles and memberships.
  await db.delete(companies).where(eq(companies.id, company!.id));
  for (const tag of [
    'lars', 'guest', 'other', 'reopen', 'cap-a', 'cap-b', 'cap-c', 'multi-a', 'multi-b',
    'race-a', 'race-b', 'accepted', 'bound', 'bound-second', 'thief', 'late', 'fresh', 'stale',
  ]) {
    await db.delete(users).where(eq(users.email, `${tag}.${stamp}@example.com`));
  }
}

console.log(failed === 0 ? '\nall ok' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
