/**
 * Shared contract for the behaviour controllers (metronome, TTS) that
 * usePlayback drives alongside clip audio.
 */

export interface BehaviorStartOptions {
  /**
   * True when this start is a RE-TIME of a run that is already sounding, rather
   * than a fresh play or seek.
   *
   * usePlayback rebuilds its controllers from scratch whenever the transport
   * drifts off the server anchor — up to twice a second while converging — so
   * `start()` is called constantly during ordinary playback. Controllers whose
   * output is deterministic from the playhead (the metronome) can ignore this
   * and simply restart. Controllers that FIRE something once on entry (a spoken
   * cue) must not fire it again for a clip the playhead is already inside, or
   * every convergence tick re-triggers it.
   */
  resumed?: boolean
}

export interface BehaviorController {
  start: (playheadFrame: number, opts?: BehaviorStartOptions) => void
  stop: () => void
}
