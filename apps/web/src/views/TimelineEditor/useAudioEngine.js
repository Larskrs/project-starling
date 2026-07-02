/**
 * Singleton audio engine for the timeline editor.
 * - Lazy AudioContext (created on first startPlayback — after user interaction)
 * - Decoded AudioBuffer cache keyed by fileId
 * - A master GainNode for global volume
 * - Per-clip gain nodes with short fades so clip boundaries and seeks don't click
 * - Precise clip scheduling via Web Audio API timing
 *
 * Waveform peaks live in ./useWaveform.js (they reuse getAudioBuffer here).
 */

let _ctx    = null
let _master = null
let _masterVolume = 1

const _bufferPromises = new Map()  // fileId → Promise<AudioBuffer>
const _activeSources  = new Map()  // clipId → { src, gain }

const FADE_S = 0.008   // declick ramp at clip edges (8ms)
const STOP_S = 0.02    // release ramp when stopping/seeking

function getContext() {
  if (!_ctx) {
    _ctx = new AudioContext()
    _master = _ctx.createGain()
    _master.gain.value = _masterVolume
    _master.connect(_ctx.destination)
  }
  return _ctx
}

/** Global playback volume in [0, 1]. */
export function setMasterVolume(v) {
  _masterVolume = Math.max(0, Math.min(1, v))
  if (_master && _ctx) {
    _master.gain.setTargetAtTime(_masterVolume, _ctx.currentTime, 0.01)
  }
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
 * Schedules all audio clips for the given playhead position.
 * Clips already past `playheadFrame` are skipped; a clip the playhead is inside
 * starts from the correct media offset; future clips start at the right time.
 * Each clip gets a short fade in/out to avoid clicks at its edges.
 *
 * @param {Array}  clips          — clip objects with fileId, position, mediaStart, end
 * @param {number} playheadFrame  — current playhead (float)
 * @param {number} frameRate      — timeline fps (number)
 */
export function startAudioPlayback(clips, playheadFrame, frameRate) {
  stopAudioPlayback()
  const ctx = getContext()
  if (ctx.state === 'suspended') ctx.resume()
  const now = ctx.currentTime + 0.02

  for (const clip of clips) {
    if (!clip.fileId) continue
    const ms = clip.mediaStart ?? 0
    const me = clip.end
    if (me == null || me <= ms) continue

    const durationFrames = me - ms
    const clipEndFrame   = clip.position + durationFrames
    if (playheadFrame >= clipEndFrame) continue  // already over

    const delayFrames     = Math.max(0, clip.position - playheadFrame)
    const offsetFrames    = Math.max(0, playheadFrame - clip.position)
    const remainingFrames = durationFrames - offsetFrames
    if (remainingFrames <= 0) continue

    const startAt     = now + delayFrames / frameRate
    const bufferStart = (ms + offsetFrames) / frameRate
    const playSeconds = remainingFrames / frameRate
    const clipId      = clip.id

    getAudioBuffer(clip.fileId).then(buf => {
      // Bail if playback was stopped, or this clip re-scheduled, while decoding.
      if (!_ctx || !_master || _activeSources.has(clipId)) return
      const when = Math.max(_ctx.currentTime, startAt)
      // If decoding overran the clip's whole window, drop it.
      if (when >= startAt + playSeconds) return

      const src  = _ctx.createBufferSource()
      const gain = _ctx.createGain()
      src.buffer = buf
      src.connect(gain)
      gain.connect(_master)

      // Compensate the buffer offset for any time lost to decoding.
      const lost   = Math.max(0, _ctx.currentTime - startAt)
      const offset = bufferStart + lost
      const dur    = Math.max(0, playSeconds - lost)
      if (dur <= 0) return

      const fade = Math.min(FADE_S, dur / 2)
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(1, when + fade)
      gain.gain.setValueAtTime(1, Math.max(when + fade, when + dur - fade))
      gain.gain.linearRampToValueAtTime(0, when + dur)

      src.start(when, offset, dur)
      _activeSources.set(clipId, { src, gain })
      src.onended = () => _activeSources.delete(clipId)
    }).catch(() => {})
  }
}

/** Stop all active sources with a short release fade so seeking doesn't click. */
export function stopAudioPlayback() {
  const ctx = _ctx
  for (const { src, gain } of _activeSources.values()) {
    try {
      if (ctx && gain) {
        const t = ctx.currentTime
        gain.gain.cancelScheduledValues(t)
        gain.gain.setValueAtTime(gain.gain.value, t)
        gain.gain.linearRampToValueAtTime(0, t + STOP_S)
        src.stop(t + STOP_S + 0.005)
      } else {
        src.stop()
      }
    } catch {}
  }
  _activeSources.clear()
}

/** Close and dispose the audio context. Call on component unmount. */
export function destroyAudioEngine() {
  stopAudioPlayback()
  _ctx?.close()
  _ctx    = null
  _master = null
  _bufferPromises.clear()
}
