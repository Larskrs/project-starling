import { randomUUID } from 'node:crypto';
import type {
  ClockClientStatus, ClockMeasureRequest, ClockReport, ClockSyncProgress, ClockSyncStatus,
} from '@starling/realtime';

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
 * Pure apart from the injected timers and emitters, so the rules are pinned
 * down in clockResync.test.ts; timelineSockets.ts wires it to the room.
 */

/** Long enough for a five-ping burst over long-polling; short enough that nobody waits on a dead device. */
export const RESYNC_DEADLINE_MS = 4_000;

/**
 * How often, at most, the room hears a run's progress.
 *
 * Every report used to re-send the whole client table to the whole room, so a
 * run in a room of n sent n tables of n entries to each of n sockets — all of it
 * in the four seconds before a show. The room is now sent the table once, as the
 * run starts, and after that only the clients whose answer came in, gathered for
 * up to this long. What people wait on is never gathered: a held Play and the
 * end of the run go out at once.
 */
export const RESYNC_PROGRESS_MS = 250;

export interface ResyncClient {
  socketId: string;
  id: string;
  name: string;
}

/** A Play that arrived mid-run, started with a fresh anchor once the run ends. */
export interface HeldPlay {
  frame: number;
  frameRate: number;
}

export interface ClockResyncOptions {
  /** Ask every client in the room to re-measure. */
  measure: (roomId: string, request: ClockMeasureRequest) => void;
  /** Broadcast a run whole, as it starts. Receives a copy; mutating it changes nothing. */
  publish: (roomId: string, status: ClockSyncStatus) => void;
  /** Broadcast what changed since the room last heard. */
  progress: (roomId: string, progress: ClockSyncProgress) => void;
  /** The run ended with a Play waiting: start it now. */
  releasePlay: (roomId: string, play: HeldPlay) => void;
  deadlineMs?: number;
  progressMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  newId?: () => string;
}

/** The server's copy keeps each client's socket, which is how a report is matched to it. */
interface RunClient extends ClockClientStatus {
  socketId: string;
}

interface RunStatus extends ClockSyncStatus {
  clients: RunClient[];
}

interface Run {
  status: RunStatus;
  deadline: unknown;
  held: HeldPlay | null;
  /** Indexes of clients whose latest state the room has not been sent. */
  unsent: Set<number>;
  progressTimer: unknown;
}

const realSetTimer = (fn: () => void, ms: number): unknown => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();   // never keep the process alive for a resync
  return timer;
};

/**
 * Eight hex digits. A run id is repeated in every measure request, report and
 * progress message, and only has to tell this room's runs apart.
 */
const shortId = (): string => randomUUID().slice(0, 8);

export function createClockResyncs({
  measure,
  publish,
  progress,
  releasePlay,
  deadlineMs = RESYNC_DEADLINE_MS,
  progressMs = RESYNC_PROGRESS_MS,
  setTimer = realSetTimer,
  clearTimer = handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  newId = shortId,
}: ClockResyncOptions) {
  const runs = new Map<string, Run>();

  /** Tells the room what changed, now. */
  function sendProgress(roomId: string, run: Run): void {
    if (run.progressTimer !== null) {
      clearTimer(run.progressTimer);
      run.progressTimer = null;
    }
    const changes = [...run.unsent].sort((a, b) => a - b).map((index) => {
      const { state, rtt } = run.status.clients[index]!;
      return { index, state, rtt };
    });
    run.unsent.clear();
    progress(roomId, {
      requestId: run.status.requestId,
      state:     run.status.state,
      playHeld:  run.status.playHeld,
      changes,
    });
  }

  /** Tells the room what changed soon, together with whatever else changes meanwhile. */
  function queueProgress(roomId: string, run: Run): void {
    if (run.progressTimer !== null) return;
    run.progressTimer = setTimer(() => {
      run.progressTimer = null;
      sendProgress(roomId, run);
    }, progressMs);
  }

  function finish(roomId: string): void {
    const run = runs.get(roomId);
    if (!run || run.status.state !== 'measuring') return;
    clearTimer(run.deadline);

    run.status.clients.forEach((client, index) => {
      if (client.state !== 'waiting') return;
      client.state = 'no-report';
      run.unsent.add(index);
    });
    run.status.state    = 'done';
    run.status.playHeld = false;

    const held = run.held;
    run.held = null;
    // The room hears that the run ended BEFORE the Play's anchor arrives, so no
    // client ever sees playback start while its panel still says "measuring".
    sendProgress(roomId, run);
    if (held) releasePlay(roomId, held);
  }

  function answered(roomId: string, run: Run, index: number): void {
    run.unsent.add(index);
    if (run.status.clients.every(c => c.state !== 'waiting')) finish(roomId);
    else queueProgress(roomId, run);
  }

  function measuringRun(roomId: string): Run | null {
    const run = runs.get(roomId);
    return run?.status.state === 'measuring' ? run : null;
  }

  /** A client of the run in progress that has not answered yet, by socket. */
  function waitingClient(roomId: string, socketId: string): { run: Run; index: number } | null {
    const run = measuringRun(roomId);
    const index = run ? run.status.clients.findIndex(c => c.socketId === socketId) : -1;
    if (!run || index === -1 || run.status.clients[index]!.state !== 'waiting') return null;
    return { run, index };
  }

  return {
    /**
     * Starts a run for everyone currently in the room. Pressing again while one
     * is running joins it rather than restarting it — two operators pressing at
     * once should not make the room measure twice.
     */
    start(roomId: string, requestedBy: { name: string }, clients: ResyncClient[]): { requestId: string; joined: boolean } {
      const current = measuringRun(roomId);
      if (current) return { requestId: current.status.requestId, joined: true };

      const run: Run = {
        held:          null,
        deadline:      null,
        progressTimer: null,
        unsent:        new Set(),
        status: {
          requestId:   newId(),
          state:       'measuring',
          requestedBy: { name: requestedBy.name },
          deadlineMs,
          playHeld:    false,
          clients:     clients.map(c => ({ ...c, state: 'waiting' as const, rtt: null })),
        },
      };
      runs.set(roomId, run);
      run.deadline = setTimer(() => finish(roomId), deadlineMs);

      measure(roomId, { requestId: run.status.requestId, deadlineMs });
      publish(roomId, structuredClone(run.status));
      if (clients.length === 0) finish(roomId);
      return { requestId: run.status.requestId, joined: false };
    },

    /** A client's answer. Late, foreign and repeated reports change nothing. */
    report(roomId: string, socketId: string, report: ClockReport): boolean {
      const found = waitingClient(roomId, socketId);
      if (!found || found.run.status.requestId !== report.requestId) return false;

      const client = found.run.status.clients[found.index]!;
      client.state = report.rtt === null ? 'failed' : 'synced';
      client.rtt   = report.rtt;
      answered(roomId, found.run, found.index);
      return true;
    },

    /** A socket left the room. Counts as answered, so it cannot hold a Play. */
    leave(roomId: string, socketId: string): void {
      const found = waitingClient(roomId, socketId);
      if (!found) return;
      found.run.status.clients[found.index]!.state = 'left';
      answered(roomId, found.run, found.index);
    },

    /** Holds a Play if a run is going. Returns false when there is nothing to wait for. */
    holdPlay(roomId: string, play: HeldPlay): boolean {
      const run = measuringRun(roomId);
      if (!run) return false;
      run.held = play;   // the newest intent wins, as it does for any transport command
      if (!run.status.playHeld) {
        run.status.playHeld = true;
        sendProgress(roomId, run);
      }
      return true;
    },

    /** A Pause during a run cancels the held Play, the way it would stop one that had started. */
    cancelPlay(roomId: string): boolean {
      const run = measuringRun(roomId);
      if (!run?.held) return false;
      run.held = null;
      run.status.playHeld = false;
      sendProgress(roomId, run);
      return true;
    },

    /** The run in progress, whole, for a client joining mid-run; null when none is. */
    measuring(roomId: string): ClockSyncStatus | null {
      const run = measuringRun(roomId);
      return run ? structuredClone(run.status) : null;
    },

    /** The room emptied: drop its run, its deadline, and anything it had yet to say. */
    clear(roomId: string): void {
      const run = runs.get(roomId);
      if (run) {
        clearTimer(run.deadline);
        if (run.progressTimer !== null) clearTimer(run.progressTimer);
      }
      runs.delete(roomId);
    },
  };
}

export type ClockResyncs = ReturnType<typeof createClockResyncs>;
