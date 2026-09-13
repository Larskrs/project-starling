/**
 * Editor-side shapes: tracks, clips and the transport state the timeline
 * socket exchanges.
 */

export type TrackMode = 'clip' | 'event'

export interface Track {
  id: string
  timelineId: string
  typeId: string
  sourceId: string | null
  name: string
  /** Overrides the track type's icon for this track alone; null inherits. */
  icon: string | null
  mode: TrackMode
  sortOrder: number
  isMuted: boolean
  isLocked: boolean
  createdAt: string
}

export interface Clip {
  id: string
  trackId: string
  label: string
  /** Absolute frame the clip starts at. */
  position: number
  /** Clip mode: the media window. Null on event-mode clips. */
  fileId: string | null
  mediaStart: number | null
  end: number | null
  /** Event mode: which source this event belongs to. */
  sourceId: string | null
  /** Type-specific payload (BPM lanes, TTS text, …). */
  data: Record<string, unknown> | null
  /** oklch hue 0–360; null inherits the track type's hue. */
  hue: number | null
  createdAt: string
  updatedAt: string
}

/** The visible px window of the editor canvas, in scrollLeft space. */
export interface ViewportRange {
  left: number
  right: number
}

export interface EditorViewport {
  scrollLeft: number
  width: number
}

/** Where playback is, as broadcast on the /timeline socket namespace. */
export interface PlayheadAnchor {
  /** Frame playback was at when the anchor was stamped. */
  frame: number
  /** Server clock reading for that frame, in ms. */
  at: number
  playing: boolean
}

/** Behaviour columns on a track type, and the joined copies on a track row. */
export type TrackDisplay = 'normal' | 'ruler' | 'bpm'
export type NameDisplay  = 'normal' | 'stretch' | 'emphasize'
export type ClipDisplay  = 'normal' | 'zebra' | 'border' | 'transparent'

export interface TrackType {
  id: string
  name: string
  hue: number | null
  icon: string | null
  trackMode: TrackMode
  sourceSetId: string | null
  trackDisplay: TrackDisplay
  nameDisplay: NameDisplay
  clipDisplay: ClipDisplay
  metronome: boolean
  tts: boolean
}

/**
 * A track as the timeline payload delivers it: the row plus its type's
 * behaviour settings joined on, so a client needn't hold the type list.
 */
export interface TrackWithType extends Track {
  typeTrackDisplay?: TrackDisplay | null
  typeNameDisplay?: NameDisplay | null
  typeClipDisplay?: ClipDisplay | null
  typeMetronome?: boolean | null
  typeTts?: boolean | null
}

/** A source within a source set — the pickable takes on a bound track. */
export interface Source {
  id: string
  productionId: string
  sourceSetId: string | null
  name: string
  shortName: string
  hue: number
  icon: string | null
  data: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

/** A clip with the storage file's kind resolved, as the bootstrap sends it. */
export interface EditorClip extends Clip {
  /** 'image' | 'audio', or null when the clip references no file. */
  fileType?: string | null
}

/**
 * A track as the editor holds it: the joined row, its display fields, and its
 * clips. `GET /api/timeline/{id}` joins the type and source columns on; tracks
 * created afterwards get the same treatment client-side (withTypeFields) so the
 * list stays one shape.
 */
export interface EditorTrack extends TrackWithType {
  typeName?: string | null
  typeHue?: number | null
  typeIcon?: string | null
  sourceName?: string | null
  sourceShortName?: string | null
  sourceHue?: number | null
  sourceIcon?: string | null
  clips: EditorClip[]
}

/** The payload of `GET /api/timeline/{tlId}`. */
export interface TimelineBootstrap {
  timeline: import('./api').Timeline
  tracks: EditorTrack[]
  trackTypes: TrackType[]
  sources: Source[]
  /** Whether the caller holds EDIT_TIMELINE. The API enforces it either way. */
  canEdit?: boolean
}

/** The complete, resolved behaviour for one track. */
export interface TrackSettings {
  trackDisplay: TrackDisplay
  nameDisplay: NameDisplay
  clipDisplay: ClipDisplay
  metronome: boolean
  tts: boolean
}
