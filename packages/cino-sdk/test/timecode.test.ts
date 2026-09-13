import { fps, fromTimecode, isDropFrame, secondsToFrames, toTimecode } from '../src/core/timecode.ts';
import { check, eq, finish, section } from './harness.ts';

section('timecode');

await check('non-drop rates count whole frames', () => {
  eq(toTimecode(0, '25'), '00:00:00:00', '0:');
  eq(toTimecode(90, '25'), '00:00:03:15', '90 at 25:');
  eq(toTimecode(90_000, 25), '01:00:00:00', 'an hour:');
  eq(fromTimecode('00:00:03:15', '25'), 90, 'back:');
  eq(toTimecode(59.6, '60'), '00:00:01:00', 'rounds to the nearest frame:');
});

await check('drop-frame skips frame numbers, not frames', () => {
  eq(toTimecode(1799, '29.97df'), '00:00:59;29', 'last frame of minute 0:');
  eq(toTimecode(1800, '29.97df'), '00:01:00;02', 'first frame of minute 1:');
  eq(toTimecode(17982, '29.97df'), '00:10:00;00', 'minute 10 keeps its numbers:');
  eq(fromTimecode('00:01:00;02', '29.97df'), 1800, 'back:');
  eq(fromTimecode('00:10:00;00', '29.97df'), 17982, 'back at 10:');
});

await check('every frame round-trips', () => {
  for (const rate of ['25', '29.97df', '30', '59.94'] as const) {
    for (let frame = 0; frame < 40_000; frame += 7) {
      const back = fromTimecode(toTimecode(frame, rate), rate);
      if (back !== frame) throw new Error(`${rate}: ${frame} → ${toTimecode(frame, rate)} → ${back}`);
    }
  }
});

await check('rates parse, and bad timecodes are refused', () => {
  eq(fps('29.97df'), 29.97, '29.97df:');
  eq(fps('nonsense'), 25, 'fallback:');
  eq(isDropFrame('29.97df'), true, 'df:');
  eq(isDropFrame('29.97'), false, 'not df:');
  eq(secondsToFrames(2, '50'), 100, 'seconds:');
  let message = '';
  try { fromTimecode('1:2:3', '25'); } catch (err) { message = (err as Error).message; }
  eq(message.includes('not a timecode'), true, 'refused:');
});

finish();
