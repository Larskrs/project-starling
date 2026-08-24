/**
 * Resolves a track's effective behavior settings (from its track type).
 *
 * The timeline payload joins `typeSettings` onto each track; older cached rows
 * or tracks whose type was deleted fall back to the trackTypes list, then to
 * defaults. Every consumer (lanes, playback, dialogs) goes through this so the
 * shape is always complete.
 */
import type { TrackSettings, TrackType, TrackWithType } from '../../../types/timeline'

const DEFAULTS: TrackSettings = Object.freeze({
  trackDisplay: 'normal',    // effective: 'normal' | 'ruler' | 'bpm' (bpm is metronome-only)
  nameDisplay:  'normal',    // 'normal' | 'stretch' | 'emphasize'
  clipDisplay:  'normal',    // 'normal' | 'zebra' | 'border' | 'transparent'
  metronome:    false,
  tts:          false,
})

export function resolveTrackSettings(
  track: TrackWithType | null | undefined,
  trackTypes: TrackType[] = [],
): TrackSettings {
  const type = trackTypes.find(tt => tt.id === track?.typeId)
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

/**
 * Whether a track can make sound at all.
 *
 * This is a CAPABILITY of the track, not a statement about its current
 * contents: a clip-mode track with no clips in it yet still supports audio, and
 * its control must not flip to a different meaning the moment the last clip is
 * deleted.
 *
 *  - clip mode carries media clips, which is the only kind that holds a file
 *  - metronome tracks generate clicks
 *  - TTS tracks speak their clip labels
 *
 * Everything else — event-mode source tracks, ruler strips — is notation. For
 * those the per-track toggle hides the lane instead of silencing it, which is
 * why the header shows an eye rather than a speaker.
 */
export function trackSupportsAudio(
  track: TrackWithType | null | undefined,
  trackTypes: TrackType[] = [],
): boolean {
  if (!track) return false
  const settings = resolveTrackSettings(track, trackTypes)
  if (settings.metronome || settings.tts) return true
  const type = trackTypes.find(tt => tt.id === track.typeId)
  return (track.mode ?? type?.trackMode) === 'clip'
}
