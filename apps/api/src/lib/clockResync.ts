import { randomUUID } from 'node:crypto';
import type { ClockMeasureRequest, ClockReport, ClockSyncStatus } from '@starling/realtime';

/**
 * Room-wide clock resync — the rules, without sockets or real timers.
 *
 * A production cannot start on clocks that are only probably right. An operator
 * presses "Sync clocks"; every client in the room re-measures against this
 * server and reports how good its estimate now is. Until each one has answered,
 * or the deadline passes, a Play is HELD rather than started: an anchor stamped
 * now would be read by clients whose estimate is still settling, and they would
 * start the show on different frames.
 *
 * The deadline is what keeps this safe to press during a show. A crashed desk,
 * a closed laptop or an older client that does not know the event cannot hold
 * the room — it is listed as not answering, and the Play goes ahead.
 *
 * Pure apart from the injected clock, timers and emitters, so the rules are
 * pinned down in clockResync.test.ts; timelineSockets.ts wires it to the room.
 */

/** Long enough for a five-ping burst over long-polling; short enough that nobody waits on a dead device. */
export const RESYNC_DEADLINE_MS = 4_000;

export interface ResyncClient {
  socketId: string;
  id: string;
  name: string;
}

/** A Play that arrived mid-run, started with a fresh anchor once the run ends. */
export interface HeldPlay {
  frame: number;
  frameRate: number;
  userId: string;
}

export interface ClockResyncOptions {
  /** The server clock (serverNow). */
  now: () => number;
  /** Ask every client in the room to re-measure. */
  measure: (roomId: string, request: ClockMeasureRequest) => void;
  /** Broadcast a run's progress. Receives a copy; mutating it changes nothing. */
  publish: (roomId: string, status: ClockSyncStatus) => void;
  /** The run ended with a Play waiting: start it now. */
  releasePlay: (roomId: string, play: HeldPlay) => void;
  deadlineMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  newId?: () => string;
}

interface Run {
  status: ClockSyncStatus;
  timer: unknown;
  held: HeldPlay | null;
}

const realSetTimer = (fn: () => void, ms: number): unknown => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();   // never keep the process alive for a resync
  return timer;
};

export function createClockResyncs({
  now,
  measure,
  publish,
  releasePlay,
  deadlineMs = RESYNC_DEADLINE_MS,
  setTimer = realSetTimer,
  clearTimer = handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  newId = randomUUID,
}: ClockResyncOptions) {
  const runs = new Map<string, Run>();

  const announce = (roomId: string, run: Run) => publish(roomId, structuredClone(run.status));

  function finish(roomId: string): void {
    const run = runs.get(roomId);
    if (!run || run.status.state !== 'measuring') return;
    clearTimer(run.timer);

    for (const client of run.status.clients) {
      if (client.state === 'waiting') client.state = 'no-report';
    }
    run.status.state      = 'done';
    run.status.finishedAt = now();
    run.status.playHeld   = false;

    const held = run.held;
    run.held = null;
    // The room hears that the run ended BEFORE the Play's anchor arrives, so no
    // client ever sees playback start while its panel still says "measuring".
    announce(roomId, run);
    if (held) releasePlay(roomId, held);
  }

  function progress(roomId: string, run: Run): void {
    if (run.status.clients.every(c => c.state !== 'waiting')) finish(roomId);
    else announce(roomId, run);
  }

  function measuringRun(roomId: string): Run | null {
    const run = runs.get(roomId);
    return run?.status.state === 'measuring' ? run : null;
  }

  return {
    /**
     * Starts a run for everyone currently in the room. Pressing again while one
     * is running joins it rather than restarting it — two operators pressing at
     * once should not make the room measure twice.
     */
    start(roomId: string, requestedBy: { id: string; name: string }, clients: ResyncClient[]): { requestId: string; joined: boolean } {
      const current = measuringRun(roomId);
      if (current) return { requestId: current.status.requestId, joined: true };

      const run: Run = {
        held:  null,
        timer: null,
        status: {
          requestId:  newId(),
          state:      'measuring',
          requestedBy,
          startedAt:  now(),
          finishedAt: null,
          deadlineMs,
          playHeld:   false,
          clients:    clients.map(c => ({ ...c, state: 'waiting' as const, rtt: null })),
        },
      };
      runs.set(roomId, run);
      run.timer = setTimer(() => finish(roomId), deadlineMs);

      measure(roomId, { requestId: run.status.requestId, deadlineMs });
      announce(roomId, run);
      if (clients.length === 0) finish(roomId);
      return { requestId: run.status.requestId, joined: false };
    },

    /** A client's answer. Late, foreign and repeated reports change nothing. */
    report(roomId: string, socketId: string, report: ClockReport): boolean {
      const run = measuringRun(roomId);
      if (!run || run.status.requestId !== report.requestId) return false;
      const client = run.status.clients.find(c => c.socketId === socketId);
      if (!client || client.state !== 'waiting') return false;

      client.state = report.rtt === null ? 'failed' : 'synced';
      client.rtt   = report.rtt;
      progress(roomId, run);
      return true;
    },

    /** A socket left the room. Counts as answered, so it cannot hold a Play. */
    leave(roomId: string, socketId: string): void {
      const run = measuringRun(roomId);
      const client = run?.status.clients.find(c => c.socketId === socketId && c.state === 'waiting');
      if (!run || !client) return;
      client.state = 'left';
      progress(roomId, run);
    },

    /** Holds a Play if a run is going. Returns false when there is nothing to wait for. */
    holdPlay(roomId: string, play: HeldPlay): boolean {
      const run = measuringRun(roomId);
      if (!run) return false;
      run.held = play;   // the newest intent wins, as it does for any transport command
      if (!run.status.playHeld) {
        run.status.playHeld = true;
        announce(roomId, run);
      }
      return true;
    },

    /** A Pause during a run cancels the held Play, the way it would stop one that had started. */
    cancelPlay(roomId: string): boolean {
      const run = measuringRun(roomId);
      if (!run?.held) return false;
      run.held = null;
      run.status.playHeld = false;
      announce(roomId, run);
      return true;
    },

    /** The run in progress, for a client joining mid-run; null when none is. */
    measuring(roomId: string): ClockSyncStatus | null {
      const run = measuringRun(roomId);
      return run ? structuredClone(run.status) : null;
    },

    /** The room emptied: drop its run and its deadline. */
    clear(roomId: string): void {
      const run = runs.get(roomId);
      if (run) clearTimer(run.timer);
      runs.delete(roomId);
    },
  };
}

export type ClockResyncs = ReturnType<typeof createClockResyncs>;
