/**
 * Decides exactly when the clip under the playhead changes, on this process's
 * own estimate of the server clock — instead of waiting to be told.
 *
 * The server does send `clip:active`, but only once its own boundary timer has
 * fired, so it reaches a device late by that timer plus the network: a frame or
 * two on a good connection, more over long-polling. A device that must act ON
 * the frame has to know in advance, and it can: it holds every clip
 * (timelineModel.ts), the room's anchor, and the server's time (serverClock.ts).
 * The next boundary is arithmetic.
 *
 * Two loops:
 * - `tick()`, every TICK_MS, reads the clock, announces whatever is active now —
 *   which covers joining mid-clip, seeks, edits under the playhead, and a
 *   boundary a stalled event loop let slip past — and finds the next boundary;
 * - once that boundary is under two ticks away, a one-shot timer is armed for
 *   exactly the milliseconds left. Arming late keeps the timer short, so a clock
 *   correction cannot build up inside it.
 *
 * The anchor is kept exactly as it arrived and read through the clock on every
 * tick. Converting its server stamp to local time once would freeze whatever
 * error the clock had at that moment into every cut that follows.
 *
 * Pure apart from the injected clock and timers, so it runs under test with both
 * faked — see clipScheduler.test.ts.
 */
import type { ActiveClip } from './cameraWatch.ts';
import type { TimelineModel } from './timelineModel.ts';

export const TICK_MS = 20;

/** The room's transport, as `transport:state` carries it. */
export interface TransportAnchor {
  playing:   boolean;
  frame:     number;
  frameRate: number;
  /** SERVER clock reading at which the playhead was at `frame`. */
  at:        number;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ClipSchedulerOptions {
  model: TimelineModel;
  /** The server's clock right now, or null while it has not been measured. */
  serverNow: () => number | null;
  /**
   * The active clip changed on a track. `onBoundary` is true when this is the
   * armed timer landing on a boundary — a timing claim — and false for a
   * catch-up: joining mid-clip, a seek, an edit, or a boundary noticed late.
   */
  onActive: (event: ActiveClip, onBoundary: boolean) => void;
  /** Announce this many ms before the boundary: the latency of whatever acts on it. */
  leadMs?: number;
  timers?: Timers;
}

const realTimers: Timers = {
  setTimeout:   (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createClipScheduler({
  model, serverNow, onActive, leadMs = 0, timers = realTimers,
}: ClipSchedulerOptions) {
  let transport: TransportAnchor | null = null;
  const announced = new Map<string, string>();   // trackId → live clipId; absent means nothing live
  let armed: { boundary: number; handle: unknown } | null = null;

  // The boundary the timer last landed on. The timer fires `leadMs` early, and
  // a clock glide can leave the playhead a hair short of it, so until the
  // playhead really arrives the tick reads the timeline AT that boundary —
  // otherwise it would see the previous clip and cut straight back.
  let landed: number | null = null;

  const frameAt = (anchor: TransportAnchor, serverTime: number): number =>
    anchor.playing ? anchor.frame + ((serverTime - anchor.at) / 1000) * anchor.frameRate : anchor.frame;

  function announce(frame: number, at: number, onBoundary: boolean): void {
    for (const track of model.tracks()) {
      const clip = model.activeAt(track.id, frame);
      if ((announced.get(track.id) ?? null) === (clip?.id ?? null)) continue;
      if (clip) announced.set(track.id, clip.id);
      else announced.delete(track.id);
      onActive({
        trackId:  track.id,
        clipId:   clip?.id ?? null,
        label:    clip?.label ?? null,
        sourceId: clip?.sourceId ?? null,
        frame,
        at,
      }, onBoundary);
    }
    for (const trackId of [...announced.keys()]) {
      if (!model.hasTrack(trackId)) announced.delete(trackId);
    }
  }

  function disarm(): void {
    if (armed) timers.clearTimeout(armed.handle);
    armed = null;
  }

  function tick(): void {
    const now = serverNow();
    const anchor = transport;
    // A stopped timeline is browsed privately in the editor: nothing to follow.
    if (now === null || !anchor?.playing) { disarm(); return; }

    const actual = frameAt(anchor, now);
    if (landed !== null && actual >= landed) landed = null;
    const frame = landed ?? actual;

    announce(frame, now, false);

    const boundary = model.nextBoundaryAfter(frame);
    if (armed && armed.boundary !== boundary) disarm();   // an edit moved it
    if (boundary === null || armed) return;

    const msUntil = ((boundary - actual) / anchor.frameRate) * 1000 - leadMs;
    if (msUntil > TICK_MS * 2) return;

    const handle = timers.setTimeout(() => {
      armed = null;
      const at = serverNow();
      if (at === null || !transport?.playing) return;
      landed = boundary;
      announce(boundary, at, true);
    }, Math.max(0, msUntil));
    armed = { boundary, handle };
  }

  return {
    tick,

    /** A new anchor: play, pause or seek. Anything armed was timed against the old one. */
    setTransport(state: TransportAnchor | null): void {
      transport = state;
      landed = null;
      disarm();
    },

    /** Clips or tracks changed; an armed timer may point at a boundary that moved. */
    invalidate(): void {
      disarm();
    },

    /** Forget everything — a reconnect means the gap was unobserved. */
    reset(): void {
      transport = null;
      landed = null;
      disarm();
      announced.clear();
    },

    /** Where the playhead is now; null when there is no anchor or no server time. */
    currentFrame(): number | null {
      if (!transport) return null;
      if (!transport.playing) return transport.frame;
      const now = serverNow();
      return now === null ? null : frameAt(transport, now);
    },
  };
}

export type ClipScheduler = ReturnType<typeof createClipScheduler>;
