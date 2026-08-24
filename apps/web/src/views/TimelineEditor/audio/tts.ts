import EasySpeech from 'easy-speech'
// Explicit extension: these modules are loaded in bare node by
// behaviors.test.ts, whose type stripping resolves specifiers literally rather
// than probing extensions the way the bundler does.
import { getPlaybackFrame, getTrackVolume } from './useAudioEngine.ts'
import type { Clip } from '../../../types/timeline'
import type { BehaviorStartOptions } from './behaviorTypes'

/**
 * Text-to-speech playback controller for tracks with `tts: true`.
 *
 * Each clip's label is spoken as the playhead enters the clip, and the
 * utterance is cut off when the clip ends so a long label can't run over the
 * next cue.
 *
 * The thing to understand before changing anything here: usePlayback does NOT
 * keep one speaker for the length of a run. `_startBehaviors` throws the
 * controllers away and builds new ones on every re-time — and a re-time happens
 * whenever the transport drifts a frame off the server anchor, which is up to
 * twice a second while converging. So `start()` is called constantly on a run
 * that is, to the listener, just playing normally.
 *
 * That is why `start()` takes `resumed`. A re-time must re-arm the cues that
 * are still ahead WITHOUT re-announcing the one the playhead is already sitting
 * inside — announcing it again on every convergence tick is what made cues
 * stutter and stack on top of each other. A genuine play or seek still speaks
 * the cue you land inside, because there you have not heard it yet.
 *
 * Cues fire off the AUDIO engine's run clock, polled — not off wall-clock
 * timers. Speech cannot be sample-scheduled the way an oscillator can, so the
 * poll interval is the accuracy floor; but deriving the trigger from the same
 * clock as clip audio means a cue cannot DRIFT from the mix, and it follows
 * seeks and sync nudges for free. Wall-clock timeouts did neither.
 */
export interface CueSpeakerOptions {
  clips: Clip[]
  /**
   * Whose level the utterances take. Speech cannot be routed through the Web
   * Audio graph, so the track's gain is applied to the utterance's own volume
   * instead of a node — the closest equivalent the platform offers.
   */
  trackId: string
}

// ── Engine ────────────────────────────────────────────────────────────────
// Init runs once per page, not once per controller. It used to run in the
// factory, so every re-time kicked off another init against the same global
// speechSynthesis while utterances were still in flight.

/** The slice of easy-speech this module uses. */
export interface SpeechEngine {
  init: (opts: { maxTimeout: number; interval: number }) => Promise<unknown>
  speak: (opts: { text: string; pitch: number; rate: number; volume: number }) => Promise<unknown>
}

// Indirected rather than called directly so the behaviour above can be tested
// without a real speech synthesiser — this module having no seam is precisely
// why it had no tests, and why its bugs went unnoticed.
let _engine: SpeechEngine = EasySpeech as unknown as SpeechEngine

let _initPromise: Promise<unknown> | null = null
let _initFailed = false

/** True when the browser actually exposes speech synthesis. */
export function isSpeechAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis !== 'undefined'
    && typeof window.SpeechSynthesisUtterance !== 'undefined'
}

function ensureInit(): Promise<unknown> | null {
  if (!isSpeechAvailable() || _initFailed) return null
  if (!_initPromise) {
    _initPromise = _engine.init({ maxTimeout: 5000, interval: 250 })
      .catch((err: unknown) => {
        // Voices never arrived (headless, or a locked-down browser). Remember
        // it so every later cue no-ops instead of retrying the same 5s wait.
        _initFailed  = true
        _initPromise = null
        throw err
      })
  }
  return _initPromise
}

/** Test seam — swap the speech backend and start from a clean init state. */
export function _setSpeechEngineForTest(engine: SpeechEngine): void {
  _engine      = engine
  _initPromise = null
  _initFailed  = false
}

/** How often the run clock is checked for cues that have come due. */
const POLL_MS = 50

export function createCueSpeaker({ clips, trackId }: CueSpeakerOptions) {
  let timer: ReturnType<typeof setInterval> | null = null

  /** Cues in timeline order, and how far through them the run has got. */
  let queue: { clip: Clip; endFrame: number | null }[] = []
  let next = 0

  /** End frame of the cue currently speaking, so it can be cut at its window. */
  let speakingUntil: number | null = null

  /**
   * Bumped by every stop() and start(). An utterance that was waiting on init
   * checks it before speaking, so a cue queued against a superseded run can't
   * surface a beat later on top of the current one.
   */
  let generation = 0

  function cancelSpeech(): void {
    if (!isSpeechAvailable()) return
    try { window.speechSynthesis.cancel() } catch { /* not available after all */ }
  }

  function stopPolling(): void {
    if (timer) { clearInterval(timer); timer = null }
  }

  /** Speak one cue. Cutting it off at its window is the poll's job. */
  async function speak(clip: Clip, gen: number): Promise<void> {
    const text = (clip.label ?? '').trim()
    if (!text) return

    const init = ensureInit()
    if (!init) return
    try { await init } catch { return }
    if (gen !== generation) return   // stopped or re-timed while we waited

    try {
      // volume is 0-1 per the Web Speech spec; this used to pass 1.2, which is
      // out of range and is rejected outright by some engines.
      await _engine.speak({ text, pitch: 0.9, rate: 1.25, volume: getTrackVolume(trackId) })
    } catch {
      /* cancelled by a stop or a window cut, or no voice could be resolved */
    } finally {
      if (gen === generation) speakingUntil = null
    }
  }

  /**
   * One step of the run clock. Fires every cue the playhead has reached since
   * the last check, and cuts an utterance that has outlived its clip.
   */
  function poll(): void {
    const frame = getPlaybackFrame()
    if (frame == null) return   // no run, or the context is not running

    if (speakingUntil != null && frame >= speakingUntil) {
      speakingUntil = null
      cancelSpeech()
    }

    while (next < queue.length && queue[next]!.clip.position <= frame) {
      const { clip, endFrame } = queue[next]!
      next++
      speakingUntil = endFrame
      void speak(clip, generation)
    }
  }

  return {
    /**
     * Arm every cue at or after `playheadFrame`.
     *
     * `resumed: true` marks a re-time of a run that is already sounding - see
     * the note at the top of this file.
     */
    start(playheadFrame: number, { resumed = false }: BehaviorStartOptions = {}): void {
      const gen = ++generation
      stopPolling()
      speakingUntil = null

      // The engine's audible position is the one cues are compared against, so
      // build the queue from it rather than the visual playhead when we can.
      const from = getPlaybackFrame() ?? playheadFrame

      queue = clips
        .map(clip => {
          const durFrames = Math.max(0, (clip.end ?? 0) - (clip.mediaStart ?? 0))
          return { clip, endFrame: durFrames > 0 ? clip.position + durFrames : null }
        })
        .filter(({ clip, endFrame }) =>
          // Drop cues entirely behind the playhead. Event-mode cues have no
          // window, so for them "past" is simply a start before now.
          endFrame != null ? endFrame > from : clip.position >= from,
        )
        .sort((a, b) => a.clip.position - b.clip.position)
      next = 0

      // A cue the playhead is already inside: speak it on a fresh play or seek,
      // never on a re-time - that repeat is what stacked utterances.
      while (next < queue.length && queue[next]!.clip.position <= from) {
        const entry = queue[next]!
        next++
        if (resumed) continue
        speakingUntil = entry.endFrame
        void speak(entry.clip, gen)
      }

      timer = setInterval(poll, POLL_MS)
    },

    stop(): void {
      generation++
      stopPolling()
      speakingUntil = null
      cancelSpeech()
    },
  }
}
