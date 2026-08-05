import { getAudioContext, getMasterGain } from '../useAudioEngine'
import type { Clip } from '../../../types/timeline'

const TICK_MS     = 100
const AHEAD_S     = 0.6
const CLICK_LEN_S = 0.03

// Accented downbeat (first beat of each bar) vs regular beat.
const ACCENT = { freq: 1568, gain: 0.75 }   // G6
const BEAT   = { freq: 1046, gain: 0.5 }   // C6

/**
 * Metronome playback controller for tracks with `metronome: true`.
 * Clips carry `data.bpm` (and optional `data.beatsPerBar`, default 4); each
 * clip's tempo applies from its position until the next bpm clip, with the
 * first beat of every bar accented. Silent before the first bpm clip.
 * Clicks route through the master gain so master volume applies.
 */
export interface MetronomeOptions {
  clips: Clip[]
  fps: number
  endFrame: number
}

/** One tempo region: applies from `startSec` until the next segment. */
interface Segment {
  startSec: number
  bpm: number
  beatsPerBar: number
}

/** Ties timeline seconds to the AudioContext clock for the current run. */
interface Anchor {
  ctxTime: number
  playheadSec: number
}

export function createMetronome({ clips, fps, endFrame }: MetronomeOptions) {
  let timer: ReturnType<typeof setInterval> | null = null
  let nodes: OscillatorNode[] = []
  let cursorSec = 0                    // timeline-seconds scheduling cursor
  let anchor: Anchor | null = null

  const segments: Segment[] = clips
    .map(c => ({
      startSec:    c.position / fps,
      bpm:         Number(c.data?.bpm),
      beatsPerBar: Math.max(1, Math.min(12, Number(c.data?.beatsPerBar) || 4)),
    }))
    .filter(s => Number.isFinite(s.bpm) && s.bpm > 0)
    .sort((a, b) => a.startSec - b.startSec)
  const endSec = endFrame / fps

  function* beatsBetween(fromSec: number, toSec: number): Generator<{ t: number; accent: boolean }> {
    for (let i = 0; i < segments.length; i++) {
      const seg      = segments[i]!
      const segEnd   = Math.min(segments[i + 1]?.startSec ?? endSec, toSec)
      if (segEnd <= fromSec || seg.startSec >= toSec) continue
      const interval = 60 / seg.bpm
      const first    = Math.max(0, Math.ceil((fromSec - seg.startSec) / interval - 1e-9))
      for (let k = first; ; k++) {
        const t = seg.startSec + k * interval
        if (t >= segEnd) break
        if (t >= fromSec) yield { t, accent: k % seg.beatsPerBar === 0 }
      }
    }
  }

  function click(atCtxTime: number, accent: boolean): void {
    const ctx   = getAudioContext()
    const tone  = accent ? ACCENT : BEAT
    const osc   = ctx.createOscillator()
    const gain  = ctx.createGain()
    osc.frequency.value = tone.freq
    gain.gain.setValueAtTime(tone.gain, atCtxTime)
    gain.gain.exponentialRampToValueAtTime(0.001, atCtxTime + CLICK_LEN_S)
    osc.connect(gain)
    gain.connect(getMasterGain())
    osc.start(atCtxTime)
    osc.stop(atCtxTime + CLICK_LEN_S + 0.01)
    nodes.push(osc)
    osc.onended = () => { nodes = nodes.filter(n => n !== osc) }
  }

  function tick(): void {
    if (!anchor) return
    const ctx    = getAudioContext()
    const nowSec = anchor.playheadSec + (ctx.currentTime - anchor.ctxTime)
    const toSec  = nowSec + AHEAD_S
    for (const { t, accent } of beatsBetween(Math.max(cursorSec, nowSec), toSec)) {
      click(anchor.ctxTime + (t - anchor.playheadSec), accent)
    }
    cursorSec = toSec
  }

  return {
    start(playheadFrame: number): void {
      if (segments.length === 0) return
      const ctx = getAudioContext()
      anchor    = { ctxTime: ctx.currentTime + 0.08, playheadSec: playheadFrame / fps }
      cursorSec = anchor.playheadSec
      tick()
      timer = setInterval(tick, TICK_MS)
    },
    stop(): void {
      if (timer) { clearInterval(timer); timer = null }
      anchor = null
      for (const osc of nodes) { try { osc.stop() } catch { /* already stopped */ } }
      nodes = []
    },
  }
}
