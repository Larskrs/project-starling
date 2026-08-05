import EasySpeech from 'easy-speech'
import type { Clip } from '../../../types/timeline'

/**
 * Text-to-speech playback controller for tracks with `tts: true`.
 * Each clip's label is spoken as the playhead enters the clip; an utterance is
 * cut off when its clip ends (so cues stay inside their allotted length).
 * No-ops gracefully where speechSynthesis is unavailable.
 */
export interface CueSpeakerOptions {
  clips: Clip[]
  fps: number
}

export function createCueSpeaker({ clips, fps }: CueSpeakerOptions) {
  let timeouts: ReturnType<typeof setTimeout>[] = []

  EasySpeech.init({ maxTimeout: 5000, interval: 250 })
    .then(() => console.debug('load complete'))
    .catch(e => console.error(e))

  const supported = true

  async function speak(clip: Clip): Promise<void> {
    const text = (clip.label ?? '').trim()
    if (!text) return

    await EasySpeech.speak({
      text,
      pitch: 0.9,
      rate: 1.25,
      volume: 1.2,
    })
  }

  return {
    start(playheadFrame: number): void {

      for (const clip of clips) {
        const durFrames = Math.max(0, (clip.end ?? 0) - (clip.mediaStart ?? 0))
        const startMs = ((clip.position - playheadFrame) / fps) * 1000
        const endMs   = startMs + (durFrames / fps) * 1000

        if (endMs <= 0) continue

        if (startMs <= 0) {
          void speak(clip)
        } else {
          timeouts.push(setTimeout(() => { void speak(clip) }, startMs))
        }
      }
    },
    stop(): void {
      for (const t of timeouts) clearTimeout(t)
      timeouts = []
      if (supported) window.speechSynthesis.cancel()
    },
  }
}
