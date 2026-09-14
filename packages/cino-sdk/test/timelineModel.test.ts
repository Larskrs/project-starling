import { clipEndFrame, createTimelineModel, liveClipAt, type TrackRow } from '../src/live/timelineModel.ts';
import { check, eq, finish, section } from './harness.ts';

// Programme: A from 0 (until B), B from 100 for 50 frames, a gap, C from 200. Preview is empty.
const ROWS: TrackRow[] = [
  { id: 't1', name: 'Programme', sortOrder: 0, typeName: 'Camera', clips: [
    { id: 'A', trackId: 't1', position: 0,   sourceId: 's1', label: 'Open',  mediaStart: null, end: null, fileType: null },
    { id: 'B', trackId: 't1', position: 100, sourceId: 's2', label: 'Close', mediaStart: null, end: 50,   fileType: 'audio' },
    { id: 'C', trackId: 't1', position: 200, sourceId: 's1', label: 'Wide',  mediaStart: null, end: null, fileType: null },
  ] },
  { id: 't2', name: 'Preview', sortOrder: 1, clips: [] },
];

function loaded() {
  const model = createTimelineModel();
  model.load(ROWS);
  return model;
}

section('clip windows');

await check('the live clip follows position, end, and the next clip', () => {
  const model = loaded();
  const at = (frame: number) => model.liveClip('t1', frame)?.id ?? null;
  eq(at(0), 'A', 'frame 0:');
  eq(at(99.9), 'A', 'frame 99.9:');
  eq(at(100), 'B', 'frame 100:');
  eq(at(149.9), 'B', 'frame 149.9:');
  eq(at(150), null, 'frame 150:');
  eq(at(200), 'C', 'frame 200:');
  eq(at(100_000), 'C', 'long after:');
  eq(at(-1), null, 'before the first clip:');
  eq(model.liveClip('t2', 50), null, 'empty track:');
  eq(model.liveClip('nope', 50), null, 'unknown track:');
});

await check('mediaStart shortens a clip the way the editor counts it', () => {
  eq(clipEndFrame({ position: 10, mediaStart: 20, end: 70 }), 60, 'end:');
  eq(clipEndFrame({ position: 10, mediaStart: null, end: null }), null, 'no end:');
});

await check('binary search agrees with a plain scan on a big timeline', () => {
  const model = createTimelineModel();
  const clips = Array.from({ length: 2000 }, (_, i) => ({
    id: `c${i}`, trackId: 't', position: i * 7, mediaStart: i % 3 === 0 ? 2 : null, end: i % 5 === 0 ? 6 : null, label: null, sourceId: null,
  }));
  model.load([{ id: 't', name: 'T', clips }]);
  const track = model.track('t')!;
  for (let frame = -3; frame < 14_010; frame += 1.5) {
    let scan = null as (typeof track.clips)[number] | null;
    for (const clip of track.clips) { if (clip.position > frame) break; scan = clip; }
    const end = scan ? clipEndFrame(scan) : null;
    if (scan && end != null && frame >= end) scan = null;
    const found = liveClipAt(track.clips, frame);
    if ((found?.id ?? null) !== (scan?.id ?? null)) throw new Error(`frame ${frame}: search ${found?.id}, scan ${scan?.id}`);
  }
});

await check('the next boundary is the nearest start or end strictly ahead', () => {
  const model = loaded();
  eq(model.nextBoundaryAfter(-5), 0, 'before everything:');
  eq(model.nextBoundaryAfter(0), 100, 'from 0:');
  eq(model.nextBoundaryAfter(99.99), 100, 'just short of 100:');
  eq(model.nextBoundaryAfter(100), 150, 'from 100:');
  eq(model.nextBoundaryAfter(150), 200, 'from 150:');
  eq(model.nextBoundaryAfter(200), null, 'from 200:');
});

section('changes');

await check('a clip moved to another track leaves the first one', () => {
  const model = loaded();
  model.applyClipChange({ type: 'patch', clip: { id: 'A', trackId: 't2' } });
  eq(model.liveClip('t1', 50), null, 'old track:');
  eq(model.liveClip('t2', 50)?.id, 'A', 'new track:');
  eq(model.clip('A')?.trackId, 't2', 'lookup:');
  eq(model.clip('A')?.sourceId, 's1', 'fields the patch did not carry:');
});

await check('a relay keeps fields the bootstrap enriched, unless it sends them', () => {
  const model = loaded();
  model.applyClipChange({ type: 'upsert', clip: { id: 'B', trackId: 't1', position: 110, label: 'Close up' } });
  const b = model.clip('B')!;
  eq(b.position, 110, 'position:');
  eq(b.label, 'Close up', 'label:');
  eq(b.row.fileType, 'audio', 'fileType kept:');
  model.applyTrackChange({ type: 'patch', track: { id: 't1', name: 'Programme B' } });
  eq(model.track('t1')!.name, 'Programme B', 'renamed:');
  eq(model.track('t1')!.row.typeName, 'Camera', 'typeName kept:');
  eq(model.track('t1')!.clips.length, 3, 'clips kept:');
});

await check('a patch carries only what changed, and a null in it is a change', () => {
  const model = loaded();
  eq(model.applyClipChange({ type: 'patch', clip: { id: 'B', end: null } }), true, 'applied:');
  const b = model.clip('B')!;
  eq(b.end, null, 'end cleared:');
  eq(b.position, 100, 'position kept:');
  eq(b.label, 'Close', 'label kept:');
  eq(model.liveClip('t1', 160)?.id, 'B', 'B now lasts until C:');
});

await check('a patch for a clip or track never held is ignored, not invented', () => {
  const model = loaded();
  const v = model.version;
  eq(model.applyClipChange({ type: 'patch', clip: { id: 'X', label: 'ghost' } }), false, 'clip:');
  eq(model.applyTrackChange({ type: 'patch', track: { id: 'tx', name: 'ghost' } }), false, 'track:');
  eq(model.clip('X'), null, 'clip lookup:');
  eq(model.track('tx'), null, 'track lookup:');
  eq(model.version, v, 'version:');
});

await check('handed-out objects never change underneath the caller', () => {
  const model = loaded();
  const trackBefore = model.track('t1')!;
  const clipBefore = model.clip('B')!;
  model.applyClipChange({ type: 'patch', clip: { id: 'B', position: 120 } });
  eq(clipBefore.position, 100, 'old clip:');
  eq(trackBefore.clips.length, 3, 'old track:');
  eq(model.track('t1') !== trackBefore, true, 'new track object:');
  eq(Object.isFrozen(model.clip('B')), true, 'clip frozen:');
  eq(Object.isFrozen(model.track('t1')!.clips), true, 'clips frozen:');
});

await check('removing a clip or a track updates lookups and boundaries', () => {
  const model = loaded();
  eq(model.applyClipChange({ type: 'remove', clipId: 'B' }), true, 'removed:');
  eq(model.clip('B'), null, 'lookup:');
  eq(model.nextBoundaryAfter(0), 200, 'boundaries:');
  eq(model.applyClipChange({ type: 'remove', clipId: 'B' }), false, 'second remove:');
  model.applyTrackChange({ type: 'remove', trackId: 't1' });
  eq(model.track('t1'), null, 'track:');
  eq(model.clip('A'), null, 'its clips:');
  eq(model.nextBoundaryAfter(-1), null, 'boundaries:');
});

await check('reorder changes the order tracks come back in', () => {
  const model = loaded();
  model.applyTrackChange({ type: 'reorder', order: ['t2', 't1'] });
  eq(model.tracks().map(t => t.id).join(), 't2,t1', 'order:');
});

await check('an upsert for a track not fetched is not invented', () => {
  const model = loaded();
  model.applyClipChange({ type: 'upsert', clip: { id: 'X', trackId: 'ghost', position: 5 } });
  eq(model.clip('X'), null, 'clip:');
  eq(model.track('ghost'), null, 'track:');
});

await check('the version moves on every change and only then', () => {
  const model = loaded();
  const v = model.version;
  model.applyClipChange({ type: 'remove', clipId: 'nope' });
  eq(model.version, v, 'no-op remove:');
  model.applyTrackChange({ type: 'reorder', order: ['t1', 't2'] });
  eq(model.version, v, 'same order:');
  model.applyClipChange({ type: 'remove', clipId: 'A' });
  eq(model.version, v + 1, 'real change:');
});

finish();
