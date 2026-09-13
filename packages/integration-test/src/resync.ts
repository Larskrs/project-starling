/**
 * The integration's side of a room-wide clock sync.
 *
 * Someone presses "Sync clocks" in the editor. The server asks every client in
 * the room to re-measure (`clock:measure`); each one answers with how good its
 * estimate now is (`clock:report`); progress goes to the whole room
 * (`clock:status`). A Play pressed meanwhile is held until every client has
 * answered or the deadline passes, so a device that does not answer is one the
 * operator sees listed as silent before the show starts.
 *
 * Pure, so the rules are tested without a server — see resync.test.ts.
 */
import type { ClockClientStatus, ClockMeasureRequest, ClockReport, ClockSyncStatus } from '@starling/realtime';

export interface MeasurableClock {
  /** A burst that starts after the call. Resolves when it is done. */
  measure(): Promise<void>;
  /** Round trip (ms) of the sample the estimate rests on; null when no ping has answered. */
  readonly rtt: number | null;
}

/**
 * The answer to a `clock:measure`. Measures afresh FIRST, then reads the round
 * trip — reading it first would report the estimate from before anyone asked.
 */
export async function answerMeasure(request: ClockMeasureRequest, clock: MeasurableClock): Promise<ClockReport> {
  await clock.measure();
  return { requestId: request.requestId, rtt: clock.rtt };
}

/** Good enough for a show: measured, and never more than one frame out. */
export function isWithinFrame(client: ClockClientStatus, frameRate: number): boolean {
  if (client.state !== 'synced' || client.rtt === null) return false;
  return client.rtt / 2 <= 1000 / (frameRate || 25);
}

/** How the editor's sync panel describes a client, in words for a terminal. */
export function describeClient(client: ClockClientStatus, frameRate: number): string {
  switch (client.state) {
    case 'waiting':   return 'measuring';
    case 'failed':    return 'no ping got through';
    case 'no-report': return 'did not answer';
    case 'left':      return 'left the timeline';
    case 'synced': {
      const ms = Math.max(1, Math.round((client.rtt ?? 0) / 2));
      return isWithinFrame(client, frameRate) ? `±${ms} ms` : `±${ms} ms, looser than a frame`;
    }
  }
}

export type StatusLevel = 'info' | 'ok' | 'warn';

export interface StatusLine {
  level: StatusLevel;
  text: string;
}

/**
 * Turns the stream of `clock:status` updates into the few lines worth printing.
 *
 * The server sends a status on every change — each client's answer is one — so
 * printing them all buries the three things an operator watching a terminal
 * needs: that a sync started, that a Play is waiting on it, and how it ended.
 */
export function createClockStatusWatch(frameRate: () => number) {
  let requestId: string | null = null;
  let playHeld = false;
  let finished = false;

  return {
    observe(status: ClockSyncStatus): StatusLine[] {
      const lines: StatusLine[] = [];

      // A run we have not seen: pressed just now, or already going as we joined.
      if (status.requestId !== requestId) {
        requestId = status.requestId;
        playHeld  = false;
        finished  = false;
        if (status.state === 'measuring') {
          lines.push({ level: 'info', text: `clock sync started by ${status.requestedBy.name}` });
        }
      }

      if (status.playHeld && !playHeld) {
        lines.push({ level: 'warn', text: 'play is held until every clock has reported' });
      }
      playHeld = status.playHeld;

      if (status.state === 'done' && !finished) {
        finished = true;
        const fps    = frameRate();
        const behind = status.clients.filter(c => !isWithinFrame(c, fps));
        const total  = status.clients.length;
        lines.push({
          level: behind.length ? 'warn' : 'ok',
          text:  `clock sync done: ${total - behind.length}/${total} within a frame`,
        });
        for (const client of behind) {
          lines.push({ level: 'warn', text: `  ${client.name}: ${describeClient(client, fps)}` });
        }
      }

      return lines;
    },

    reset(): void {
      requestId = null;
      playHeld  = false;
      finished  = false;
    },
  };
}
