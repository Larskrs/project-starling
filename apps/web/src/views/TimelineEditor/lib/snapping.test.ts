/**
 * Regression guard for clip snapping.
 *
 *     node apps/web/src/views/TimelineEditor/lib/snapping.test.ts
 *
 * (Standalone, same convention as the other TimelineEditor tests — the repo has
 * no test runner. Exits non-zero on failure.)
 */

export {};   // a module, so these names don't collide with the other test scripts

const mod = await import(process.argv[2] ?? './snapping.ts');
const { buildSnapTargets, nearestTarget, snapSpan } = mod as {
  buildSnapTargets: (frames: Iterable<number>) => number[];
  nearestTarget: (targets: readonly number[], frame: number, threshold: number) => number | null;
  snapSpan: (targets: readonly number[], start: number, length: number, threshold: number) => { start: number; guide: number | null };
};

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what} expected ${e}, got ${a}`);
}

console.log('\nbuildSnapTargets');

check('sorted, rounded, de-duplicated, non-finite dropped', () => {
  eq(buildSnapTargets([10, 2.4, 10, Number.NaN, 5, Infinity]), [2, 5, 10]);
});

console.log('\nnearestTarget');

check('an empty list never snaps', () => eq(nearestTarget([], 5, 100), null));
check('catches the closer neighbour', () => eq(nearestTarget([0, 10, 20], 12, 3), 10));
check('ignores targets outside the threshold', () => eq(nearestTarget([0, 10, 20], 15.5, 4), null));
check('works before the first and after the last target', () => {
  eq(nearestTarget([10, 20], 8, 3), 10, 'before:');
  eq(nearestTarget([10, 20], 23, 3), 20, 'after:');
});
check('the threshold is inclusive', () => eq(nearestTarget([10], 13, 3), 10));

console.log('\nsnapSpan');

check('the start edge catches', () => eq(snapSpan([100], 97, 50, 5), { start: 100, guide: 100 }));
check('the end edge catches and moves the start with it', () => {
  eq(snapSpan([100], 48, 50, 5), { start: 50, guide: 100 });
});
check('when both edges could catch, the closer one wins', () => {
  // start 98 is 2 from 100; end 148 is 4 from 152.
  eq(snapSpan([100, 152], 98, 50, 5), { start: 100, guide: 100 });
});
check('a point (length 0) only snaps its start', () => {
  eq(snapSpan([100], 50, 0, 5), { start: 50, guide: null });
});
check('nothing in reach rounds to a whole frame', () => {
  eq(snapSpan([], 12.6, 10, 5), { start: 13, guide: null });
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
