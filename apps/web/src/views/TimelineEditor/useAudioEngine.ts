/**
 * Singleton audio engine for the timeline editor.
 *
 * Playback model — each press of play is one "run" with its OWN gain subtree:
 *
 *     clip sources → clip gain (declick) → run gain → master gain → destination
 *
 * Stopping fades that run's gain to zero and disconnects the whole subtree, so a
 * run can never bleed into the next one. This is what prevents the old bug where
 * a previous play's voices kept sounding and stacked into distortion on replay:
 * there is exactly one live run gain connected to master at a time, and starting
 * a new run tears the previous one down first.
 *
 * - Lazy AudioContext (created on first startPlayback — after a user gesture)
 * - Decoded AudioBuffer cache keyed by fileId (shared with the waveform module)
 * - Rolling look-ahead scheduler: clips decode + schedule only as they approach
 *
 * Two invariants keep playback predictable, and every change here has to hold
 * them:
 *
 *  1. ONE VOICE PER CLIP. Scheduling is async (decode), so a seek or an edit can
 *     land between "this clip is due" and "here is its buffer". Every schedule
 *     stamps the clip with a monotonic token and a late decode that no longer
 *     holds the current stamp is dropped — without that, the stale callback
 *     installs a second voice at the OLD timing and you hear the clip twice,
 *     offset. See `_scheduleSeq` / `_invalidateClip`.
 *
 *  2. POSITIONS ARE REPORTED AS HEARD, not as scheduled — `_audibleTime()`
 *     subtracts the device's output latency, so the visual playhead matches the
 *     speakers and clients on different hardware converge on the same audible
 *     frame.
 */

// Explicit extension: useAudioEngine.test.ts loads this module in bare node,
// whose type stripping resolves specifiers literally rather than probing
// extensions the way the bundler does.
import { fetchTracked, markDownloadStage, markDownloadDone, markDownloadFailed } from './mediaDownloads.ts'
import type { Clip } from '../../types/timeline'

/** One sounding source node plus the gain that fades it in and out. */
interface Voice {
  clipId: string
  src: AudioBufferSourceNode
  gain: GainNode
}

/**
 * A playback run: the time reference every scheduled voice was placed against,
 * plus the bookkeeping that lets a resync tell what still holds.
 */
interface Run {
  gain: GainNode
  frameRate: number
  startCtxTime: number
  startFrame: number
  clips: Clip[]
  scheduled: Set<string>
  /** clipId → _clipSig at schedule time (for resync diffing). */
  sigs: Map<string, string>
  /** clipId → scheduling token (invalidates stale decodes). */
  tokens: Map<string, number>
  voices: Voice[]
  timer: ReturnType<typeof setInterval> | null
  /** Frames the sounding voices are off after anchor nudges. */
  skew: number
}

let _ctx: AudioContext | null          = null
let _master: GainNode | null           = null
let _masterVolume                      = 1

// The active run, or null when stopped. Async scheduler callbacks capture their
// run and bail if it's no longer `_run` (stale = superseded or stopped).
let _run: Run | null = null

// Monotonic scheduling token. Scheduling a clip means starting an async decode
// and installing a voice when it resolves — by which time a seek or an edit may
// have moved that clip, or moved the run's whole time reference. Checking
// `_run === run` is NOT enough to catch that: seek and resync keep the same run
// object alive, so a stale callback would happily install a SECOND voice at the
// old timing, on top of the correctly rescheduled one. That is the duplicated,
// out-of-sync playback this counter exists to prevent: every schedule stamps
// the clip with a fresh token, invalidating a clip bumps it, and a decode that
// resolves against a stale stamp is dropped. Never reused, so a stale token can
// never match again.
let _scheduleSeq = 0

const _bufferPromises = new Map()  // fileId → Promise<AudioBuffer>

const FADE_S = 0.008   // declick ramp at each clip's edges
const STOP_S = 0.03    // fade-out ramp applied to a whole run when it stops
const VOICE_STOP_S = 0.03  // fade-out for a single voice retired during a resync

const START_LEAD_S = 0.03  // anchor lead on a fresh run (first tick isn't late)
const SEEK_LEAD_S  = 0.02  // anchor lead when re-anchoring a live run (seek)

// Scheduling signature of a clip: the fields that decide WHAT plays and WHEN.
// A resync only reschedules clips whose signature changed; clips whose signature
// is unchanged keep their currently-playing voice untouched (no gap).
function _clipSig(clip: Clip): string {
  return `${clip.position}:${clip.mediaStart ?? 0}:${clip.end}:${clip.fileId}`
}

const TICK_MS          = 200   // scheduler poll interval
// The look-ahead has to cover the worst interval the scheduler can be woken at,
// not the nominal one: browsers clamp setInterval to ~1s in a background tab, so
// a 0.5s window let backgrounded playback miss clip starts outright (they then
// attacked late, mid-sample). 1.5s keeps a 1s-throttled tick comfortably ahead.
const SCHEDULE_AHEAD_S = 1.5   // create + start sources this far ahead of playtime
const DECODE_AHEAD_S   = 6     // warm the decode cache this far ahead

function getContext() {
  if (!_ctx) {
    _ctx = new AudioContext()
    _master = _ctx.createGain()
    _master.gain.value = _masterVolume
    _master.connect(_ctx.destination)
  }
  return _ctx
}

/** Shared AudioContext — behavior controllers (metronome etc.) schedule on it. */
export function getAudioContext() {
  return getContext()
}

/**
 * Context time of the audio reaching the listener's ears RIGHT NOW.
 *
 * `currentTime` is the clock we SCHEDULE against; what is actually being heard
 * lags it by the device's output latency — a couple of ms on wired output, tens
 * of ms through a USB interface, and well over 100ms on Bluetooth. Every
 * position this module reports is the audible one, so (a) the playhead lines up
 * with what you hear instead of running ahead of it, and (b) because each
 * client compensates for its own device, clients converge on the same *audible*
 * frame rather than the same scheduling frame — two people on different
 * hardware hear the same moment together.
 *
 * Scheduling itself deliberately keeps using raw `currentTime`.
 */
function _audibleTime(): number {
  const ctx = getContext()
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)
}

/** Master gain node — route generated audio through it so master volume applies. */
export function getMasterGain(): GainNode {
  getContext()
  return _master!
}

/** Global playback volume in [0, 1]. */
export function setMasterVolume(v: number): void {
  _masterVolume = Math.max(0, Math.min(1, v))
  if (_master && _ctx) _master.gain.setTargetAtTime(_masterVolume, _ctx.currentTime, 0.01)
}

export function getMasterVolume() {
  return _masterVolume
}

/**
 * Returns (and caches) a decoded AudioBuffer for the given file.
 * Usable immediately — the AudioContext need not be running.
 *
 * The transfer is reported into the shared download registry, so the same fetch
 * that feeds playback also drives the clip's loading state and the download
 * island. Decoding is reported as its own stage: a long file spends real time
 * there after the last byte lands, and a progress bar frozen at 100% with
 * nothing audible yet reads as a hang.
 */
export function getAudioBuffer(fileId: string): Promise<AudioBuffer> {
  const cached = _bufferPromises.get(fileId)
  if (!cached) {
    const p = fetchTracked(fileId, `/api/storage/${fileId}/serve`, { kind: 'audio' })
      .then(ab => {
        markDownloadStage(fileId, 'decoding')
        return getContext().decodeAudioData(ab)
      })
      .then(buf => {
        markDownloadDone(fileId)
        return buf
      })
      .catch((err: unknown) => {
        _bufferPromises.delete(fileId)
        markDownloadFailed(fileId, err instanceof Error ? err.message : undefined)
        throw err
      })
    _bufferPromises.set(fileId, p)
    return p
  }
  return cached
}

/**
 * Begins a playback run at the given playhead. Clips aren't all scheduled up
 * front: a timer walks a look-ahead window, warming decodes ~4s ahead and
 * starting source nodes ~0.5s ahead of each clip. A clip the playhead is inside
 * starts from the correct media offset; each clip fades in/out to avoid clicks.
 *
 */
// Clips that can sound at/after the given playhead (valid file + window not passed).
function _schedulableFrom(clips: Clip[], playheadFrame: number): Clip[] {
  return clips.filter(clip => {
    if (!clip.fileId) return false
    const ms = clip.mediaStart ?? 0
    const me = clip.end
    if (me == null || me <= ms) return false
    return playheadFrame < clip.position + (me - ms)  // not already finished
  })
}

export function startAudioPlayback(clips: Clip[], playheadFrame: number, frameRate: number): void {
  stopAudioPlayback()
  const ctx = getContext()
  if (ctx.state === 'suspended') void ctx.resume()

  const gain = ctx.createGain()
  gain.connect(getMasterGain())

  _run = {
    gain,
    frameRate,
    startCtxTime: ctx.currentTime + START_LEAD_S,
    startFrame:   playheadFrame,
    clips:        _schedulableFrom(clips, playheadFrame),
    scheduled:    new Set(),
    sigs:         new Map(),   // clipId → _clipSig at schedule time (for resync diffing)
    tokens:       new Map(),   // clipId → scheduling token (invalidates stale decodes)
    voices:       [],
    timer:        null,
    skew:         0,           // frames the sounding voices are off after anchor nudges
  }

  _scheduleDue()
  _run.timer = setInterval(_scheduleDue, TICK_MS)
}

/**
 * Audio-clock playhead of the live run, in frames — the authoritative playback
 * time base. usePlayback drives the visual playhead from this while it's
 * available, so sound and visuals cannot drift apart (rAF stalls, tab
 * throttling, long-run clock skew). Null when it can't serve as a time base:
 * no run, or the context isn't running (e.g. autoplay-blocked).
 */
export function getPlaybackFrame(): number | null {
  if (!_run || !_ctx || _ctx.state !== 'running') return null
  return _run.startFrame + Math.max(0, _audibleTime() - _run.startCtxTime) * _run.frameRate
}

/**
 * Shift a live run's time mapping by deltaFrames WITHOUT touching its voices:
 * getPlaybackFrame() — and every clip scheduled from here on — moves; audio
 * that is already sounding plays on untouched. This is the micro-correction
 * primitive: small sync drift is absorbed here instead of restarting audio,
 * which is what keeps playback jitter-free while clients converge on the same
 * frame. Returns the accumulated |skew| (how far the sounding voices are off
 * the reported clock) so callers can force a real re-anchor once it grows past
 * their tolerance; a start/seek resets it.
 */
export function nudgePlaybackAnchor(deltaFrames: number): number {
  if (!_run) return 0
  _run.startFrame += deltaFrames
  _run.skew       += deltaFrames
  return Math.abs(_run.skew)
}

/** Walk the look-ahead window: warm decodes, and schedule clips that are due. */
function _scheduleDue() {
  const run = _run
  if (!run || !_ctx) return
  const t = _ctx.currentTime

  for (const clip of run.clips) {
    if (run.scheduled.has(clip.id)) continue

    const ms             = clip.mediaStart ?? 0
    const durationFrames = (clip.end ?? 0) - ms
    const startAt = run.startCtxTime + Math.max(0, clip.position - run.startFrame) / run.frameRate
    const endAt   = run.startCtxTime + (clip.position + durationFrames - run.startFrame) / run.frameRate

    if (endAt <= t) { run.scheduled.add(clip.id); run.sigs.set(clip.id, _clipSig(clip)); continue }  // window already passed
    if (startAt > t + DECODE_AHEAD_S) continue                 // too far out to care yet

    // Warm the decode cache ahead of time so the buffer is ready when due.
    if (clip.fileId) void getAudioBuffer(clip.fileId).catch(() => { /* reported via the registry */ })

    if (startAt <= t + SCHEDULE_AHEAD_S) {
      run.scheduled.add(clip.id)
      run.sigs.set(clip.id, _clipSig(clip))
      const token = ++_scheduleSeq
      run.tokens.set(clip.id, token)
      _scheduleClip(clip, run, token)
    }
  }
}

/** Create + start one clip's source node into its run's subtree. */
function _scheduleClip(clip: Clip, run: Run, token: number): void {
  const ms             = clip.mediaStart ?? 0
  const durationFrames = (clip.end ?? 0) - ms
  const offsetFrames   = Math.max(0, run.startFrame - clip.position)  // playhead started inside clip
  const startAt        = run.startCtxTime + Math.max(0, clip.position - run.startFrame) / run.frameRate
  const bufferStart    = (ms + offsetFrames) / run.frameRate
  const playSeconds    = (durationFrames - offsetFrames) / run.frameRate
  if (playSeconds <= 0) return

  getAudioBuffer(clip.fileId!).then((buf: AudioBuffer) => {
    // Bail if this run was stopped or superseded while decoding, or if the clip
    // was re-scheduled meanwhile (seek / edit) — `startAt` and `bufferStart`
    // above were computed against a time reference that no longer applies, and
    // installing them now would stack a stale voice under the current one.
    if (_run !== run || !_ctx) return
    if (run.tokens.get(clip.id) !== token) return

    const when = Math.max(_ctx.currentTime, startAt)
    const lost = Math.max(0, _ctx.currentTime - startAt)  // time spent decoding past the start
    const dur  = playSeconds - lost
    if (dur <= 0) return

    // Belt and braces: one clip, one voice. The token check above is what makes
    // a stale schedule impossible; this makes a duplicate INAUDIBLE even if some
    // future path forgets to invalidate.
    _retireClipVoices(run, clip.id)

    const src  = _ctx.createBufferSource()
    const gain = _ctx.createGain()
    src.buffer = buf
    src.connect(gain)
    gain.connect(run.gain)

    const fade = Math.min(FADE_S, dur / 2)
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(1, when + fade)
    gain.gain.setValueAtTime(1, Math.max(when + fade, when + dur - fade))
    gain.gain.linearRampToValueAtTime(0, when + dur)

    src.start(when, bufferStart + lost, dur)
    const voice = { clipId: clip.id, src, gain }
    run.voices.push(voice)
    src.onended = () => {
      try { src.disconnect(); gain.disconnect() } catch {}
      const i = run.voices.indexOf(voice)
      if (i !== -1) run.voices.splice(i, 1)
    }
  }).catch(() => {})
}

/** Fade out and stop one voice (short declick ramp), then disconnect it. */
function _retireVoice(voice: Voice, t: number): void {
  try {
    const stopAt = t + VOICE_STOP_S
    voice.gain.gain.cancelScheduledValues(t)
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t)
    voice.gain.gain.linearRampToValueAtTime(0, stopAt)
    voice.src.onended = null  // we manage removal here; don't double-splice
    voice.src.stop(stopAt)
    setTimeout(() => { try { voice.src.disconnect(); voice.gain.disconnect() } catch {} }, (VOICE_STOP_S + 0.05) * 1000)
  } catch {}
}

/** Fade out and stop every live voice belonging to one clip, then drop them. */
function _retireClipVoices(run: Run, clipId: string): void {
  if (!_ctx) return
  const t = _ctx.currentTime
  run.voices = run.voices.filter(voice => {
    if (voice.clipId !== clipId) return true
    _retireVoice(voice, t)
    return false
  })
}

/**
 * Forget a clip completely: retire what it is playing AND invalidate its
 * scheduling, so an in-flight decode for it can no longer install a voice. Any
 * path that intends to re-schedule a clip must go through here first, or the
 * old and new schedules both land.
 */
function _invalidateClip(run: Run, clipId: string): void {
  _retireClipVoices(run, clipId)
  run.scheduled.delete(clipId)
  run.sigs.delete(clipId)
  run.tokens.delete(clipId)
}

/**
 * Re-anchor a LIVE run at a new playhead (a seek): every voice retires with a
 * declick fade, the run's time reference moves, and due clips reschedule
 * immediately. The run's gain subtree and scheduler timer survive — much
 * lighter than a stop + start, and the decode cache makes re-attack instant
 * for anything already heard.
 */
export function seekAudioPlayback(clips: Clip[], playheadFrame: number, frameRate: number): void {
  const run = _run
  if (!run || !_ctx || run.frameRate !== frameRate) {
    startAudioPlayback(clips, playheadFrame, frameRate)
    return
  }
  if (_ctx.state === 'suspended') _ctx.resume()

  const t = _ctx.currentTime
  for (const voice of run.voices) _retireVoice(voice, t)
  run.voices = []
  run.scheduled.clear()
  run.sigs.clear()
  // The run's whole time reference moves below, so EVERY in-flight decode is
  // now stale — it would place its voice against the pre-seek anchor.
  run.tokens.clear()

  run.clips        = _schedulableFrom(clips, playheadFrame)
  run.startCtxTime = t + SEEK_LEAD_S
  run.startFrame   = playheadFrame
  run.skew         = 0

  _scheduleDue()
}

/**
 * Re-point a LIVE run at edited timeline state without tearing it down. Voices
 * for clips whose scheduling signature is unchanged keep playing untouched — so
 * moving/cropping one clip (or a peer's edit arriving) no longer gaps the whole
 * mix. Only changed clips are faded + rescheduled; removed clips fade out; added
 * or moved-into-range clips get picked up by the scheduler on the spot.
 *
 * Falls back to a clean start when there's no live run, or when the frame rate
 * changed (the run's whole time reference would be invalid).
 */
export function resyncAudioPlayback(clips: Clip[], playheadFrame: number, frameRate: number): void {
  const run = _run
  if (!run || !_ctx || run.frameRate !== frameRate) {
    startAudioPlayback(clips, playheadFrame, frameRate)
    return
  }

  // Deliberately NOT filtered by the playhead the way a seek is: an edit can
  // move a clip backwards under the playhead, and it has to be able to
  // re-attack. Filtering here would also retire a voice whose clip ends within
  // the anchor skew — audibly early — because this playhead is the visual one.
  const schedulable = clips.filter(clip => {
    if (!clip.fileId) return false
    const ms = clip.mediaStart ?? 0
    const me = clip.end
    return me != null && me > ms
  })
  const nextById = new Map<string, Clip>(schedulable.map(c => [c.id, c]))

  // Retire voices + scheduling for clips that were removed or whose timing changed.
  for (const clipId of [...run.scheduled]) {
    const next = nextById.get(clipId)
    if (next && _clipSig(next) === run.sigs.get(clipId)) continue  // unchanged → leave playing
    _invalidateClip(run, clipId)
  }

  // Swap in the new set; the scheduler picks up adds/moves on its next walk,
  // which we run now so a clip moved under the playhead re-attacks immediately.
  run.clips = schedulable
  _scheduleDue()
}

/**
 * Stop the current run: fade its gain out, hard-stop every voice, and disconnect
 * the whole subtree so nothing from this run can keep sounding.
 */
export function stopAudioPlayback() {
  const run = _run
  _run = null
  if (!run) return
  if (run.timer) clearInterval(run.timer)

  const ctx = _ctx
  if (!ctx) return

  const t      = ctx.currentTime
  const stopAt = t + STOP_S
  try {
    run.gain.gain.cancelScheduledValues(t)
    run.gain.gain.setValueAtTime(Math.max(0.0001, run.gain.gain.value), t)
    run.gain.gain.linearRampToValueAtTime(0, stopAt)
  } catch {}

  for (const { src } of run.voices) {
    try { src.stop(stopAt) } catch {}
  }

  // Tear the subtree off master once the fade has completed.
  setTimeout(() => { try { run.gain.disconnect() } catch {} }, (STOP_S + 0.05) * 1000)
}

/** Close and dispose the audio context. Call on component unmount. */
export function destroyAudioEngine() {
  stopAudioPlayback()
  try { _ctx?.close() } catch {}
  _ctx    = null
  _master = null
  _bufferPromises.clear()
}
