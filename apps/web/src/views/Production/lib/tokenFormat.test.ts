/**
 * Regression guard for the Integrations page formatting.
 *
 *     node apps/web/src/views/Production/lib/tokenFormat.test.ts
 *
 * (Standalone, same convention as the TimelineEditor tests — the repo has no
 * test runner. Exits non-zero on failure.)
 */

// Loaded through a non-literal specifier, like mediaDownloads.test.ts: node
// strips types from the .ts path, and tsc leaves a dynamic import it cannot
// resolve statically alone.
const mod = await import(process.argv[2] ?? './tokenFormat.ts');
const { expiryState, lastUsedLabel, EXPIRY_WARN_DAYS } = mod as {
  expiryState: (d: string | Date, now?: number) => { days: number; tone: string };
  lastUsedLabel: (d: string | Date | null, now?: number) => string | null;
  EXPIRY_WARN_DAYS: number;
};

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}

const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const agoMs  = (ms: number) => new Date(NOW - ms).toISOString();

console.log('\nexpiryState');

check('a fresh 30-day token is fine', () => {
  const s = expiryState(inDays(30), NOW);
  eq(s.days, 30, 'days:');
  eq(s.tone, 'ok', 'tone:');
});

check('it warns inside the documented window', () => {
  eq(expiryState(inDays(EXPIRY_WARN_DAYS - 0.5), NOW).tone, 'soon', 'tone:');
  eq(expiryState(inDays(1), NOW).tone, 'soon', 'tone:');
});

check('the warning boundary is exactly the documented day', () => {
  // 7 days left is still ok; anything under it warns. The integration guide
  // tells devices to alarm at seven, so the page must not disagree.
  eq(expiryState(inDays(EXPIRY_WARN_DAYS), NOW).tone, 'ok', 'at the boundary:');
  eq(expiryState(inDays(EXPIRY_WARN_DAYS - 0.01), NOW).tone, 'soon', 'just inside:');
});

check('days round DOWN, never up', () => {
  // 6.9 days is 6, not 7 — rounding up is how a rotation gets planned a day late.
  eq(expiryState(inDays(6.9), NOW).days, 6, 'days:');
});

check('an expired token reads as expired', () => {
  eq(expiryState(inDays(-1), NOW).tone, 'expired', 'tone:');
  eq(expiryState(new Date(NOW).toISOString(), NOW).tone, 'expired', 'exactly now:');
});

console.log('\nlastUsedLabel');

check('a token that has never been used returns null', () => {
  eq(lastUsedLabel(null, NOW), null);
});

check('very recent use reads as now', () => {
  eq(lastUsedLabel(agoMs(5_000), NOW), 'now');
  eq(lastUsedLabel(agoMs(44_000), NOW), 'now');
});

check('it steps through the units', () => {
  eq(lastUsedLabel(agoMs(90_000), NOW), '1m', 'minutes:');
  eq(lastUsedLabel(agoMs(3 * 3_600_000), NOW), '3h', 'hours:');
  eq(lastUsedLabel(agoMs(5 * 86_400_000), NOW), '5d', 'days:');
  eq(lastUsedLabel(agoMs(70 * 86_400_000), NOW), '2mo', 'months:');
});

check('a long-idle token is legible rather than enormous', () => {
  // The point of the column: eight months of silence must be obvious at a glance.
  eq(lastUsedLabel(agoMs(240 * 86_400_000), NOW), '8mo');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
