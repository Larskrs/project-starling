/**
 * Decides when a timeline has cut to a different camera.
 *
 * Pure, so the interesting behaviour can be tested without a server or a socket.
 * Everything stateful about the client lives in index.ts.
 */

/** The fields of `clip:active` this watcher needs. */
export interface ActiveClip {
  trackId: string;
  clipId: string | null;
  label: string | null;
  sourceId: string | null;
  frame: number;
  at: number;
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
    observe(event: ActiveClip): CameraCut | null {
      const { sourceId } = event;

      // A clip with no source is not a camera, and neither is a gap between
      // clips. Both are IGNORED rather than remembered: treating a gap as a
      // change would print twice per cut, and returning to the same camera
      // after a gap is not a cut to a different camera.
      if (!sourceId) return null;

      const previous = current.get(event.trackId) ?? null;
      if (previous === sourceId) return null;   // a new clip on the same camera

      current.set(event.trackId, sourceId);

      return {
        trackId:   event.trackId,
        trackName: options.trackName(event.trackId),
        from:      previous ? options.cameraName(previous) : null,
        to:        options.cameraName(sourceId) ?? sourceId,
        label:     event.label,
        frame:     event.frame,
      };
    },

    reset(): void {
      current.clear();
    },
  };
}

/**
 * Frame number → `HH:MM:SS:FF`.
 *
 * Rounds the frame first: a playing timeline's position is derived from a clock,
 * so it arrives fractional, and truncating would show the frame before the one
 * that actually triggered the cut.
 */
export function formatTimecode(frame: number, frameRate: number): string {
  const fps = Math.max(1, Math.round(frameRate));
  const total = Math.max(0, Math.round(frame));

  const frames  = total % fps;
  const seconds = Math.floor(total / fps) % 60;
  const minutes = Math.floor(total / (fps * 60)) % 60;
  const hours   = Math.floor(total / (fps * 3600));

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}
