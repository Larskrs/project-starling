/**
 * Track type presets — file-based catalogue served to the UI so new track
 * types can be created pre-configured. `settings` maps 1:1 onto the
 * track_types columns the create route writes.
 *
 * `supportsCameraSet` marks presets where the create-from-preset route may
 * also build a source set of cameras (hues spread evenly around the wheel).
 */

export interface TrackTypePresetSettings {
  hue: number;
  trackMode: 'event' | 'clip';
  trackDisplay: 'normal' | 'ruler';
  nameDisplay: 'normal' | 'stretch' | 'emphasize';
  clipDisplay: 'normal' | 'zebra' | 'border' | 'transparent';
  metronome: boolean;
  tts: boolean;
}

export interface TrackTypePreset {
  id: string;
  name: string;
  description: string;
  supportsCameraSet?: boolean;
  settings: TrackTypePresetSettings;
}

export const trackTypePresets: TrackTypePreset[] = [
  {
    id: 'camera',
    name: 'Camera',
    description: 'Camera cut tracks. Can create a camera source set with evenly spread colours.',
    supportsCameraSet: true,
    settings: {
      hue: 220, trackMode: 'clip',
      trackDisplay: 'normal', nameDisplay: 'normal', clipDisplay: 'normal',
      metronome: false, tts: false,
    },
  },
  {
    id: 'script',
    name: 'Script',
    description: 'Dialogue and manuscript clips, read aloud during playback.',
    settings: {
      hue: 40, trackMode: 'clip',
      trackDisplay: 'normal', nameDisplay: 'stretch', clipDisplay: 'normal',
      metronome: false, tts: true,
    },
  },
  {
    id: 'music',
    name: 'Music',
    description: 'Music cues with metronome support — clips carry the BPM.',
    settings: {
      hue: 140, trackMode: 'clip',
      trackDisplay: 'normal', nameDisplay: 'normal', clipDisplay: 'zebra',
      metronome: true, tts: false,
    },
  },
  {
    id: 'ruler',
    name: 'Ruler',
    description: 'Slim pinned strip for rundown markers and section boundaries.',
    settings: {
      hue: 250, trackMode: 'event',
      trackDisplay: 'ruler', nameDisplay: 'emphasize', clipDisplay: 'normal',
      metronome: false, tts: false,
    },
  },
  {
    id: 'graphics',
    name: 'Graphics',
    description: 'Overlay and graphics events rendered with an outlined clip body.',
    settings: {
      hue: 300, trackMode: 'event',
      trackDisplay: 'normal', nameDisplay: 'normal', clipDisplay: 'border',
      metronome: false, tts: false,
    },
  },
];

export function getTrackTypePreset(id: string): TrackTypePreset | undefined {
  return trackTypePresets.find((p) => p.id === id);
}
