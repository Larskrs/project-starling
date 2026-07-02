/**
 * Multi-resolution waveform peaks for the timeline editor.
 *
 * A decoded file is reduced once into a mip-pyramid of min/max peak pairs:
 * level 0 is the finest (BASE_BIN samples per point), each subsequent level
 * halves the resolution. Rendering picks the level that matches the current
 * zoom (samples-per-pixel), so we sample the waveform at a quality appropriate
 * to how much the user can actually see — coarse when zoomed out, detailed when
 * zoomed in — without ever re-scanning the raw samples.
 *
 * The pyramid is built lazily per file and cached (the "buffer"), and callers
 * read only the bin range covering the visible viewport, so long clips cost the
 * same to draw whether 2 seconds or 2 hours of them are on screen.
 */

import { getAudioBuffer } from './useAudioEngine.js'

const BASE_BIN = 128    // samples per point at the finest level
const MIN_BINS = 512    // stop coarsening once a level is this small

const _pyramids = new Map()   // fileId → Promise<Pyramid>

/**
 * @typedef {Object} PeakLevel
 * @property {Float32Array} min           per-bin minimum sample
 * @property {Float32Array} max           per-bin maximum sample
 * @property {number}       samplesPerBin
 *
 * @typedef {Object} Pyramid
 * @property {number}       sampleRate
 * @property {number}       duration       seconds
 * @property {PeakLevel[]}  levels         index 0 = finest
 */

/** Returns (and caches) the peak pyramid for a file. */
export function getPeakPyramid(fileId) {
  if (!_pyramids.has(fileId)) {
    const p = getAudioBuffer(fileId)
      .then(buildPyramid)
      .catch(err => { _pyramids.delete(fileId); throw err })
    _pyramids.set(fileId, p)
  }
  return _pyramids.get(fileId)
}

export function clearWaveformCache() {
  _pyramids.clear()
}

function buildPyramid(buffer) {
  // Downmix to mono by averaging channels so stereo files still show one trace.
  const channels = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  const n  = channels[0].length
  const nc = channels.length

  const baseCount = Math.max(1, Math.ceil(n / BASE_BIN))
  const min0 = new Float32Array(baseCount)
  const max0 = new Float32Array(baseCount)

  for (let b = 0; b < baseCount; b++) {
    const start = b * BASE_BIN
    const end   = Math.min(start + BASE_BIN, n)
    let lo = Infinity
    let hi = -Infinity
    for (let i = start; i < end; i++) {
      let v = channels[0][i]
      for (let c = 1; c < nc; c++) v += channels[c][i]
      v /= nc
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min0[b] = lo === Infinity ? 0 : lo
    max0[b] = hi === -Infinity ? 0 : hi
  }

  const levels = [{ min: min0, max: max0, samplesPerBin: BASE_BIN }]

  // Coarser levels: merge each pair of bins (min-of-mins, max-of-maxes).
  let prev = levels[0]
  while (prev.min.length > MIN_BINS) {
    const count = Math.ceil(prev.min.length / 2)
    const min = new Float32Array(count)
    const max = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const a = i * 2
      const b = a + 1
      let lo = prev.min[a]
      let hi = prev.max[a]
      if (b < prev.min.length) {
        if (prev.min[b] < lo) lo = prev.min[b]
        if (prev.max[b] > hi) hi = prev.max[b]
      }
      min[i] = lo
      max[i] = hi
    }
    const level = { min, max, samplesPerBin: prev.samplesPerBin * 2 }
    levels.push(level)
    prev = level
  }

  return { sampleRate: buffer.sampleRate, duration: buffer.duration, levels }
}

/**
 * Picks the level whose bins are just fine enough for the given zoom.
 * `samplesPerPixel` = sampleRate / (pxPerFrame * fps). We choose the coarsest
 * level that still keeps roughly ≤1 bin per pixel, so we draw the least data
 * that looks crisp at this zoom.
 */
export function pickLevel(pyramid, samplesPerPixel) {
  const { levels } = pyramid
  let idx = 0
  for (let i = 0; i < levels.length; i++) {
    if (levels[i].samplesPerBin <= samplesPerPixel) idx = i
    else break
  }
  return idx
}
