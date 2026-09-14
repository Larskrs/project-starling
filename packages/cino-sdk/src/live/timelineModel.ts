import type { ClipChange, TrackChange, WireClip } from '../protocol.ts';

/** Every field the server sent, as it sent it. */
export type Row = Readonly<Record<string, unknown>>;

/** A clip as held in memory. Frozen: a new object replaces it on every change. */
export interface Clip {
  readonly id: string;
  readonly trackId: string;
  readonly position: number;
  readonly mediaStart: number | null;
  readonly end: number | null;
  readonly label: string | null;
  readonly sourceId: string | null;
  readonly row: Row;
}

export interface Track {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  /** Sorted by position. */
  readonly clips: readonly Clip[];
  readonly row: Row;
}

export interface TrackRow {
  id: string;
  clips?: readonly WireClip[];
  [key: string]: unknown;
}

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toClip(row: Record<string, unknown> & { id: string }, trackId: string): Clip {
  return Object.freeze({
    id:         row.id,
    trackId,
    position:   numberOrNull(row.position) ?? 0,
    mediaStart: numberOrNull(row.mediaStart),
    end:        numberOrNull(row.end),
    label:      stringOrNull(row.label),
    sourceId:   stringOrNull(row.sourceId),
    row:        Object.freeze({ ...row, trackId }),
  });
}

function toTrack(row: Record<string, unknown> & { id: string }, clips: readonly Clip[]): Track {
  const { clips: _nested, ...rest } = row;
  return Object.freeze({
    id:        row.id,
    name:      stringOrNull(row.name) ?? row.id.slice(0, 8),
    sortOrder: numberOrNull(row.sortOrder) ?? 0,
    clips:     Object.freeze([...clips].sort((a, b) => a.position - b.position)),
    row:       Object.freeze(rest),
  });
}

/** The frame a clip stops on by itself, or null when only the next clip ends it. */
export function clipEndFrame(clip: Pick<Clip, 'position' | 'mediaStart' | 'end'>): number | null {
  return clip.end == null ? null : clip.position + (clip.end - (clip.mediaStart ?? 0));
}

/** The clip live at `frame` among clips sorted by position. */
export function liveClipAt(clips: readonly Clip[], frame: number): Clip | null {
  let lo = 0;
  let hi = clips.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clips[mid]!.position <= frame) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (found < 0) return null;
  const clip = clips[found]!;
  const end = clipEndFrame(clip);
  return end != null && frame >= end ? null : clip;
}

export function createTimelineModel() {
  const tracks   = new Map<string, Track>();
  const clipHome = new Map<string, string>();
  let version = 0;
  let ordered: readonly Track[] | null = null;
  let boundaries: number[] | null = null;

  function changed(): void {
    version++;
    ordered = null;
    boundaries = null;
  }

  function putTrack(track: Track): void {
    tracks.set(track.id, track);
    for (const clip of track.clips) clipHome.set(clip.id, track.id);
  }

  function withoutClip(track: Track, clipId: string): Track {
    return toTrack(track.row as TrackRow, track.clips.filter(c => c.id !== clipId));
  }

  return {
    /** Increases on every change. */
    get version(): number { return version; },

    load(rows: readonly TrackRow[]): void {
      tracks.clear();
      clipHome.clear();
      for (const row of rows) putTrack(toTrack(row, (row.clips ?? []).map(c => toClip(c, row.id))));
      changed();
    },

    /** Every track, in the editor's order. */
    tracks(): readonly Track[] {
      ordered ??= Object.freeze([...tracks.values()].sort((a, b) => a.sortOrder - b.sortOrder));
      return ordered;
    },

    track(trackId: string): Track | null {
      return tracks.get(trackId) ?? null;
    },

    clip(clipId: string): Clip | null {
      const trackId = clipHome.get(clipId);
      return (trackId && tracks.get(trackId)?.clips.find(c => c.id === clipId)) || null;
    },

    get clipCount(): number {
      let count = 0;
      for (const track of tracks.values()) count += track.clips.length;
      return count;
    },

    applyClipChange(change: ClipChange): boolean {
      if (change.type === 'remove') {
        const track = tracks.get(clipHome.get(change.clipId) ?? '');
        if (!track?.clips.some(c => c.id === change.clipId)) return false;
        putTrack(withoutClip(track, change.clipId));
        clipHome.delete(change.clipId);
        changed();
        return true;
      }

      const id = change.clip.id;
      const previousHome = clipHome.get(id);
      const previous = previousHome ? tracks.get(previousHome)?.clips.find(c => c.id === id) : undefined;
      // A patch is only the fields that changed. There is nothing to apply one to
      // for a clip never held, and a clip invented from it would have no position.
      if (change.type === 'patch' && !previous) return false;
      // Merged either way: a created row lacks the bootstrap's joined fields, and
      // a patch lacks everything it did not change.
      const row: Record<string, unknown> & { id: string } = { ...(previous?.row ?? {}), ...change.clip, id };
      const trackId = typeof row.trackId === 'string' ? row.trackId : previousHome!;

      if (previousHome && previousHome !== trackId) {
        const old = tracks.get(previousHome);
        if (old) putTrack(withoutClip(old, id));
      }

      const target = tracks.get(trackId);
      if (!target) {
        clipHome.delete(id);
        changed();
        return true;
      }

      putTrack(toTrack(target.row as TrackRow, [...target.clips.filter(c => c.id !== id), toClip(row, trackId)]));
      changed();
      return true;
    },

    applyTrackChange(change: TrackChange): boolean {
      if (change.type === 'remove') {
        const track = tracks.get(change.trackId);
        if (!track) return false;
        for (const clip of track.clips) clipHome.delete(clip.id);
        tracks.delete(change.trackId);
        changed();
        return true;
      }

      if (change.type === 'reorder') {
        let moved = false;
        change.order.forEach((trackId, sortOrder) => {
          const track = tracks.get(trackId);
          if (!track || track.sortOrder === sortOrder) return;
          putTrack(toTrack({ ...track.row, id: track.id, sortOrder }, track.clips));
          moved = true;
        });
        if (moved) changed();
        return moved;
      }

      const existing = tracks.get(change.track.id);
      if (change.type === 'patch' && !existing) return false;
      putTrack(toTrack({ ...(existing?.row ?? {}), ...change.track, id: change.track.id }, existing?.clips ?? []));
      changed();
      return true;
    },

    liveClip(trackId: string, frame: number): Clip | null {
      const track = tracks.get(trackId);
      return track ? liveClipAt(track.clips, frame) : null;
    },

    /** The nearest frame after `frame` at which any track's live clip can change. */
    nextBoundaryAfter(frame: number): number | null {
      if (!boundaries) {
        const all: number[] = [];
        for (const track of tracks.values()) {
          for (const clip of track.clips) {
            all.push(clip.position);
            const end = clipEndFrame(clip);
            if (end != null) all.push(end);
          }
        }
        all.sort((a, b) => a - b);
        boundaries = all.filter((b, i) => i === 0 || b !== all[i - 1]);
      }
      let lo = 0;
      let hi = boundaries.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (boundaries[mid]! <= frame) lo = mid + 1;
        else hi = mid;
      }
      return lo < boundaries.length ? boundaries[lo]! : null;
    },
  };
}

export type TimelineModel = ReturnType<typeof createTimelineModel>;
