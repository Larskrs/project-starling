/**
 * Regression guard for the camera watcher.
 *
 *     node packages/integration-test/src/cameraWatch.test.ts
 *
 * (Standalone, same convention as the web tests — the repo has no test runner.
 * Exits non-zero on failure.)
 *
 * The invariant: a line is printed when the timeline cuts to a DIFFERENT
 * camera, and at no other time. The active clip changes far more often than the
 * camera does — every new cue on the same camera fires clip:active — so a
 * watcher that prints on every event is a watcher nobody can read.
 */

const mod = await import(process.argv[2] ?? './cameraWatch.ts');
const { createCameraWatch, formatTimecode } = mod as {
  createCameraWatch: (o: {
    trackName(id: string): string;
    cameraName(id: string): string | null;
  }) => {
    observe(e: Record<string, unknown>): { from: string | null; to: string; trackName: string } | null;
    reset(): void;
  };
  formatTimecode: (frame: number, fps: number) => string;
};

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

const CAMERAS: Record<string, string> = { s1: 'CAM 1', s2: 'CAM 2', s3: 'CAM 3' };
const TRACKS: Record<string, string> = { t1: 'Programme', t2: 'Preview' };

const newWatch = () => createCameraWatch({
  trackName:  id => TRACKS[id] ?? id,
  cameraName: id => CAMERAS[id] ?? null,
});

const active = (trackId: string, sourceId: string | null, clipId = 'c1', label: string | null = null) =>
  ({ trackId, clipId, sourceId, label, frame: 100, at: Date.now() });

console.log('\ncuts');

check('the first camera on a track is reported', () => {
  const w = newWatch();
  const cut = w.observe(active('t1', 's1'));
  assert(cut, 'nothing reported');
  eq(cut!.from, null, 'from:');
  eq(cut!.to, 'CAM 1', 'to:');
  eq(cut!.trackName, 'Programme', 'track:');
});

check('cutting to a different camera is reported', () => {
  const w = newWatch();
  w.observe(active('t1', 's1'));
  const cut = w.observe(active('t1', 's2'));
  assert(cut, 'nothing reported');
  eq(cut!.from, 'CAM 1', 'from:');
  eq(cut!.to, 'CAM 2', 'to:');
});

check('a NEW CLIP on the same camera is silent', () => {
  // The whole point. clip:active fires per clip, and a camera usually holds
  // several cues in a row — printing each one buries the actual cuts.
  const w = newWatch();
  w.observe(active('t1', 's1', 'clip-a'));
  eq(w.observe(active('t1', 's1', 'clip-b')), null, 'second clip:');
  eq(w.observe(active('t1', 's1', 'clip-c')), null, 'third clip:');
});

check('a gap is silent, and does not fake a cut when the camera returns', () => {
  // Cam1 → gap → Cam1 is one camera being on, not two cuts.
  const w = newWatch();
  w.observe(active('t1', 's1'));
  eq(w.observe(active('t1', null, 'none')), null, 'the gap:');
  eq(w.observe(active('t1', 's1')), null, 'returning to the same camera:');
});

check('a gap does not hide a genuine cut', () => {
  const w = newWatch();
  w.observe(active('t1', 's1'));
  w.observe(active('t1', null));
  const cut = w.observe(active('t1', 's2'));
  assert(cut, 'cut after a gap was swallowed');
  eq(cut!.from, 'CAM 1', 'from:');
  eq(cut!.to, 'CAM 2', 'to:');
});

check('tracks are independent', () => {
  const w = newWatch();
  w.observe(active('t1', 's1'));
  const preview = w.observe(active('t2', 's1'));
  assert(preview, 'the same camera on another track was swallowed');
  eq(preview!.trackName, 'Preview', 'track:');
  eq(preview!.from, null, 'from:');
});

check('an unknown camera falls back to its id rather than vanishing', () => {
  const w = newWatch();
  const cut = w.observe(active('t1', 'unknown-source'));
  assert(cut, 'nothing reported');
  eq(cut!.to, 'unknown-source', 'to:');
});

check('reset makes the next camera report again', () => {
  // A reconnect means the gap was unobserved: whatever is live now is news.
  const w = newWatch();
  w.observe(active('t1', 's1'));
  eq(w.observe(active('t1', 's1')), null, 'before reset:');
  w.reset();
  const cut = w.observe(active('t1', 's1'));
  assert(cut, 'nothing reported after reset');
  eq(cut!.from, null, 'from:');
});

console.log('\ntimecode');

check('frames format as HH:MM:SS:FF', () => {
  eq(formatTimecode(0, 25), '00:00:00:00');
  eq(formatTimecode(24, 25), '00:00:00:24');
  eq(formatTimecode(25, 25), '00:00:01:00');
  eq(formatTimecode(25 * 60, 25), '00:01:00:00');
  eq(formatTimecode(25 * 3600, 25), '01:00:00:00');
});

check('a fractional frame rounds to the frame that triggered the cut', () => {
  // A playing position is derived from a clock, so it arrives fractional.
  eq(formatTimecode(24.6, 25), '00:00:01:00');
  eq(formatTimecode(24.2, 25), '00:00:00:24');
});

check('odd frame rates and negatives do not produce nonsense', () => {
  eq(formatTimecode(30, 29.97), '00:00:01:00');
  eq(formatTimecode(-5, 25), '00:00:00:00');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
