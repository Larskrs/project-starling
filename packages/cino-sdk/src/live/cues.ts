import { frameAt, realTimers, TICK_MS, type Timers, type TransportAnchor } from './transport.ts';

export interface CueEvent {
  /** The frame the cue is set on. */
  frame: number;
  /** Server clock ms when it fired. */
  at: number;
  /** True when a timer landed on it; false when a tick noticed it late, or play started on it. */
  onTime: boolean;
}

export type CueListener = (event: CueEvent) => void;

/** A fixed frame, or one worked out on every tick (null skips the cue for now). */
export type FrameSource = number | (() => number | null);

export interface CueSchedulerOptions {
  serverNow: () => number | null;
  transport: () => TransportAnchor | null;
  leadMs?: number;
  timers?: Timers;
}

interface Cue {
  target: () => number | null;
  listener: CueListener;
  done: boolean;
  timer: unknown;
  timerFrame: number | null;
}

/**
 * Fires a listener each time the playing transport crosses a frame. Seeking over a
 * cue does not fire it; rewinding before it arms it again.
 */
export function createCueScheduler({ serverNow, transport, leadMs = 0, timers = realTimers }: CueSchedulerOptions) {
  const cues = new Set<Cue>();
  let lastFrame: number | null = null;

  function disarm(cue: Cue): void {
    if (cue.timer !== null) timers.clearTimeout(cue.timer);
    cue.timer = null;
    cue.timerFrame = null;
  }

  function fire(cue: Cue, frame: number, at: number, onTime: boolean): void {
    disarm(cue);
    cue.done = true;
    cue.listener({ frame, at, onTime });
  }

  function tick(): void {
    const now = serverNow();
    const anchor = transport();
    if (now === null || !anchor?.playing) {
      lastFrame = null;
      cues.forEach(disarm);
      return;
    }

    const frame = frameAt(anchor, now);
    const from = lastFrame ?? anchor.frame;
    const leadFrames = (leadMs / 1000) * anchor.frameRate;

    for (const cue of [...cues]) {
      const target = cue.target();
      if (target === null || !Number.isFinite(target)) { disarm(cue); continue; }

      const due = target - leadFrames;
      if (cue.done) {
        if (frame >= due - 1) continue;
        cue.done = false;
      }
      if (cue.timer !== null && cue.timerFrame !== target) disarm(cue);

      if (from <= due && frame >= due) { fire(cue, target, now, false); continue; }
      if (cue.timer !== null || frame > due) continue;

      const msUntil = ((due - frame) / anchor.frameRate) * 1000;
      if (msUntil > TICK_MS * 2) continue;

      cue.timerFrame = target;
      cue.timer = timers.setTimeout(() => {
        cue.timer = null;
        cue.timerFrame = null;
        if (!cues.has(cue) || cue.done) return;
        const at = serverNow();
        if (at === null || !transport()?.playing) return;
        fire(cue, target, at, true);
      }, Math.max(0, msUntil));
    }

    lastFrame = frame;
  }

  return {
    tick,

    /** Returns a function that removes the cue. */
    add(frame: FrameSource, listener: CueListener): () => void {
      const cue: Cue = {
        target: typeof frame === 'number' ? () => frame : frame,
        listener,
        done: false,
        timer: null,
        timerFrame: null,
      };
      cues.add(cue);
      return () => {
        disarm(cue);
        cues.delete(cue);
      };
    },

    /** Play, pause or seek: a jump is not a crossing. */
    transportChanged(): void {
      lastFrame = null;
      cues.forEach(disarm);
    },

    clear(): void {
      cues.forEach(disarm);
      cues.clear();
      lastFrame = null;
    },

    get size(): number {
      return cues.size;
    },
  };
}

export type CueScheduler = ReturnType<typeof createCueScheduler>;
