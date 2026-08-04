/**
 * Regression guard for the audio engine's scheduling invariants.
 *
 *     node apps/web/src/views/TimelineEditor/useAudioEngine.test.mjs
 *
 * (Standalone — the repo has no test runner. Exits non-zero on failure, so it
 * drops into CI as a plain command whenever one is added. Pass an alternative
 * module path as argv[2] to check a modified copy.)
 *
 * It drives the real engine against a fake Web Audio API in which decodes are
 * resolved BY HAND, so the window between "this clip is due" and "here is its
 * buffer" can be held open and a seek or an edit slipped into it — the race
 * that used to leave two voices sounding for one clip, offset from each other.
 * Voices are counted LIVE (started and not stopped), because a started source
 * can only be stopped, never un-started.
 *
 * Against the engine before the fix, check 1 reports two live voices for the
 * same clip — one playing from 0.07s, one from 4.00s, at once.
 */

let now = 0
const started = []   // { clipLabel, when, offset, duration }

class FakeParam {
  constructor() { this.value = 1 }
  setValueAtTime() { return this }
  linearRampToValueAtTime() { return this }
  setTargetAtTime() { return this }
  cancelScheduledValues() { return this }
}
class FakeNode {
  constructor() { this.gain = new FakeParam() }
  connect() {}
  disconnect() {}
}
class FakeSource extends FakeNode {
  constructor(ctx) { super(); this.ctx = ctx; this.buffer = null; this.onended = null; this._started = false }
  start(when, offset, duration) {
    if (this._started) throw new Error('source started twice')
    this._started = true
    started.push({ src: this, when, offset, duration, buffer: this.buffer })
  }
  // A started source can only be stopped, never un-started — so what matters is
  // how many are still LIVE, not how many were ever created.
  stop() { this._stopped = true }
}

// Decodes are resolved manually so the race window can be held open.
const pendingDecodes = []

class FakeAudioContext {
  constructor() { this.state = 'running'; this.destination = new FakeNode(); this.baseLatency = 0.01; this.outputLatency = 0.02 }
  get currentTime() { return now }
  createGain() { return new FakeNode() }
  createBufferSource() { return new FakeSource(this) }
  decodeAudioData(ab) { return new Promise(res => pendingDecodes.push(() => res({ id: ab.id, duration: 60 }))) }
  resume() { this.state = 'running'; return Promise.resolve() }
  close() { return Promise.resolve() }
}

globalThis.AudioContext = FakeAudioContext
globalThis.fetch = async (url) => ({
  ok: true,
  arrayBuffer: async () => ({ id: url }),
})

const engine = await import(
  process.argv[2] ?? '/Users/larskrs/Utvikling/project-starling/apps/web/src/views/TimelineEditor/useAudioEngine.js'
)

const FPS = 25
// One clip at frame 0, 10s long, and a second at frame 500 so the run has more
// than one thing in flight.
const clips = [
  { id: 'A', fileId: 'fileA', position: 0,   mediaStart: 0, end: 250 },
  { id: 'B', fileId: 'fileB', position: 500, mediaStart: 0, end: 750 },
]

/** Let the fetch→arrayBuffer→decodeAudioData promise chain reach the decode. */
const settle = () => new Promise(r => setTimeout(r, 10))

/** Resolve every queued decode, repeatedly, until the engine stops asking. */
async function drainDecodes() {
  for (let i = 0; i < 6; i++) {
    await settle()
    while (pendingDecodes.length) pendingDecodes.shift()()
    await settle()
  }
}

const live = () => started.filter(s => !s.src._stopped)

function report(label, expected) {
  const n  = live().length
  const ok = n === expected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${n} live voice(s), expected ${expected} (${started.length} created)`)
  if (!ok) console.log('        ', JSON.stringify(live().map(({ when, offset, duration }) => ({ when, offset, duration })), null, 1))
  return ok
}

let allOk = true

// ── 1. Seek lands while the clip's decode is still in flight ─────────────────
engine.startAudioPlayback(clips, 0, FPS)
await settle()   // fetch chain reaches decodeAudioData; the decode now hangs
if (pendingDecodes.length === 0) { console.log('FAIL  setup: nothing scheduled'); process.exit(1) }

now += 0.1
engine.seekAudioPlayback(clips, 100, FPS)   // jump to frame 100, mid-clip-A

// Now let every decode (pre- and post-seek) resolve.
await drainDecodes()

allOk &= report('seek during in-flight decode', 1)
const offsets = live().map(s => s.offset)
const seekOk = offsets.every(o => Math.abs(o - 100 / FPS) < 1e-6)
console.log(`${seekOk ? 'PASS' : 'FAIL'}  the surviving voice plays from the POST-seek offset (${offsets.join(', ')}s, expected ${(100 / FPS).toFixed(2)}s)`)
allOk &= seekOk

// ── 2. Clip edit (resync) while a decode is in flight ────────────────────────
started.length = 0
pendingDecodes.length = 0
engine.stopAudioPlayback()
now += 1

// Fresh file ids so the decode is genuinely COLD and stays in flight across the
// edit — reusing fileA would hand back an already-resolved promise and the race
// window would never open.
const clips2 = [
  { id: 'C', fileId: 'fileC', position: 0,   mediaStart: 0, end: 250 },
  { id: 'D', fileId: 'fileD', position: 500, mediaStart: 0, end: 750 },
]
engine.startAudioPlayback(clips2, 0, FPS)
await settle()
if (pendingDecodes.length === 0) { console.log('FAIL  setup 2: decode not pending'); process.exit(1) }
now += 0.1
// Move clip C — same id, new timing — while its decode is pending.
const edited = [{ ...clips2[0], position: 30 }, clips2[1]]
engine.resyncAudioPlayback(edited, 5, FPS)

await drainDecodes()

allOk &= report('clip edit during in-flight decode', 1)

// ── 3. The reported clock is latency-compensated ─────────────────────────────
started.length = 0
engine.stopAudioPlayback()
now += 1
engine.startAudioPlayback(clips, 1000, FPS)
now += 1.0   // one second of context time passes
const frame = engine.getPlaybackFrame()
// startCtxTime = t0 + 0.03 lead; audible = now - 0.02 outputLatency
const expected = 1000 + (1.0 - 0.03 - 0.02) * FPS
const clockOk = Math.abs(frame - expected) < 1e-6
console.log(`${clockOk ? 'PASS' : 'FAIL'}  clock reports the AUDIBLE frame (${frame.toFixed(3)}, expected ${expected.toFixed(3)})`)
allOk &= clockOk

engine.stopAudioPlayback()
console.log(allOk ? '\nAll checks passed.' : '\nFAILURES above.')
process.exit(allOk ? 0 : 1)
