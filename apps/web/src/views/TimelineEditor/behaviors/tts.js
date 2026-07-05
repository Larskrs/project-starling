import EasySpeech from 'easy-speech'

/**
 * Text-to-speech playback controller for tracks with `tts: true`.
 * Each clip's label is spoken as the playhead enters the clip; an utterance is
 * cut off when its clip ends (so cues stay inside their allotted length).
 * No-ops gracefully where speechSynthesis is unavailable.
 */
export function createCueSpeaker({ clips, fps, }) {
  let timeouts = []
  let current  = null   // utterance currently expected to be speaking


  EasySpeech.init({ maxTimeout: 5000, interval: 250 })
    .then(() => console.debug('load complete'))
    .catch(e => console.error(e))

  const supported = true

  async function speak(clip, remainingMs) {
    let text = (clip.label ?? '').trim()
    if (!text) return

    await EasySpeech.speak({
      text,
      pitch: 0.9,
      rate: 1.25,
      volume: 1.2,
    })
  }

  return {
    start(playheadFrame) {

      for (const clip of clips) {
        const durFrames = Math.max(0, (clip.end ?? 0) - (clip.mediaStart ?? 0))
        const startMs = ((clip.position - playheadFrame) / fps) * 1000
        const endMs   = startMs + (durFrames / fps) * 1000

        if (endMs <= 0) continue

        if (startMs <= 0) {
          speak(clip, endMs).then(() => {
            console.log(clip.label, 'done')
          })
        } else {
          timeouts.push(setTimeout(() => speak(clip, endMs - startMs), startMs))
        }
      }
    },
    stop() {
      for (const t of timeouts) clearTimeout(t)
      timeouts = []
      current  = null
      if (supported) window.speechSynthesis.cancel()
    },
  }
}
