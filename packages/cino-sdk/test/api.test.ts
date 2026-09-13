import { Cino } from '../src/cino.ts';
import { fakeFetch, fakeSocket, json } from './fakes.ts';
import { check, eq, finish, section } from './harness.ts';

const fake = fakeFetch(() => json({ id: 'x', folder: { id: 'f9' }, order: ['t2', 't1'], filesRemoved: 3 }));
const cino = new Cino({ url: 'https://cino.no', token: 'cino_svc_test', fetch: fake.fetch, io: fakeSocket().io });

const production = cino.production('p1');
const timeline = cino.timeline('tl-1');
const png = { data: new Uint8Array([137, 80, 78, 71]), name: 'logo.png', type: 'image/png' };

type Case = [call: () => Promise<unknown>, request: string, body?: unknown];

async function expect(name: string, cases: Case[]): Promise<void> {
  await check(name, async () => {
    for (const [call, request, body] of cases) {
      await call();
      const last = fake.last();
      eq(`${last.method} ${last.path}`, request, `${request}:`);
      if (body !== undefined) eq(JSON.stringify(last.body), JSON.stringify(body), `${request} body:`);
    }
  });
}

section('production');

await expect('production', [
  [() => production.get(), 'GET /api/production/p1'],
  [() => production.dashboard(), 'GET /api/production/p1/dashboard'],
  [() => production.members(), 'GET /api/production/p1/members'],
  [() => production.roles(), 'GET /api/production/p1/roles'],
  [() => production.setImage('banner', png), 'POST /api/production/p1/profile'],
]);

await check('a production image is a form with its slot', () => {
  eq(fake.last().form?.get('slot'), 'banner', 'slot:');
  eq((fake.last().form?.get('file') as File).type, 'image/png', 'file:');
});

await expect('timelines', [
  [() => production.timelines.list(), 'GET /api/timelines?pid=p1'],
  [() => production.timelines.create({ name: 'Act 2', endFrame: 900 }), 'POST /api/timelines?pid=p1', { name: 'Act 2', endFrame: 900 }],
]);

await check('a timeline is found by name, ignoring case', async () => {
  const lookup = fakeFetch(() => json([{ id: 'a', name: 'Act 1' }, { id: 'b', name: ' Act 2 ' }]));
  const found = await new Cino({ url: 'https://cino.no', token: 't', fetch: lookup.fetch }).production('p1').timelines.find('act 2');
  eq(found?.id, 'b', 'found:');
});

await expect('track types', [
  [() => production.trackTypes.list(), 'GET /api/production/p1/track-types'],
  [() => production.trackTypes.create({ name: 'Cameras' }), 'POST /api/production/p1/track-types', { name: 'Cameras' }],
  [() => production.trackTypes.update('ty1', { hue: 20 }), 'PATCH /api/production/p1/track-types/ty1', { hue: 20 }],
  [() => production.trackTypes.remove('ty1'), 'DELETE /api/production/p1/track-types/ty1'],
  [() => production.trackTypes.presets(), 'GET /api/production/p1/track-type-presets'],
  [() => production.trackTypes.fromPreset({ presetId: 'camera', cameraSet: { name: 'Cams', count: 3 } }),
    'POST /api/production/p1/track-types/from-preset', { presetId: 'camera', cameraSet: { name: 'Cams', count: 3 } }],
]);

await expect('source sets and sources', [
  [() => production.sourceSets.list(), 'GET /api/production/p1/source-sets'],
  [() => production.sourceSets.create({ name: 'Cameras' }), 'POST /api/production/p1/source-sets', { name: 'Cameras' }],
  [() => production.sourceSets.update('ss1', { icon: 'video' }), 'PATCH /api/production/p1/source-sets/ss1', { icon: 'video' }],
  [() => production.sourceSets.remove('ss1'), 'DELETE /api/production/p1/source-sets/ss1'],
  [() => production.sourceSets.sources('ss1').list(), 'GET /api/production/p1/sources?sid=ss1'],
  [() => production.sourceSets.sources('ss1').create({ name: 'Crane', shortName: 'CRN', hue: 200 }),
    'POST /api/production/p1/sources?sid=ss1', { name: 'Crane', shortName: 'CRN', hue: 200 }],
  [() => production.sourceSets.sources('ss1').update('s1', { shortName: 'C1' }), 'PATCH /api/production/p1/sources/s1', { shortName: 'C1' }],
  [() => production.sourceSets.sources('ss1').remove('s1'), 'DELETE /api/production/p1/sources/s1'],
]);

section('timeline');

await expect('timeline', [
  [() => timeline.get(), 'GET /api/timeline/tl-1'],
  [() => timeline.update({ name: 'Final' }), 'PATCH /api/timeline/tl-1', { name: 'Final' }],
  [() => timeline.remove(), 'DELETE /api/timeline/tl-1'],
  [() => timeline.setImage(png), 'POST /api/timeline/tl-1/profile'],
]);

await expect('tracks', [
  [() => timeline.tracks.list(), 'GET /api/timeline/tl-1/tracks'],
  [() => timeline.tracks.create({ typeId: 'ty1', name: 'Cams' }), 'POST /api/timeline/tl-1/tracks', { typeId: 'ty1', name: 'Cams' }],
  [() => timeline.tracks.update('t1', { isLocked: true }), 'PATCH /api/timeline/tl-1/tracks/t1', { isLocked: true }],
  [() => timeline.tracks.remove('t1'), 'DELETE /api/timeline/tl-1/tracks/t1'],
  [() => timeline.tracks.reorder(['t2', 't1']), 'POST /api/timeline/tl-1/tracks/reorder', { order: ['t2', 't1'] }],
]);

await check('reorder resolves to the order the server applied', async () => {
  eq((await timeline.tracks.reorder(['t2', 't1'])).join(), 't2,t1', 'order:');
});

await expect('clips', [
  [() => timeline.clips.create({ trackId: 't1', position: 10 }), 'POST /api/timeline/tl-1/clips', { trackId: 't1', position: 10 }],
  [() => timeline.clips.update('c1', { hue: 3 }), 'PATCH /api/timeline/tl-1/clips/c1', { hue: 3 }],
  [() => timeline.clips.rename('c1', 'Wide'), 'PATCH /api/timeline/tl-1/clips/c1', { label: 'Wide' }],
  [() => timeline.clips.move('c1', 20.4), 'PATCH /api/timeline/tl-1/clips/c1', { position: 20 }],
  [() => timeline.clips.remove('c1'), 'DELETE /api/timeline/tl-1/clips/c1'],
]);

section('storage');

await expect('storage', [
  [() => production.storage.list(), 'GET /api/storage?pid=p1'],
  [() => production.storage.list('f1'), 'GET /api/storage?pid=p1&folder_id=f1'],
  [() => production.storage.files('audio'), 'GET /api/production/p1/files?type=audio'],
  [() => production.storage.stats(), 'GET /api/production/p1/storage-stats'],
  [() => production.storage.createFolder({ name: 'Stills', parentId: 'f1' }), 'POST /api/storage',
    { production_id: 'p1', name: 'Stills', parent_id: 'f1', hue: null }],
  [() => production.storage.upload(png, { folderId: 'f1' }), 'POST /api/storage/upload'],
]);

await check('an upload is a form with the production, folder and file', async () => {
  const form = fake.last().form!;
  eq(form.get('production_id'), 'p1', 'production:');
  eq(form.get('folder_id'), 'f1', 'folder:');
  eq((form.get('file') as File).name, 'logo.png', 'file:');
  eq((await production.storage.createFolder({ name: 'x' })).id, 'f9', 'createFolder unwraps the folder:');
});

await expect('files and folders', [
  [() => cino.files.get('fi1'), 'GET /api/storage/fi1'],
  [() => cino.files.rename('fi1', 'Logo'), 'PATCH /api/storage/fi1', { name: 'Logo' }],
  [() => cino.files.move('fi1', null), 'PATCH /api/storage/fi1', { folder_id: null }],
  [() => cino.files.remove('fi1'), 'DELETE /api/storage/fi1'],
  [() => cino.files.download('fi1', { quality: 80 }), 'GET /api/storage/fi1/serve?quality=80'],
  [() => cino.folders.update('f1', { hue: 40 }), 'PATCH /api/storage/folders/f1', { hue: 40 }],
  [() => cino.folders.remove('f1'), 'DELETE /api/storage/folders/f1'],
]);

await check('open asks for a byte range', async () => {
  await cino.files.open('fi1', { range: [100] });
  eq(fake.last().headers.get('range'), 'bytes=100-', 'open-ended:');
  await cino.files.open('fi1', { range: [0, 99] });
  eq(fake.last().headers.get('range'), 'bytes=0-99', 'closed:');
  eq((await cino.folders.remove('f1')).filesRemoved, 3, 'filesRemoved:');
});

await check('ids are encoded into paths', async () => {
  await cino.timeline('a/b c').get();
  eq(fake.last().path, '/api/timeline/a%2Fb%20c', 'path:');
});

await check('a token is required', () => {
  let message = '';
  try { new Cino({ url: 'https://cino.no', token: '' }); } catch (err) { message = (err as Error).message; }
  eq(message.includes('token'), true, 'refused:');
});

finish();
