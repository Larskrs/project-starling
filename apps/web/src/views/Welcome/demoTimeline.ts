/**
 * Fixtures for the welcome page's live demos.
 *
 * These are the real editor shapes — `EditorTrack`, `EditorClip`, `Source` —
 * so the demos can mount the real editor components (Ruler, TrackHeader,
 * TrackLane, EditorClip, SourceBar) against them without a server. Nothing here
 * is fetched and nothing is saved: a visitor edits a copy that lives for as long
 * as the tab does.
 *
 * Everything is built by a factory rather than exported as a constant, so the
 * demo's reset button hands back a clean tree instead of a shared object that
 * previous visitors already dragged around.
 */
import type { Timeline } from '../../types/api'
import type { EditorClip, EditorTrack, Source } from '../../types/timeline'

const FPS = 25
/** Frames for a whole number of seconds, at the demo's 25 fps. */
const s = (seconds: number): number => Math.round(seconds * FPS)

const ISO = '2024-01-01T00:00:00.000Z'

export const DEMO_TIMELINE_ID = 'demo-timeline'

/** The one event track bound to a source set — the track SourceBar opens for. */
export const DEMO_SOURCE_TRACK_ID = 'trk-camera'

export function makeDemoTimeline(): Timeline {
  return {
    id:              DEMO_TIMELINE_ID,
    productionId:    'demo-production',
    name:            'Opening Night — Act I',
    profileImageId:  null,
    frameRate:       '25',
    startFrame:      0,
    endFrame:        s(90),
    ltcOffsetFrames: 0,
    createdAt:       ISO,
    updatedAt:       ISO,
  }
}

/** The camera sources bound to the demo's event track — SourceBar's chips. */
export function makeDemoSources(): Source[] {
  const base = {
    productionId: 'demo-production',
    sourceSetId:  'demo-source-set',
    data:         null,
    createdAt:    ISO,
    updatedAt:    ISO,
  }
  return [
    { ...base, id: 'src-wide',     name: 'Wide',      shortName: 'K1', hue: 250, icon: 'mdi:camera-outline' },
    { ...base, id: 'src-close',    name: 'Close-up',  shortName: 'K2', hue: 155, icon: 'mdi:camera-outline' },
    { ...base, id: 'src-follow',   name: 'Follow',    shortName: 'K3', hue:  60, icon: 'mdi:camera-outline' },
    { ...base, id: 'src-audience', name: 'Audience',  shortName: 'K4', hue: 320, icon: 'mdi:camera-outline' },
  ]
}

let _clipSeq = 0

/**
 * A clip in the demo's own shape. `mediaStart`/`end` are the media window that
 * gives clip-mode clips their width; event-mode clips carry only a position and
 * run until the next one, exactly as they do in the editor.
 */
export function makeDemoClip(
  trackId: string,
  fields: Partial<EditorClip> & { position: number },
): EditorClip {
  return {
    id:         `demo-clip-${++_clipSeq}`,
    trackId,
    label:      '',
    fileId:     null,
    mediaStart: null,
    end:        null,
    sourceId:   null,
    data:       null,
    hue:        null,
    createdAt:  ISO,
    updatedAt:  ISO,
    ...fields,
  }
}

/** A clip-mode block: `length` frames of media starting at `position`. */
function block(trackId: string, position: number, length: number, label: string): EditorClip {
  return makeDemoClip(trackId, { position, mediaStart: 0, end: length, label })
}

function track(fields: Partial<EditorTrack> & { id: string; name: string; sortOrder: number }): EditorTrack {
  return {
    timelineId: DEMO_TIMELINE_ID,
    typeId:     `${fields.id}-type`,
    sourceId:   null,
    icon:       null,
    mode:       'clip',
    isMuted:    false,
    isLocked:   false,
    createdAt:  ISO,
    clips:      [],
    ...fields,
  }
}

/**
 * Four tracks, each chosen to show a different track-type behaviour:
 * a ruler strip, an event track bound to a source set, a plain media track and
 * a bordered one with emphasized labels.
 */
export function makeDemoTracks(): EditorTrack[] {
  const scenes = track({
    id: 'trk-scenes', name: 'Scenes', sortOrder: 0,
    mode: 'event', typeName: 'Scene marker', typeHue: 45, typeIcon: 'mdi:script-text-outline',
    typeTrackDisplay: 'ruler',
  })
  scenes.clips = [
    makeDemoClip(scenes.id, { position: s(0),  label: 'Act I' }),
    makeDemoClip(scenes.id, { position: s(21), label: 'Monologue' }),
    makeDemoClip(scenes.id, { position: s(47), label: 'Duet' }),
    makeDemoClip(scenes.id, { position: s(72), label: 'Finale' }),
  ]

  const camera = track({
    id: 'trk-camera', name: 'Camera', sortOrder: 1,
    mode: 'event', typeName: 'Camera cut', typeHue: 250, typeIcon: 'mdi:camera-outline',
    typeNameDisplay: 'emphasize',
  })
  const cuts: Array<[number, string]> = [
    [0, 'src-wide'], [7, 'src-close'], [16, 'src-follow'], [26, 'src-wide'],
    [38, 'src-close'], [51, 'src-audience'], [63, 'src-wide'], [76, 'src-close'],
  ]
  camera.clips = cuts.map(([at, sourceId]) => makeDemoClip(camera.id, { position: s(at), sourceId }))

  const music = track({
    id: 'trk-music', name: 'Music', sortOrder: 2,
    typeName: 'Playback', typeHue: 305, typeIcon: 'mdi:music-note-outline',
  })
  music.clips = [
    block(music.id, s(2),  s(19), 'Overture'),
    block(music.id, s(28), s(17), 'Underscore'),
    block(music.id, s(56), s(28), 'Finale bed'),
  ]

  const lighting = track({
    id: 'trk-lighting', name: 'Lighting', sortOrder: 3,
    typeName: 'Lighting cue', typeHue: 95, typeIcon: 'mdi:lightbulb-on-outline',
    typeClipDisplay: 'border', typeNameDisplay: 'emphasize',
  })
  lighting.clips = [
    block(lighting.id, s(0),  s(11), 'Preset'),
    block(lighting.id, s(19), s(10), 'Warm'),
    block(lighting.id, s(40), s(17), 'Chase'),
    block(lighting.id, s(64), s(20), 'Blackout'),
  ]

  return [scenes, camera, music, lighting]
}

/** Row height per track, matching the editor's own strip/normal split. */
export const DEMO_TRACK_HEIGHTS: Record<string, number> = {
  'trk-scenes':   28,
  'trk-camera':   52,
  'trk-music':    64,
  'trk-lighting': 48,
}
