/**
 * Resolves a track's effective behavior settings (from its track type).
 *
 * The timeline payload joins `typeSettings` onto each track; older cached rows
 * or tracks whose type was deleted fall back to the trackTypes list, then to
 * defaults. Every consumer (lanes, playback, dialogs) goes through this so the
 * shape is always complete.
 */
const DEFAULTS = Object.freeze({
  trackDisplay: 'normal',    // effective: 'normal' | 'ruler' | 'bpm' (bpm is metronome-only)
  nameDisplay:  'normal',    // 'normal' | 'stretch' | 'emphasize'
  clipDisplay:  'normal',    // 'normal' | 'zebra' | 'border' | 'transparent'
  metronome:    false,
  tts:          false,
})

export function resolveTrackSettings(track, trackTypes = []) {
  const type      = trackTypes.find?.(tt => tt.id === track?.typeId)
  const metronome = track?.typeMetronome ?? type?.metronome ?? DEFAULTS.metronome
  return {
    // Metronome overrides the configured display: those tracks always render
    // the dedicated BPM strip (beat/bar lines), whatever the type says.
    trackDisplay: metronome
      ? 'bpm'
      : (track?.typeTrackDisplay ?? type?.trackDisplay ?? DEFAULTS.trackDisplay),
    nameDisplay:  track?.typeNameDisplay ?? type?.nameDisplay ?? DEFAULTS.nameDisplay,
    clipDisplay:  track?.typeClipDisplay ?? type?.clipDisplay ?? DEFAULTS.clipDisplay,
    metronome,
    tts:          track?.typeTts ?? type?.tts ?? DEFAULTS.tts,
  }
}

/** Height (px) of ruler-display tracks — slim, header-like, not resizable. */
export const RULER_TRACK_HEIGHT = 28

/** Height (px) of metronome (BPM strip) tracks — room for bar lines + labels. */
export const BPM_TRACK_HEIGHT = 36

/** Current BPM at a playhead position, from a metronome track's clips. */
export function bpmAtFrame(clips, frame) {
  let bpm = null
  for (const clip of clips) {
    if (clip.position > frame) break
    const v = Number(clip.data?.bpm)
    if (Number.isFinite(v) && v > 0) bpm = v
  }
  return bpm
}
