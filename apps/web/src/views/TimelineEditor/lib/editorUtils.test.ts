/**
 * Regression guard for timecode parsing in the clip dialogs.
 *
 *     node apps/web/src/views/TimelineEditor/lib/editorUtils.test.ts
 *
 * (Standalone, same convention as the other TimelineEditor tests — the repo has
 * no test runner. Exits non-zero on failure.)
 */

export {};   // a module, so these names don't collide with the other test scripts

const mod = await import(process.argv[2] ?? './editorUtils.ts');
const { tcToFrames, framesToTC } = mod as {
  tcToFrames: (text: string, frameRate: string | number) => number | null;
  framesToTC: (frame: number, frameRate: string | number) => string;
};

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}

console.log('\ntcToFrames');

check('full timecode', () => {
  eq(tcToFrames('00:00:01:00', 25), 25, '1s:');
  eq(tcToFrames('01:00:00:00', 25), 90000, '1h:');
  eq(tcToFrames('00:01:02:03', '25'), 1553, 'string fps:');
});

check('shorter right-aligned forms', () => {
  eq(tcToFrames('1:05', 25), 30, 'SS:FF:');
  eq(tcToFrames('02:10:05', 25), 3255, 'MM:SS:FF:');
});

check('a bare number is a frame count', () => eq(tcToFrames(' 250 ', 25), 250));

check('; and . separate too', () => {
  eq(tcToFrames('00;00;02;10', 30), 70, 'semicolons:');
  eq(tcToFrames('2.10', 30), 70, 'dots:');
});

check('the leading part may overflow', () => eq(tcToFrames('90:00', 25), 2250));

check('out-of-range inner parts are rejected', () => {
  eq(tcToFrames('00:00:00:25', 25), null, 'frames:');
  eq(tcToFrames('00:61:00:00', 25), null, 'minutes:');
  eq(tcToFrames('00:00:60:00', 25), null, 'seconds:');
});

check('anything else is rejected', () => {
  for (const bad of ['', 'abc', '-5', '1:2:3:4:5', '1::2', '12:', '1.5.']) {
    eq(tcToFrames(bad, 25), null, `"${bad}":`);
  }
  eq(tcToFrames('10', 0), null, 'no fps:');
});

check('round-trips framesToTC at whole-number rates', () => {
  for (const fps of [24, 25, 30, 50]) {
    for (const f of [0, 1, fps - 1, fps, 1499, 90000, 123456]) {
      eq(tcToFrames(framesToTC(f, fps), fps), f, `${fps}fps frame ${f}:`);
    }
  }
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
