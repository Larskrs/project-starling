/**
 * Singleton audio engine for the timeline editor.
 * - Lazy AudioContext (created on first startPlayback — after user interaction)
 * - Decoded AudioBuffer cache keyed by fileId
 * - Waveform peak cache keyed by fileId
 * - Precise clip scheduling via Web Audio API timing
 */

let _ctx = null
const _bufferPromises = new Map()  // fileId → Promise<AudioBuffer>
const _waveformCache  = new Map()  // fileId → Float32Array of peaks
const _activeSources  = new Map()  // clipId → AudioBufferSourceNode

function getContext() {
  if (!_ctx) _ctx = new AudioContext()
  return _ctx
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
 * Returns an array of `numPoints` peak-amplitude values covering the entire
 * audio file.  Index 0 = file start, index (numPoints-1) = file end.
 */
export async function getWaveformPeaks(fileId, numPoints = 1500) {
  const key = `${fileId}:${numPoints}`
  if (_waveformCache.has(key)) return _waveformCache.get(key)

  const buffer = await getAudioBuffer(fileId)
  const channel   = buffer.getChannelData(0)
  const blockSize = Math.ceil(channel.length / numPoints)
  const peaks     = new Float32Array(numPoints)

  for (let i = 0; i < numPoints; i++) {
    const start = i * blockSize
    const end   = Math.min(start + blockSize, channel.length)
    let max = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j])
      if (v > max) max = v
    }
    peaks[i] = max
  }

  _waveformCache.set(key, peaks)
  return peaks
}

/**
 * Schedules all audio clips for the given playhead position.
 * Clips already past `playheadFrame` are skipped.
 * Clips currently active play from the correct media offset.
 * Future clips are scheduled to start at the correct wall-clock time.
 *
 * @param {Array}  clips          — flat array of clip objects with fileId, position, mediaStart, end
 * @param {number} playheadFrame  — current playhead (float)
 * @param {number} frameRate      — timeline fps (number)
 */
export function startAudioPlayback(clips, playheadFrame, frameRate) {
  stopAudioPlayback()
  const ctx = getContext()
  if (ctx.state === 'suspended') ctx.resume()
  const now = ctx.currentTime

  for (const clip of clips) {
    if (!clip.fileId) continue
    const ms = clip.mediaStart ?? 0
    const me = clip.end
    if (me == null || me <= ms) continue

    const durationFrames  = me - ms
    const clipEndFrame    = clip.position + durationFrames
    if (playheadFrame >= clipEndFrame) continue  // already over

    const delayFrames     = Math.max(0, clip.position - playheadFrame)
    const offsetFrames    = Math.max(0, playheadFrame - clip.position)
    const remainingFrames = durationFrames - offsetFrames

    const clipId = clip.id
    getAudioBuffer(clip.fileId).then(buf => {
      if (!_activeSources.has(clipId) && _ctx) {
        const src = _ctx.createBufferSource()
        src.buffer = buf
        src.connect(_ctx.destination)
        src.start(
          now + delayFrames / frameRate,
          (ms + offsetFrames) / frameRate,
          remainingFrames / frameRate,
        )
        _activeSources.set(clipId, src)
        src.onended = () => _activeSources.delete(clipId)
      }
    }).catch(() => {})
  }
}

/** Stop all currently active audio source nodes. */
export function stopAudioPlayback() {
  for (const src of _activeSources.values()) {
    try { src.stop() } catch {}
  }
  _activeSources.clear()
}

/** Close and dispose the audio context. Call on component unmount. */
export function destroyAudioEngine() {
  stopAudioPlayback()
  _ctx?.close()
  _ctx = null
  _bufferPromises.clear()
  _waveformCache.clear()
}
