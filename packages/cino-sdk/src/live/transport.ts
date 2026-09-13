export const TICK_MS = 20;

/** The room's transport, as `transport:state` carries it. */
export interface TransportAnchor {
  playing: boolean;
  frame: number;
  frameRate: number;
  /** Server clock reading at which the playhead was at `frame`. */
  at: number;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout:   (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Where the playhead is at a server time. Read the anchor at use time; never convert it to local time once. */
export function frameAt(anchor: TransportAnchor, serverTime: number): number {
  return anchor.playing ? anchor.frame + ((serverTime - anchor.at) / 1000) * anchor.frameRate : anchor.frame;
}

/** Lets a timer not hold a Node process open by itself. A no-op in browsers. */
export function background<T>(timer: T): T {
  (timer as { unref?: () => void } | null)?.unref?.();
  return timer;
}
