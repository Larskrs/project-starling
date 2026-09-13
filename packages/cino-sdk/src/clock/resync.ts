import type { ClockClientStatus, ClockMeasureRequest, ClockReport, ClockSyncStatus } from '../protocol.ts';

export interface MeasurableClock {
  measure(): Promise<void>;
  readonly rtt: number | null;
}

/** Answers "Sync clocks": measure afresh first, then report the round trip. */
export async function answerMeasure(request: ClockMeasureRequest, clock: MeasurableClock): Promise<ClockReport> {
  await clock.measure();
  return { requestId: request.requestId, rtt: clock.rtt };
}

/** Measured, and never more than one frame out. */
export function isWithinFrame(client: ClockClientStatus, frameRate: number): boolean {
  if (client.state !== 'synced' || client.rtt === null) return false;
  return client.rtt / 2 <= 1000 / (frameRate || 25);
}

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

/** Turns `clock:status` updates into the few lines worth showing: started, Play held, and how it ended. */
export function createClockStatusWatch(frameRate: () => number) {
  let requestId: string | null = null;
  let playHeld = false;
  let finished = false;

  return {
    observe(status: ClockSyncStatus): StatusLine[] {
      const lines: StatusLine[] = [];

      if (status.requestId !== requestId) {
        requestId = status.requestId;
        playHeld = false;
        finished = false;
        if (status.state === 'measuring') lines.push({ level: 'info', text: `clock sync started by ${status.requestedBy.name}` });
      }

      if (status.playHeld && !playHeld) lines.push({ level: 'warn', text: 'play is held until every clock has reported' });
      playHeld = status.playHeld;

      if (status.state === 'done' && !finished) {
        finished = true;
        const fps = frameRate();
        const behind = status.clients.filter(client => !isWithinFrame(client, fps));
        const total = status.clients.length;
        lines.push({ level: behind.length ? 'warn' : 'ok', text: `clock sync done: ${total - behind.length}/${total} within a frame` });
        for (const client of behind) lines.push({ level: 'warn', text: `  ${client.name}: ${describeClient(client, fps)}` });
      }

      return lines;
    },

    reset(): void {
      requestId = null;
      playHeld = false;
      finished = false;
    },
  };
}
