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

/** The complete, resolved behaviour for one track. */
export interface TrackSettings {
  trackDisplay: TrackDisplay
  nameDisplay: NameDisplay
  clipDisplay: ClipDisplay
  metronome: boolean
  tts: boolean
}
