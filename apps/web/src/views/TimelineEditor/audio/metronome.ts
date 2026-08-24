// Explicit extension: these modules are loaded in bare node by
// behaviors.test.ts, whose type stripping resolves specifiers literally rather
// than probing extensions the way the bundler does.
import {
  getAudioContext, getTrackGain, ctxTimeForFrame, getPlaybackFrame,
} from './useAudioEngine.ts'
import type { Clip } from '../../../types/timeline'
import type { BehaviorStartOptions } from './behaviorTypes'

const TICK_MS     = 100
// The look-ahead has to cover the worst interval the timer can actually be
// woken at, not the nominal 100ms: browsers clamp setInterval to ~1s in a
// background tab, and each tick only schedules beats inside its own window —
// so a 0.6s window silently DROPPED every beat between the end of one window
// and a late tick's `nowSec`. Backgrounding the editor thinned the click out.
// useAudioEngine already learned this for clip scheduling (SCHEDULE_AHEAD_S);
// this is the same reasoning, and the two should move together.
const AHEAD_S     = 1.5
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
  /** Routes the clicks through this track's gain, so its slider covers them. */
  trackId: string
}

/** One tempo region: applies from `startSec` until the next segment. */
interface Segment {
  startSec: number
  bpm: number
  beatsPerBar: number
}

export function createMetronome({ clips, fps, endFrame, trackId }: MetronomeOptions) {
  let timer: ReturnType<typeof setInterval> | null = null
  let nodes: OscillatorNode[] = []
  let cursorSec = 0                    // timeline-seconds scheduling cursor
  let running = false

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
    gain.connect(getTrackGain(trackId))
    osc.start(atCtxTime)
    osc.stop(atCtxTime + CLICK_LEN_S + 0.01)
    nodes.push(osc)
    osc.onended = () => { nodes = nodes.filter(n => n !== osc) }
  }

  /**
   * Both the window and every click's schedule time come from the audio
   * engine's run clock, so the metronome is locked to clip audio by
   * construction — including through the anchor nudges that absorb sync drift.
   */
  function tick(): void {
    if (!running) return

    const nowFrame = getPlaybackFrame()
    if (nowFrame == null) return    // no run, or the context is not running

    const ctx    = getAudioContext()
    const nowSec = nowFrame / fps
    const toSec  = nowSec + AHEAD_S

    for (const { t, accent } of beatsBetween(Math.max(cursorSec, nowSec), toSec)) {
      const at = ctxTimeForFrame(t * fps)
      if (at == null) return        // run ended underneath us
      // A beat inside the output-latency window can no longer be placed on
      // time; clamping is what the clip scheduler does too, and it is only
      // reachable in the first moments of a run.
      click(Math.max(ctx.currentTime, at), accent)
    }
    cursorSec = Math.max(cursorSec, toSec)
  }

  return {
    // The metronome is fully deterministic from the playhead, so a re-time is
    // just a restart — it ignores `resumed`, unlike the cue speaker.
    start(playheadFrame: number, _opts: BehaviorStartOptions = {}): void {
      if (segments.length === 0) return
      // Starting twice without an intervening stop would strand the first
      // interval and run two schedulers against one anchor — every click
      // doubled, and nothing left holding the old timer to clear it.
      if (timer) { clearInterval(timer); timer = null }
      // Prefer the engine's audible position over the visual playhead handed
      // in: they agree, but the engine's is the one every click is placed
      // against, so starting from it removes a rounding seam.
      cursorSec = (getPlaybackFrame() ?? playheadFrame) / fps
      running   = true
      tick()
      timer = setInterval(tick, TICK_MS)
    },
    stop(): void {
      if (timer) { clearInterval(timer); timer = null }
      running = false
      for (const osc of nodes) { try { osc.stop() } catch { /* already stopped */ } }
      nodes = []
    },
  }
}
