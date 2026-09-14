/**
 * Decides when a timeline has cut to a different camera.
 *
 * Pure, so the interesting behaviour can be tested without a server or a socket.
 * Everything stateful about the client lives in index.ts.
 */
import type { ClipEvent } from 'cino-sdk';

/** The fields of the SDK's `clip` event this watcher needs. */
export interface ActiveClip {
  track: Pick<ClipEvent['track'], 'id'>;
  clip: Pick<NonNullable<ClipEvent['clip']>, 'label' | 'sourceId'> | null;
  frame: number;
}

export interface CameraCut {
  trackId: string;
  trackName: string;
  /** The camera we were on, or null at the start of a session. */
  from: string | null;
  to: string;
  /** Clip label, which is usually the cue name. */
  label: string | null;
  frame: number;
}

export interface CameraWatchOptions {
  trackName(trackId: string): string;
  /** Display name for a source, or null when the id is unknown. */
  cameraName(sourceId: string): string | null;
}

export interface CameraWatch {
  /** A cut worth printing, or null when nothing changed. */
  observe(event: ActiveClip): CameraCut | null;
  /** Forget everything — call on reconnect, since the gap was unobserved. */
  reset(): void;
}

export function createCameraWatch(options: CameraWatchOptions): CameraWatch {
  // trackId → the camera we last reported on that track. Per track, because a
  // programme feed and a preview feed cut independently and each deserves its
  // own line.
  const current = new Map<string, string>();

  return {
    observe({ track, clip, frame }: ActiveClip): CameraCut | null {
      const sourceId = clip?.sourceId;

      // A clip with no source is not a camera, and neither is a gap between
      // clips. Both are IGNORED rather than remembered: treating a gap as a
      // change would print twice per cut, and returning to the same camera
      // after a gap is not a cut to a different camera.
      if (!sourceId) return null;

      const previous = current.get(track.id) ?? null;
      if (previous === sourceId) return null;   // a new clip on the same camera

      current.set(track.id, sourceId);

      return {
        trackId:   track.id,
        trackName: options.trackName(track.id),
        from:      previous ? options.cameraName(previous) : null,
        to:        options.cameraName(sourceId) ?? sourceId,
        label:     clip.label,
        frame,
      };
    },

    reset(): void {
      current.clear();
    },
  };
}
