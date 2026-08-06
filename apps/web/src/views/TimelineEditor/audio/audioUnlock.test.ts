/**
 * Regression guard for joining a timeline that is ALREADY playing.
 *
 *     node apps/web/src/views/TimelineEditor/audioUnlock.test.ts
 *
 * (Standalone — the repo has no test runner. Exits non-zero on failure. Pass an
 * alternative module path as argv[2] to check a modified copy.)
 *
 * Pressing play is a user gesture, so the AudioContext created there comes up
 * running. Joining a room mid-playback is not — the transport arrives over a
 * socket — and every browser's autoplay policy holds that context `suspended`.
 * The run schedules, the playhead moves, and nothing is audible.
 *
 * What this pins down:
 *   1. a context that comes up suspended does not silently stay that way —
 *      the engine reports it as blocked and arms a gesture listener
 *   2. the next gesture anywhere on the page resumes it
 *   3. subscribers are told, exactly once, so the transport can re-anchor
 *      (resuming from the frozen run would replay the passage already missed)
 *   4. a context that comes up running never arms anything and never fires
 *
 * Against the engine before the fix, the four arming/resuming/announcing checks
 * fail: `resume()` was called fire-and-forget at start time and never retried,
 * so audio stayed dead for the whole session.
 */

let now = 0

class FakeParam {
  value = 1
  setValueAtTime() { return this }
  linearRampToValueAtTime() { return this }
  setTargetAtTime() { return this }
  cancelScheduledValues() { return this }
}
class FakeNode {
  gain = new FakeParam()
  connect() {}
  disconnect() {}
}

/** Whether a freshly constructed context is allowed to run — the autoplay gate. */
let allowAutoplay = false

class FakeAudioContext {
  state = allowAutoplay ? 'running' : 'suspended'
  destination = new FakeNode()
  baseLatency = 0.01
  outputLatency = 0.02
  get currentTime() { return now }
  createGain() { return new FakeNode() }
  createBufferSource() { return new FakeNode() }
  decodeAudioData() { return new Promise<never>(() => {}) }
  /** Resolves either way; only a gesture actually flips the state. */
  resume() {
    if (gestureSeen) this.state = 'running'
    return Promise.resolve()
  }
  close() { return Promise.resolve() }
}

/** Set by dispatching one of the unlock events, the way a real gesture would. */
let gestureSeen = false

// Minimal window stand-in: the engine registers capture-phase listeners on it.
type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

const fakeWindow = {
  addEventListener(type: string, fn: Listener) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(fn)
  },
  removeEventListener(type: string, fn: Listener) {
    listeners.get(type)?.delete(fn)
  },
}

function armedCount(): number {
  let n = 0
  for (const set of listeners.values()) n += set.size
  return n
}

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
}

/** Fire a gesture the way a click would, then let the resume promise settle. */
async function dispatchGesture(type = 'pointerdown'): Promise<void> {
  gestureSeen = true
  for (const fn of [...(listeners.get(type) ?? [])]) fn()
  await settle()
}

globalThis.window = fakeWindow as unknown as Window & typeof globalThis
globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
globalThis.fetch = (async () => ({ ok: true, arrayBuffer: async () => ({}) })) as unknown as typeof fetch

const engine = await import(
  process.argv[2] ?? './useAudioEngine.ts'
)

const FPS = 25
const clips = [{ id: 'A', fileId: 'fileA', position: 0, mediaStart: 0, end: 250 }]

let allOk = true
function check(label: string, condition: unknown, detail = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) allOk = false
}

// ── Joining a room that is already playing, with autoplay blocked ───────────
allowAutoplay = false

const reports: boolean[] = []
engine.onAudioBlockedChange((blocked: boolean) => { reports.push(blocked) })

engine.startAudioPlayback(clips, 0, FPS)

await settle()

check('a context blocked by autoplay is reported as blocked', engine.isAudioBlocked() === true)
check('a gesture listener is armed while blocked', armedCount() > 0, `${armedCount()} listener(s)`)
check('subscribers are told it is blocked', reports.join() === 'true', `[${reports.join()}]`)

await dispatchGesture()

check('the next gesture resumes the context', engine.isAudioBlocked() === false)
check('the release is announced exactly once', reports.join() === 'true,false', `[${reports.join()}]`)
check('the listener is disarmed once it has done its job', armedCount() === 0, `${armedCount()} left`)

// A second gesture must not re-announce — the transport would re-anchor twice.
await dispatchGesture()
check('a later gesture does not announce again', reports.join() === 'true,false', `[${reports.join()}]`)

engine.stopAudioPlayback()

// ── The ordinary case: play pressed by hand, autoplay allowed ───────────────
engine.destroyAudioEngine()
listeners.clear()
gestureSeen = false
allowAutoplay = true
reports.length = 0

engine.startAudioPlayback(clips, 0, FPS)
await settle()

check('a context that comes up running is not reported as blocked', engine.isAudioBlocked() === false)
check('nothing is armed when audio was never blocked', armedCount() === 0, `${armedCount()} listener(s)`)
check('nothing is announced when no block ever happened', reports.length === 0, `[${reports.join()}]`)

engine.stopAudioPlayback()

// ── Sticky activation: suspended at construction, but resume() is permitted ──
// The common case after clicking a timeline row to navigate here. This must not
// flash "blocked" at the toolbar, and must not leave a listener attached.
engine.destroyAudioEngine()
listeners.clear()
allowAutoplay = false     // comes up suspended...
gestureSeen   = true      // ...but the page already has user activation
reports.length = 0

engine.startAudioPlayback(clips, 0, FPS)
await settle()

check('sticky activation resumes without a gesture', engine.isAudioBlocked() === false)
check('sticky activation reports no block', reports.length === 0, `[${reports.join()}]`)
check('sticky activation leaves nothing armed', armedCount() === 0, `${armedCount()} listener(s)`)

engine.stopAudioPlayback()

console.log(allOk ? '\nAll checks passed.' : '\nFAILURES above.')
process.exit(allOk ? 0 : 1)

export {}
