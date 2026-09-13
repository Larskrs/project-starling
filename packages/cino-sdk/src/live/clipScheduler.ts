import type { Clip, TimelineModel, Track } from './timelineModel.ts';
import { frameAt, realTimers, TICK_MS, type Timers, type TransportAnchor } from './transport.ts';

/** A track's live clip changed. */
export interface ClipEvent {
  track: Track;
  /** The clip now live, or null when the track went quiet. */
  clip: Clip | null;
  previous: Clip | null;
  /** The boundary itself when on time. */
  frame: number;
  /** Server clock ms when it was announced. */
  at: number;
  /** True when a timer landed on the boundary; false for a catch-up after a join, seek, edit or stall. */
  onBoundary: boolean;
}

export interface ClipSchedulerOptions {
  model: Pick<TimelineModel, 'tracks' | 'track' | 'liveClip' | 'nextBoundaryAfter'>;
  serverNow: () => number | null;
  onClip: (event: ClipEvent) => void;
  /** Announce this many ms before the boundary: the latency of whatever acts on it. */
  leadMs?: number;
  timers?: Timers;
}

/**
 * Announces clip changes on the frame. A tick every 20ms catches up on whatever is
 * live; once the next boundary is under two ticks away, a one-shot timer lands on it.
 */
export function createClipScheduler({ model, serverNow, onClip, leadMs = 0, timers = realTimers }: ClipSchedulerOptions) {
  let transport: TransportAnchor | null = null;
  const announced = new Map<string, Clip>();
  let armed: { boundary: number; handle: unknown } | null = null;
  // A timer fires leadMs early; until the playhead arrives, ticks read the timeline at that boundary.
  let landed: number | null = null;

  function announce(frame: number, at: number, onBoundary: boolean): void {
    for (const track of model.tracks()) {
      const clip = model.liveClip(track.id, frame);
      const previous = announced.get(track.id) ?? null;
      if (clip) announced.set(track.id, clip);
      else announced.delete(track.id);
      if ((previous?.id ?? null) !== (clip?.id ?? null)) onClip({ track, clip, previous, frame, at, onBoundary });
    }
    for (const trackId of [...announced.keys()]) {
      if (!model.track(trackId)) announced.delete(trackId);
    }
  }

  function disarm(): void {
    if (armed) timers.clearTimeout(armed.handle);
    armed = null;
  }

  function tick(): void {
    const now = serverNow();
    const anchor = transport;
    if (now === null || !anchor?.playing) { disarm(); return; }

    const actual = frameAt(anchor, now);
    if (landed !== null && actual >= landed) landed = null;
    const frame = landed ?? actual;

    announce(frame, now, false);

    const boundary = model.nextBoundaryAfter(frame);
    if (armed && armed.boundary !== boundary) disarm();
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

    get transport(): TransportAnchor | null { return transport; },

    setTransport(state: TransportAnchor | null): void {
      transport = state;
      landed = null;
      disarm();
    },

    /** Clips or tracks changed; an armed timer may point at a boundary that moved. */
    invalidate(): void {
      disarm();
    },

    /** Forget everything: after a reconnect the gap went unobserved. */
    reset(): void {
      transport = null;
      landed = null;
      disarm();
      announced.clear();
    },

    announced(trackId: string): Clip | null {
      return announced.get(trackId) ?? null;
    },

    currentFrame(): number | null {
      if (!transport) return null;
      if (!transport.playing) return transport.frame;
      const now = serverNow();
      return now === null ? null : frameAt(transport, now);
    },
  };
}

export type ClipScheduler = ReturnType<typeof createClipScheduler>;
