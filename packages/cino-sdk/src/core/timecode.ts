import type { FrameRate } from '../types.ts';

export type FrameRateLike = FrameRate | number | string;

export const FRAME_RATES: readonly FrameRate[] = ['23.976', '24', '25', '29.97', '29.97df', '30', '50', '59.94', '60'];

/** Frames per second as a number: `'29.97df'` → 29.97. */
export function fps(rate: FrameRateLike): number {
  const value = typeof rate === 'number' ? rate : parseFloat(rate);
  return Number.isFinite(value) && value > 0 ? value : 25;
}

export function isDropFrame(rate: FrameRateLike): boolean {
  return typeof rate === 'string' && rate.endsWith('df');
}

export function framesToSeconds(frames: number, rate: FrameRateLike): number {
  return frames / fps(rate);
}

export function secondsToFrames(seconds: number, rate: FrameRateLike): number {
  return seconds * fps(rate);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Frame → `HH:MM:SS:FF`, or `HH:MM:SS;FF` for drop-frame rates. */
export function toTimecode(frame: number, rate: FrameRateLike): string {
  const nominal = Math.round(fps(rate));
  let count = Math.max(0, Math.round(frame));

  if (isDropFrame(rate)) {
    const drop = Math.round(nominal / 15);
    const perMinute = nominal * 60 - drop;
    const perTenMinutes = perMinute * 10 + drop;
    const tens = Math.floor(count / perTenMinutes);
    const rest = count % perTenMinutes;
    count += drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMinute) : 0);
  }

  const frames = count % nominal;
  const totalSeconds = Math.floor(count / nominal);
  const separator = isDropFrame(rate) ? ';' : ':';
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}${separator}${pad(frames)}`;
}

/** `HH:MM:SS:FF` (or `;FF`) → frame. Hours may run past 99. */
export function fromTimecode(timecode: string, rate: FrameRateLike): number {
  const match = /^(\d+):(\d{2}):(\d{2})[:;.](\d{2,3})$/.exec(timecode.trim());
  if (!match) throw new TypeError(`cino-sdk: not a timecode: "${timecode}"`);

  const [hours, minutes, seconds, frames] = match.slice(1).map(Number) as [number, number, number, number];
  const nominal = Math.round(fps(rate));
  let count = ((hours * 60 + minutes) * 60 + seconds) * nominal + frames;

  if (isDropFrame(rate)) {
    const totalMinutes = hours * 60 + minutes;
    count -= Math.round(nominal / 15) * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return count;
}
