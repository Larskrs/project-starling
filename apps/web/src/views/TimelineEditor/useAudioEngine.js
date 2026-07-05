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
 */

let _ctx          = null
let _master       = null
let _masterVolume = 1

// The active run, or null when stopped. Async scheduler callbacks capture their
// run and bail if it's no longer `_run` (stale = superseded or stopped).
let _run = null   // { gain, frameRate, startCtxTime, startFrame, clips, scheduled:Set, sigs:Map, voices:[], timer }

const _bufferPromises = new Map()  // fileId → Promise<AudioBuffer>

const FADE_S = 0.008   // declick ramp at each clip's edges
const STOP_S = 0.03    // fade-out ramp applied to a whole run when it stops
const VOICE_STOP_S = 0.03  // fade-out for a single voice retired during a resync

// Scheduling signature of a clip: the fields that decide WHAT plays and WHEN.
// A resync only reschedules clips whose signature changed; clips whose signature
// is unchanged keep their currently-playing voice untouched (no gap).
function _clipSig(clip) {
  return `${clip.position}:${clip.mediaStart ?? 0}:${clip.end}:${clip.fileId}`
}

const TICK_MS          = 200   // scheduler poll interval
const SCHEDULE_AHEAD_S = 0.5   // create + start sources this far ahead of playtime
const DECODE_AHEAD_S   = 4     // warm the decode cache this far ahead

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

/** Master gain node — route generated audio through it so master volume applies. */
export function getMasterGain() {
  getContext()
  return _master
}

/** Global playback volume in [0, 1]. */
export function setMasterVolume(v) {
  _masterVolume = Math.max(0, Math.min(1, v))
  if (_master && _ctx) _master.gain.setTargetAtTime(_masterVolume, _ctx.currentTime, 0.01)
}

export function getMasterVolume() {
  return _masterVolume
}

/**
 * Returns (and caches) a decoded AudioBuffer for the given file.
 * Usable immediately — the AudioContext need not be running.
 */
export function getAudioBuffer(fileId) {
  if (!_bufferPromises.has(fileId)) {
    const p = fetch(`/api/storage/${fileId}/serve`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then(ab => getContext().decodeAudioData(ab))
      .catch(err => {
        _bufferPromises.delete(fileId)
        throw err
      })
    _bufferPromises.set(fileId, p)
  }
  return _bufferPromises.get(fileId)
}

/**
 * Begins a playback run at the given playhead. Clips aren't all scheduled up
 * front: a timer walks a look-ahead window, warming decodes ~4s ahead and
 * starting source nodes ~0.5s ahead of each clip. A clip the playhead is inside
 * starts from the correct media offset; each clip fades in/out to avoid clicks.
 *
 * @param {Array}  clips          — clip objects with id, fileId, position, mediaStart, end
 * @param {number} playheadFrame  — current playhead (float)
 * @param {number} frameRate      — timeline fps (number)
 */
export function startAudioPlayback(clips, playheadFrame, frameRate) {
  stopAudioPlayback()
  const ctx = getContext()
  if (ctx.state === 'suspended') ctx.resume()

  const schedulable = clips.filter(clip => {
    if (!clip.fileId) return false
    const ms = clip.mediaStart ?? 0
    const me = clip.end
    if (me == null || me <= ms) return false
    return playheadFrame < clip.position + (me - ms)  // not already finished
  })

  const gain = ctx.createGain()
  gain.connect(_master)

  _run = {
    gain,
    frameRate,
    startCtxTime: ctx.currentTime + 0.08,  // small lead so the first tick isn't already late
    startFrame:   playheadFrame,
    clips:        schedulable,
    scheduled:    new Set(),
    sigs:         new Map(),   // clipId → _clipSig at schedule time (for resync diffing)
    voices:       [],
    timer:        null,
  }

  _scheduleDue()
  _run.timer = setInterval(_scheduleDue, TICK_MS)
}

/** Walk the look-ahead window: warm decodes, and schedule clips that are due. */
function _scheduleDue() {
  const run = _run
  if (!run || !_ctx) return
  const t = _ctx.currentTime

  for (const clip of run.clips) {
    if (run.scheduled.has(clip.id)) continue

    const ms             = clip.mediaStart ?? 0
    const durationFrames = clip.end - ms
    const startAt = run.startCtxTime + Math.max(0, clip.position - run.startFrame) / run.frameRate
    const endAt   = run.startCtxTime + (clip.position + durationFrames - run.startFrame) / run.frameRate

    if (endAt <= t) { run.scheduled.add(clip.id); run.sigs.set(clip.id, _clipSig(clip)); continue }  // window already passed
    if (startAt > t + DECODE_AHEAD_S) continue                 // too far out to care yet

    // Warm the decode cache ahead of time so the buffer is ready when due.
    getAudioBuffer(clip.fileId).catch(() => {})

    if (startAt <= t + SCHEDULE_AHEAD_S) {
      run.scheduled.add(clip.id)
      run.sigs.set(clip.id, _clipSig(clip))
      _scheduleClip(clip, run)
    }
  }
}

/** Create + start one clip's source node into its run's subtree. */
function _scheduleClip(clip, run) {
  const ms             = clip.mediaStart ?? 0
  const durationFrames = clip.end - ms
  const offsetFrames   = Math.max(0, run.startFrame - clip.position)  // playhead started inside clip
  const startAt        = run.startCtxTime + Math.max(0, clip.position - run.startFrame) / run.frameRate
  const bufferStart    = (ms + offsetFrames) / run.frameRate
  const playSeconds    = (durationFrames - offsetFrames) / run.frameRate
  if (playSeconds <= 0) return

  getAudioBuffer(clip.fileId).then(buf => {
    // Bail if this run was stopped or superseded while decoding.
    if (_run !== run || !_ctx) return

    const when = Math.max(_ctx.currentTime, startAt)
    const lost = Math.max(0, _ctx.currentTime - startAt)  // time spent decoding past the start
    const dur  = playSeconds - lost
    if (dur <= 0) return

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

/** Fade out and stop every live voice belonging to one clip, then drop them. */
function _retireClipVoices(run, clipId) {
  if (!_ctx) return
  const t      = _ctx.currentTime
  const stopAt = t + VOICE_STOP_S
  run.voices = run.voices.filter(voice => {
    if (voice.clipId !== clipId) return true
    try {
      voice.gain.gain.cancelScheduledValues(t)
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t)
      voice.gain.gain.linearRampToValueAtTime(0, stopAt)
      voice.src.onended = null  // we manage removal here; don't double-splice
      voice.src.stop(stopAt)
      setTimeout(() => { try { voice.src.disconnect(); voice.gain.disconnect() } catch {} }, (VOICE_STOP_S + 0.05) * 1000)
    } catch {}
    return false
  })
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
export function resyncAudioPlayback(clips, playheadFrame, frameRate) {
  const run = _run
  if (!run || !_ctx || run.frameRate !== frameRate) {
    startAudioPlayback(clips, playheadFrame, frameRate)
    return
  }

  const schedulable = clips.filter(clip => {
    if (!clip.fileId) return false
    const ms = clip.mediaStart ?? 0
    const me = clip.end
    return me != null && me > ms
  })
  const nextById = new Map(schedulable.map(c => [c.id, c]))

  // Retire voices + scheduling for clips that were removed or whose timing changed.
  for (const clipId of [...run.scheduled]) {
    const next = nextById.get(clipId)
    if (next && _clipSig(next) === run.sigs.get(clipId)) continue  // unchanged → leave playing
    _retireClipVoices(run, clipId)
    run.scheduled.delete(clipId)
    run.sigs.delete(clipId)
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
