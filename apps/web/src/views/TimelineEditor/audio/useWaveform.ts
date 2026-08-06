/**
 * Multi-resolution waveform peaks for the timeline editor.
 *
 * A decoded file is reduced once into exactly three levels of min/max peak
 * pairs: 128, 1 024 and 8 192 samples per bin. Rendering picks whichever of the
 * three matches the current zoom (samples-per-pixel), so the sample size only
 * changes at two zoom thresholds instead of micro-adjusting on every zoom step
 * — the drawn waveform stays stable while zooming, and levels stay cacheable.
 *
 * The pyramid is built lazily per file and cached (the "buffer"), and callers
 * read only the bin range covering the visible viewport, so long clips cost the
 * same to draw whether 2 seconds or 2 hours of them are on screen.
 */

import { getAudioBuffer } from './useAudioEngine'

const BASE_BIN     = 128   // samples per bin at the finest level
const LEVEL_FACTOR = 8     // each coarser level merges 8 bins
const NUM_LEVELS   = 3     // exactly three sample sizes: 128 / 1024 / 8192

export interface PeakLevel {
  /** Per-bin minimum sample. */
  min: Float32Array
  /** Per-bin maximum sample. */
  max: Float32Array
  samplesPerBin: number
}

export interface Pyramid {
  sampleRate: number
  /** Seconds. */
  duration: number
  /** Index 0 is the finest level. */
  levels: PeakLevel[]
}

const _pyramids = new Map<string, Promise<Pyramid>>()

/** Returns (and caches) the peak pyramid for a file. */
export function getPeakPyramid(fileId: string): Promise<Pyramid> {
  const cached = _pyramids.get(fileId)
  if (cached) return cached
  const p = getAudioBuffer(fileId)
    .then(buildPyramid)
    .catch((err: unknown) => { _pyramids.delete(fileId); throw err })
  _pyramids.set(fileId, p)
  return p
}

export function clearWaveformCache(): void {
  _pyramids.clear()
}

function buildPyramid(buffer: AudioBuffer): Pyramid {
  // Downmix to mono by averaging channels so stereo files still show one trace.
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  const n  = channels[0]!.length
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

  // Coarser levels: merge LEVEL_FACTOR bins (min-of-mins, max-of-maxes).
  let prev = levels[0]
  for (let l = 1; l < NUM_LEVELS && prev.min.length > 1; l++) {
    const count = Math.ceil(prev.min.length / LEVEL_FACTOR)
    const min = new Float32Array(count)
    const max = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const a   = i * LEVEL_FACTOR
      const end = Math.min(a + LEVEL_FACTOR, prev.min.length)
      let lo = prev.min[a]
      let hi = prev.max[a]
      for (let j = a + 1; j < end; j++) {
        if (prev.min[j] < lo) lo = prev.min[j]
        if (prev.max[j] > hi) hi = prev.max[j]
      }
      min[i] = lo
      max[i] = hi
    }
    const level = { min, max, samplesPerBin: prev.samplesPerBin * LEVEL_FACTOR }
    levels.push(level)
    prev = level
  }

  return { sampleRate: buffer.sampleRate, duration: buffer.duration, levels }
}

/**
 * Picks the level whose bins are just fine enough for the given zoom.
 * `samplesPerPixel` = sampleRate / (pxPerFrame * fps). We choose the coarsest
 * of the three levels that still keeps roughly ≤1 bin per pixel, so the sample
 * size flips only at two zoom thresholds.
 */
export function pickLevel(pyramid: Pyramid, samplesPerPixel: number): number {
  const { levels } = pyramid
  let idx = 0
  for (let i = 0; i < levels.length; i++) {
    if (levels[i]!.samplesPerBin <= samplesPerPixel) idx = i
    else break
  }
  return idx
}
