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

check('fractional rates count whole frames, so timecode never runs backwards', () => {
  // Counting seconds at 29.97 but frames at 30 once read 00:00:59:28 → 00:01:00:29 → 00:01:00:00.
  eq(framesToTC(1798, '29.97'), '00:00:59:28', 'frame 1798:');
  eq(framesToTC(1799, '29.97'), '00:00:59:29', 'frame 1799:');
  eq(framesToTC(1800, '29.97'), '00:01:00:00', 'frame 1800:');
});

check('drop-frame rates skip frame numbers, and negatives keep their sign', () => {
  eq(framesToTC(1800, '29.97df'), '00:01:00;02', 'first frame of minute 1:');
  eq(tcToFrames('00:01:00;02', '29.97df'), 1800, 'typed back:');
  eq(framesToTC(-25, 25), '-00:00:01:00', 'before zero:');
});

check('round-trips framesToTC at fractional and drop-frame rates', () => {
  for (const fps of ['23.976', '29.97', '29.97df', '59.94']) {
    for (const f of [0, 1, 29, 1799, 1800, 17982, 123456]) {
      eq(tcToFrames(framesToTC(f, fps), fps), f, `${fps}fps frame ${f}:`);
    }
  }
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
