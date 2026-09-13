/**
 * The timeline's tracks and clips, held in memory.
 *
 * Built from the REST bootstrap and kept current from `clip:change` and
 * `track:change`, so the scheduler can work out where every clip boundary is
 * without asking anyone. Only what timing needs is kept.
 *
 * Clip windows follow the web editor's rules exactly, so this client and
 * everyone in the editor agree about what is live:
 * - a clip is active from its `position`;
 * - with an `end`, it lasts `end − mediaStart` frames (a null mediaStart is 0);
 * - without an `end`, it lasts until the next clip on the track;
 * - between clips, nothing is active.
 */
import type { ClipChange, TrackChange, WireClip } from '@starling/realtime';

export interface ModelClip {
  id:         string;
  trackId:    string;
  position:   number;
  mediaStart: number | null;
  end:        number | null;
  label:      string | null;
  sourceId:   string | null;
}

export interface ModelTrack {
  id:    string;
  name:  string;
  clips: ModelClip[];   // sorted by position
}

/** A track as the bootstrap returns it. */
export interface BootstrapTrack {
  id:     string;
  name:   string;
  clips?: WireClip[];
}

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toClip(raw: WireClip, trackId: string): ModelClip {
  return {
    id:         raw.id,
    trackId,
    position:   Number(raw.position),
    mediaStart: numberOrNull(raw.mediaStart),
    end:        numberOrNull(raw.end),
    label:      stringOrNull(raw.label),
    sourceId:   stringOrNull(raw.sourceId),
  };
}

/** Frame at which a clip stops on its own, or null when only the next clip ends it. */
export function clipEndFrame(clip: ModelClip): number | null {
  return clip.end == null ? null : clip.position + (clip.end - (clip.mediaStart ?? 0));
}

export function createTimelineModel() {
  const tracks = new Map<string, ModelTrack>();

  const sort = (track: ModelTrack) => track.clips.sort((a, b) => a.position - b.position);

  return {
    /** Replace everything with a fresh bootstrap. */
    load(rows: BootstrapTrack[]): void {
      tracks.clear();
      for (const row of rows) {
        const track: ModelTrack = { id: row.id, name: row.name, clips: (row.clips ?? []).map(c => toClip(c, row.id)) };
        sort(track);
        tracks.set(track.id, track);
      }
    },

    tracks(): ModelTrack[] {
      return [...tracks.values()];
    },

    hasTrack(trackId: string): boolean {
      return tracks.has(trackId);
    },

    trackName(trackId: string): string | null {
      return tracks.get(trackId)?.name ?? null;
    },

    get clipCount(): number {
      let n = 0;
      for (const track of tracks.values()) n += track.clips.length;
      return n;
    },

    applyClipChange(change: ClipChange): void {
      if (change.type === 'remove') {
        const track = tracks.get(change.trackId);
        if (track) track.clips = track.clips.filter(c => c.id !== change.clipId);
        return;
      }
      // An upsert can move a clip between tracks, so drop it wherever it was.
      for (const track of tracks.values()) track.clips = track.clips.filter(c => c.id !== change.clip.id);
      const track = tracks.get(change.trackId);
      if (!track) return;   // a track we have not fetched; the next bootstrap brings it
      track.clips.push(toClip(change.clip, change.trackId));
      sort(track);
    },

    applyTrackChange(change: TrackChange): void {
      if (change.type === 'remove') { tracks.delete(change.trackId); return; }
      if (change.type === 'reorder') return;   // display order has no bearing on timing
      const existing = tracks.get(change.track.id);
      const name = stringOrNull(change.track.name) ?? existing?.name ?? change.track.id.slice(0, 8);
      tracks.set(change.track.id, { id: change.track.id, name, clips: existing?.clips ?? [] });
    },

    /** The clip live on a track at `frame`, or null. */
    activeAt(trackId: string, frame: number): ModelClip | null {
      const track = tracks.get(trackId);
      if (!track) return null;
      let active: ModelClip | null = null;
      for (const clip of track.clips) {
        if (clip.position > frame) break;
        active = clip;
      }
      if (!active) return null;
      const end = clipEndFrame(active);
      return end != null && frame >= end ? null : active;
    },

    /** The nearest frame after `frame` where any track's active clip can change. */
    nextBoundaryAfter(frame: number): number | null {
      let next: number | null = null;
      const consider = (b: number | null) => {
        if (b != null && b > frame && (next === null || b < next)) next = b;
      };
      for (const track of tracks.values()) {
        for (const clip of track.clips) {
          consider(clip.position);
          consider(clipEndFrame(clip));
        }
      }
      return next;
    },
  };
}

export type TimelineModel = ReturnType<typeof createTimelineModel>;
