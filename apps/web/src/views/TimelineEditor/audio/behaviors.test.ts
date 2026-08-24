/**
 * Regression guard for the behaviour controllers and the shared timeline clock.
 *
 *     node apps/web/src/views/TimelineEditor/audio/behaviors.test.ts
 *
 * (Standalone, same convention as transportClock.test.ts — the repo has no test
 * runner. Exits non-zero on failure.)
 *
 * The invariant this file exists to protect: EVERY generator on the timeline —
 * clip audio, metronome, spoken cues — places sound against the audio engine's
 * one run clock, so they cannot disagree about where a frame is.
 *
 * Three bugs are pinned down here, all of which shipped because metronome.ts
 * and tts.ts had no coverage at all:
 *
 *  1. The metronome kept a PRIVATE anchor, `ctx.currentTime + 0.08` tied to the
 *     visual playhead. The playhead is latency-compensated and currentTime is
 *     not, so every click landed 80ms + the device's output latency late — a
 *     fifth of a second on Bluetooth, nearly half a beat at 120 BPM. It was
 *     also blind to nudgePlaybackAnchor, so it drifted further as the run
 *     converged on the server.
 *  2. Spoken cues fired off wall-clock setTimeout, a different clock again,
 *     which followed neither seeks nor sync nudges.
 *  3. The cue speaker re-announced whatever clip the playhead was inside on
 *     every start() — and usePlayback rebuilds controllers on every re-time,
 *     up to twice a second, so cues stacked on top of each other.
 */

// ── Fake Web Audio ────────────────────────────────────────────────────────
// currentTime is driven by hand so a run can be advanced deterministically.

let now = 0
const OUTPUT_LATENCY = 0.15   // Bluetooth-ish, so latency mistakes are visible

interface StartedOsc { freq: number; when: number }
const startedOscs: StartedOsc[] = []

class FakeParam {
  value = 1
  setValueAtTime() { return this }
  linearRampToValueAtTime() { return this }
  exponentialRampToValueAtTime() { return this }
  // Ramps are what the mixer uses; land the target so levels are assertable.
  setTargetAtTime(v: number) { this.value = v; return this }
  cancelScheduledValues() { return this }
}
class FakeNode {
  gain = new FakeParam()
  frequency = new FakeParam()
  connect() {}
  disconnect() {}
}
class FakeOsc extends FakeNode {
  onended: (() => void) | null = null
  start(when: number) { startedOscs.push({ freq: this.frequency.value, when }) }
  stop() {}
}
class FakeBufferSource extends FakeNode {
  buffer: unknown = null
  onended: (() => void) | null = null
  start() {}
  stop() {}
}
class FakeAudioContext {
  state = 'running'
  get currentTime() { return now }
  get outputLatency() { return OUTPUT_LATENCY }
  baseLatency = 0
  destination = new FakeNode()
  createGain() { return new FakeNode() }
  createOscillator() { return new FakeOsc() }
  createBufferSource() { return new FakeBufferSource() }
  decodeAudioData() { return Promise.resolve({ duration: 60 }) }
  resume() { this.state = 'running'; return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
}

const spoken: string[] = []
let cancelCount = 0

const g = globalThis as Record<string, unknown>
g.AudioContext = FakeAudioContext
g.window = {
  speechSynthesis: { cancel: () => { cancelCount++ } },
  SpeechSynthesisUtterance: class {},
  addEventListener() {},
  removeEventListener() {},
}

// The real synthesiser is swapped out through tts.ts's injection seam, so this
// runs in bare node with no speech engine present.
const speechStub = {
  init:  () => Promise.resolve(true),
  speak: ({ text }: { text: string }) => { spoken.push(text); return Promise.resolve() },
}

let failures = 0
function check(name: string, cond: unknown): void {
  if (cond) console.log(`  ok  ${name}`)
  else { failures++; console.error(`FAIL  ${name}`) }
}
function close(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const engine = await import('./useAudioEngine.ts')
const { createMetronome } = await import('./metronome.ts')
const { createCueSpeaker, _setSpeechEngineForTest } = await import('./tts.ts')
_setSpeechEngineForTest(speechStub)

const FPS = 25

function resetRun(startFrame: number): void {
  engine.stopAudioPlayback()
  startedOscs.length = 0
  engine.startAudioPlayback([], startFrame, FPS)
}

// ── 1. The clock invariant itself ─────────────────────────────────────────
// Sound placed at ctxTimeForFrame(F) is heard exactly one output-latency
// later, which is the instant the engine reports frame F. If these two ever
// disagree, every generator downstream is desynced by the difference.
{
  now = 10
  resetRun(0)

  const F = 100
  const scheduleAt = engine.ctxTimeForFrame(F)!
  now = scheduleAt + OUTPUT_LATENCY          // the moment that sound is audible
  const reported = engine.getPlaybackFrame()!

  check(`engine reports frame ${F} exactly when its audio is heard (got ${reported.toFixed(3)})`,
    close(reported, F, 0.001))
  check('ctxTimeForFrame is latency-compensated, not raw currentTime',
    !close(scheduleAt, now, 0.001))
}

// ── 2. Metronome clicks land on the shared clock ──────────────────────────
{
  now = 10
  resetRun(0)

  // 120 BPM from frame 0 → a beat every 0.5s.
  const bpmClips = [{ id: 'm', position: 0, data: { bpm: 120, beatsPerBar: 4 } }] as never
  const metro = createMetronome({ clips: bpmClips, fps: FPS, endFrame: 25 * 60, trackId: 'trk' })
  metro.start(0)
  metro.stop()

  check(`metronome scheduled clicks (${startedOscs.length})`, startedOscs.length > 0)

  // Every click must sit on ctxTimeForFrame for its beat, to the sample.
  const wrong = startedOscs.filter((osc, i) => {
    const expected = engine.ctxTimeForFrame(i * 0.5 * FPS)!
    return !close(osc.when, Math.max(now, expected), 0.0005)
  })
  check(`every click is on the run clock (${wrong.length} off of ${startedOscs.length})`,
    wrong.length === 0)

  // The specific old bug: anchoring to raw currentTime + 0.08 put the first
  // click 80ms + latency late. Guard the magnitude, not just the formula.
  const firstExpected = engine.ctxTimeForFrame(0)!
  const oldBuggy      = now + 0.08
  check(`first click is not the old (0.08 + latency) late value`,
    !close(startedOscs[0]!.when, oldBuggy, 0.001)
    && close(startedOscs[0]!.when, Math.max(now, firstExpected), 0.0005))
}

// ── 3. A sync nudge moves clips and metronome together ────────────────────
{
  now = 10
  resetRun(0)

  const before = engine.ctxTimeForFrame(500)!
  engine.nudgePlaybackAnchor(12)             // absorb 12 frames of server drift
  const after  = engine.ctxTimeForFrame(500)!

  check(`a nudge shifts the shared clock (${(after - before).toFixed(4)}s for 12 frames)`,
    close(after - before, -12 / FPS, 0.0005))

  // The metronome reads that same mapping, so its clicks move with it rather
  // than drifting away over the run.
  startedOscs.length = 0
  const bpmClips = [{ id: 'm', position: 0, data: { bpm: 120, beatsPerBar: 4 } }] as never
  const metro = createMetronome({ clips: bpmClips, fps: FPS, endFrame: 25 * 60, trackId: 'trk' })
  metro.start(engine.getPlaybackFrame()!)
  metro.stop()
  const beat0 = startedOscs[0]
  check('metronome follows the nudged anchor',
    beat0 != null && close(beat0.when, Math.max(now, engine.ctxTimeForFrame(0)!), 0.5))
}

// ── 4. Cues fire off the run clock, not wall time ─────────────────────────
{
  now = 10
  resetRun(0)
  spoken.length = 0

  const cues = [
    { id: 'a', label: 'Cue A', position: 0,   end: null, mediaStart: null },
    { id: 'b', label: 'Cue B', position: 250, end: null, mediaStart: null },
  ] as never
  const speaker = createCueSpeaker({ clips: cues, trackId: 'trk' })

  speaker.start(0)                            // fresh play, sitting on Cue A
  await sleep(20)
  check(`fresh start speaks the cue it lands on (${JSON.stringify(spoken)})`,
    spoken.length === 1 && spoken[0] === 'Cue A')

  // Wall time has not moved the run; only the audio clock decides.
  await sleep(120)
  check(`Cue B stays silent while the run clock is still (${spoken.length})`,
    spoken.length === 1)

  // Advance the RUN past frame 250 and the cue fires on the next poll.
  now = engine.ctxTimeForFrame(260)! + OUTPUT_LATENCY
  await sleep(120)
  check(`Cue B fires once the run clock reaches it (${JSON.stringify(spoken)})`,
    spoken.length === 2 && spoken[1] === 'Cue B')

  speaker.stop()
}

// ── 5. A re-time must not re-announce the cue under the playhead ──────────
{
  now = 10
  resetRun(0)
  spoken.length = 0

  const cues = [{ id: 'a', label: 'Cue A', position: 0, end: null, mediaStart: null }] as never
  const speaker = createCueSpeaker({ clips: cues, trackId: 'trk' })

  speaker.start(0)
  await sleep(20)
  check(`fresh start speaks once (${spoken.length})`, spoken.length === 1)

  // Exactly what usePlayback does on every anchor-convergence tick.
  for (let i = 0; i < 5; i++) {
    speaker.stop()
    speaker.start(engine.getPlaybackFrame()!, { resumed: true })
    await sleep(10)
  }
  check(`5 re-times add no repeats (${spoken.length} total, expected 1)`,
    spoken.length === 1)

  speaker.stop()
}

// ── 6. …but a re-time still arms cues that are still ahead ────────────────
{
  now = 10
  resetRun(0)
  spoken.length = 0

  const cues = [{ id: 'n', label: 'Soon', position: 50, end: null, mediaStart: null }] as never
  const speaker = createCueSpeaker({ clips: cues, trackId: 'trk' })
  speaker.start(0, { resumed: true })

  now = engine.ctxTimeForFrame(60)! + OUTPUT_LATENCY
  await sleep(120)
  check(`a resumed start still fires an upcoming cue (${JSON.stringify(spoken)})`,
    spoken.length === 1 && spoken[0] === 'Soon')
  speaker.stop()
}

// ── 7. stop() cancels speech and stops the poll ───────────────────────────
{
  now = 10
  resetRun(0)
  spoken.length = 0
  const before = cancelCount

  const cues = [{ id: 'l', label: 'Later', position: 100, end: null, mediaStart: null }] as never
  const speaker = createCueSpeaker({ clips: cues, trackId: 'trk' })
  speaker.start(0)
  speaker.stop()

  now = engine.ctxTimeForFrame(200)! + OUTPUT_LATENCY
  await sleep(120)
  check('stop() cancels speech', cancelCount > before)
  check(`no cue fires after stop (${spoken.length})`, spoken.length === 0)
}

// ── 8. Metronome look-ahead covers a throttled background tick ────────────
{
  const src = await import('node:fs/promises')
    .then(fs => fs.readFile(new URL('./metronome.ts', import.meta.url), 'utf8'))
  const ahead = Number(/const AHEAD_S\s*=\s*([\d.]+)/.exec(src)?.[1])
  // Browsers clamp background setInterval to ~1s; the window must exceed that
  // or beats between windows are dropped outright rather than scheduled late.
  check(`metronome look-ahead (${ahead}s) covers a 1s throttled tick`, ahead > 1)
}

// ── 9. Per-track level applies live, and survives into the next run ───────
{
  now = 10
  resetRun(0)

  engine.setTrackVolume('trk', 0.4)
  check(`level is remembered (${engine.getTrackVolume('trk')})`,
    close(engine.getTrackVolume('trk'), 0.4, 1e-9))

  const node = engine.getTrackGain('trk')
  check(`a track created after the level already has it (${node.gain.value})`,
    close(node.gain.value, 0.4, 1e-9))

  // Moving the slider mid-playback must re-level what is already sounding.
  engine.setTrackVolume('trk', 0.9)
  check(`a live change reaches the sounding node (${node.gain.value})`,
    close(node.gain.value, 0.9, 1e-9))

  // A mixer setting, not run state: it must not reset on the next play.
  resetRun(0)
  check(`level survives a new run (${engine.getTrackVolume('trk')})`,
    close(engine.getTrackVolume('trk'), 0.9, 1e-9))

  check('an untouched track is at unity', close(engine.getTrackVolume('other'), 1, 1e-9))
  check('volume is clamped to 0..1',
    (engine.setTrackVolume('c', 5), close(engine.getTrackVolume('c'), 1, 1e-9)))
}

// ── 10. Which tracks support audio ────────────────────────────────────────
{
  const { trackSupportsAudio } = await import('../behaviors/trackSettings.ts')
  const type = (over: Record<string, unknown> = {}) => ({
    id: 'T', name: 't', hue: null, icon: null, trackMode: 'event',
    sourceSetId: null, trackDisplay: 'normal', nameDisplay: 'normal',
    clipDisplay: 'normal', metronome: false, tts: false, ...over,
  })
  const track = (over: Record<string, unknown> = {}) => ({ typeId: 'T', mode: 'event', ...over }) as never

  check('clip-mode track supports audio',
    trackSupportsAudio(track({ mode: 'clip' }), [type() as never]))
  check('event-mode source track does not',
    !trackSupportsAudio(track(), [type() as never]))
  check('metronome track supports audio even in event mode',
    trackSupportsAudio(track(), [type({ metronome: true }) as never]))
  check('TTS track supports audio even in event mode',
    trackSupportsAudio(track(), [type({ tts: true }) as never]))
  check('a clip-mode track with no clips still supports audio',
    trackSupportsAudio(track({ mode: 'clip' }), [type({ trackMode: 'clip' }) as never]))
}

engine.stopAudioPlayback()
engine.destroyAudioEngine()

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
