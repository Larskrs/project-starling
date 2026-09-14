import { Cino } from '../src/cino.ts';
import type { LiveEvents, LiveOptions, LiveTimeline } from '../src/live/liveTimeline.ts';
import { PROTOCOL, PROTOCOL_ERROR, TimelineEvent as E } from '../src/protocol.ts';
import { fakeFetch, fakeSocket, json, type Recorded } from './fakes.ts';
import { check, eq, finish, ok, rejects, section, until } from './harness.ts';

const TIMELINE = { id: 'tl-1', productionId: 'p1', name: 'Act 1', frameRate: '25', startFrame: 0, endFrame: 9000 };
const TRACKS = [
  { id: 't1', name: 'Programme', sortOrder: 0, clips: [
    { id: 'A', trackId: 't1', position: 0,   label: 'Wide',  sourceId: 's1', mediaStart: null, end: null },
    { id: 'B', trackId: 't1', position: 500, label: 'Close', sourceId: 's2', mediaStart: null, end: null },
  ] },
  { id: 't2', name: 'Lights', sortOrder: 1, clips: [] },
];

function world({ failures = 0, status = 200, joinAck }: { failures?: number; status?: number; joinAck?: unknown } = {}) {
  const socket = fakeSocket({ joinAck });
  let failuresLeft = failures;

  const server = fakeFetch((request: Recorded) => {
    const { method, path } = request;
    if (method === 'GET' && path === '/api/timeline/tl-1') {
      if (failuresLeft > 0) { failuresLeft--; return json({ error: 'database unavailable' }, 503); }
      if (status !== 200) return json({ errorKey: 'errors.auth.tokenExpired' }, status);
      return json(
        { timeline: TIMELINE, tracks: TRACKS, trackTypes: [], canEdit: true,
          sources: [{ id: 's1', name: 'Camera 1', shortName: 'C1' }, { id: 's2', name: 'Camera 2', shortName: 'C2' }] },
        200, { 'x-cino-token-expires': new Date(Date.now() + 3 * 86_400_000).toISOString() },
      );
    }
    if (method === 'PATCH' && path.startsWith('/api/timeline/tl-1/clips/')) {
      return json({ id: 'B', trackId: 't1', position: 500, sourceId: 's2', mediaStart: null, end: null, label: 'Close', ...(request.body as object) });
    }
    if (method === 'DELETE') return json({ ok: true });
    return json({ id: 'p1' });
  });

  const open = (options: LiveOptions = {}) =>
    new Cino({ url: 'https://cino.no/', token: 'cino_svc_test', fetch: server.fetch, io: socket.io }).connect('tl-1', { stallWarnMs: 0, ...options });

  return { socket, server, open };
}

function collect<K extends keyof LiveEvents>(live: LiveTimeline, event: K): LiveEvents[K][] {
  const seen: LiveEvents[K][] = [];
  live.on(event, payload => { seen.push(payload); });
  return seen;
}

async function readyWorld() {
  const w = world();
  const live = w.open();
  w.socket.connect();
  await live.whenReady();
  return { ...w, live };
}

async function playing(live: LiveTimeline, w: ReturnType<typeof world>, frame: number) {
  await until(() => live.clock.synced, 'clock sync');
  w.socket.push(E.transportState, [1, frame, live.serverNow()!, 25]);
}

section('connecting');

await check('opens the timeline namespace with the token and the protocol in the handshake', async () => {
  const w = world();
  const live = w.open();
  const auth = w.socket.opened?.options.auth as { token: string; protocol: number };
  eq(w.socket.opened?.url, 'https://cino.no/timeline', 'url:');
  eq(auth.token, 'cino_svc_test', 'token:');
  eq(auth.protocol, PROTOCOL, 'protocol:');
  eq(w.socket.opened?.options.path, '/socket', 'path:');
  eq((w.socket.opened?.options.transports as string[]).join(), 'polling,websocket', 'transports:');
  live.close();
});

await check('on connect it fetches the whole timeline, joins, and is ready', async () => {
  const w = world();
  const live = w.open();
  const tokens = collect(live, 'token');
  w.socket.connect();
  const info = await live.whenReady();
  eq(info.name, 'Act 1', 'name:');
  eq(info.frameRate, 25, 'frameRate:');
  eq(info.productionId, 'p1', 'productionId:');
  eq(w.server.requests[0]!.headers.get('authorization'), 'Bearer cino_svc_test', 'authorization:');
  ok(w.socket.sent.some(s => s.event === E.join && s.args[0] === 'tl-1'), 'joined by id:');
  eq(live.tracks.list().length, 2, 'tracks:');
  eq(live.clips.list().length, 2, 'clips:');
  eq(live.source('s1')?.shortName, 'C1', 'source:');
  eq(live.ready, true, 'ready:');
  eq(Math.round(tokens[0]?.daysLeft ?? 0), 3, 'token days left:');
  live.close();
});

await check('the join ack brings the room — occupants, a playing anchor, a sync in progress — before ready', async () => {
  const w = world({ joinAck: {
    ok: true, protocol: PROTOCOL, canEdit: false, canRename: true,
    users:  [['u1', 'Ada', null, 1_700_000_000], ['token:d1', 'Desk']],
    anchor: [1, 250, 123_456.5, 25],
    sync:   ['run-3', 0, 1, 'Stage manager', 4000, [['u1', 'Ada', 0], ['token:d1', 'Desk', 1, 18]]],
  } });
  const live = w.open();
  const order: string[] = [];
  const presence = collect(live, 'presence');
  const syncs = collect(live, 'sync');
  for (const name of ['presence', 'transport', 'sync', 'ready'] as const) live.on(name, () => { order.push(name); });
  w.socket.connect();
  await live.whenReady();
  eq(order.join(), 'presence,transport,sync,ready', 'order:');
  eq(presence[0]!.map(u => u.name).join(), 'Ada,Desk', 'occupants:');
  eq(presence[0]![0]!.createdAt, new Date(1_700_000_000_000).toISOString(), 'createdAt:');
  eq(presence[0]![1]!.createdAt, null, 'a device has no createdAt:');
  eq(live.transport?.playing, true, 'playing:');
  eq(live.transport?.frame, 250, 'anchor frame:');
  eq(syncs[0]!.playHeld, true, 'play held:');
  eq(syncs[0]!.clients[1]!.rtt, 18, 'client rtt:');
  eq(live.canEdit, false, 'canEdit:');
  live.close();
});

await check('a reconnect fetches again, and says it is a reconnect', async () => {
  const w = world();
  const live = w.open();
  const ready = collect(live, 'ready');
  w.socket.connect();
  await until(() => ready.length === 1, 'first ready');
  w.socket.drop();
  eq(live.ready, false, 'ready while dropped:');
  w.socket.connect();
  await until(() => ready.length === 2, 'second ready');
  eq(ready[1]!.reconnected, true, 'reconnected:');
  eq(w.server.requests.filter(r => r.method === 'GET').length, 2, 'fetches:');
  live.close();
});

await check('a failed fetch is retried, not fatal', async () => {
  const w = world({ failures: 1 });
  const live = w.open();
  const errors = collect(live, 'error');
  w.socket.connect();
  await live.whenReady();
  eq(errors.length, 1, 'errors:');
  eq(errors[0]!.retrying, true, 'retrying:');
  live.close();
});

await check('a reconnect while the fetch is out joins once, with the newest timeline', async () => {
  const socket = fakeSocket();
  const held: Array<() => void> = [];
  let fetches = 0;
  const fetch = (async () => {
    const n = ++fetches;
    if (n === 1) await new Promise<void>(resolve => held.push(resolve));
    return json({ timeline: { ...TIMELINE, name: n === 1 ? 'stale' : 'fresh' }, tracks: TRACKS, trackTypes: [], sources: [], canEdit: true });
  }) as typeof globalThis.fetch;
  const live = new Cino({ url: 'https://cino.no', token: 'cino_svc_test', fetch, io: socket.io }).connect('tl-1', { stallWarnMs: 0 });
  const ready = collect(live, 'ready');

  socket.connect();
  await until(() => held.length === 1, 'first fetch');
  socket.drop();
  socket.connect();
  await live.whenReady();
  held[0]!();
  await new Promise(resolve => setTimeout(resolve, 10));

  eq(ready.length, 1, 'ready events:');
  eq(socket.sent.filter(s => s.event === E.join).length, 1, 'joins:');
  eq(live.timeline?.name, 'fresh', 'timeline:');
  live.close();
});

section('following');

await check('relays update the local copy; malformed ones are ignored', async () => {
  const { live, socket } = await readyWorld();
  const changes = collect(live, 'change');

  socket.push(E.clipUpdate, { id: 'A', label: 'Opening' });
  eq(live.clips.get('A')?.label, 'Opening', 'patched label:');
  eq(live.clips.get('A')?.sourceId, 's1', 'fields the patch did not carry are kept:');

  socket.push(E.clipAdd, { id: 'N', trackId: 't2', position: 40, label: 'New' });
  eq(live.clips.get('N')?.position, 40, 'added:');
  eq(live.clips.get('N')?.row.end, null, 'left-out nulls restored:');

  socket.push(E.clipRemove, 'B');
  eq(live.clips.get('B'), null, 'removed:');

  socket.push(E.trackOrder, ['t2', 't1']);
  eq(live.tracks.list()[0]?.id, 't2', 'reordered:');
  eq(changes.length, 4, 'change events:');

  socket.push(E.clipAdd, { type: 'explode' });
  socket.push(E.trackRemove, 42);
  socket.push(E.clipUpdate, { id: 'ghost', label: 'never fetched' });
  eq(changes.length, 4, 'malformed or unknown relays applied:');
  eq(live.clips.get('ghost'), null, 'a patch invented a clip:');
  live.close();
});

await check('a playing transport produces clip events on its own, per track too', async () => {
  const w = await readyWorld();
  const clips = collect(w.live, 'clip');
  const programme: string[] = [];
  const lights: string[] = [];
  w.live.onTrack('programme', event => programme.push(event.clip?.id ?? '-'));
  w.live.onTrack('t2', event => lights.push(event.clip?.id ?? '-'));
  await playing(w.live, w, 250);
  await until(() => clips.length > 0, 'a clip event');
  eq(clips[0]!.clip?.id, 'A', 'live clip:');
  eq(programme.join(), 'A', 'onTrack by name:');
  eq(lights.length, 0, 'other track:');
  eq(w.live.clips.live('t1')?.id, 'A', 'live():');
  w.live.close();
});

await check('a cue set by timecode fires as playback crosses it', async () => {
  const w = await readyWorld();
  const fired: number[] = [];
  w.live.cue('00:00:10:02', event => fired.push(event.frame));
  await playing(w.live, w, 251);
  await until(() => fired.length === 1, 'the cue');
  eq(fired[0], 252, 'frame:');
  w.live.close();
});

await check('answers a clock sync with a fresh measurement', async () => {
  const { live, socket } = await readyWorld();
  const reports = collect(live, 'syncReport');
  socket.push(E.clockMeasure, ['run-9', 4000]);
  await until(() => reports.length === 1, 'the report');
  const sent = socket.sent.find(s => s.event === E.clockReport)?.args[0] as [string, number | null];
  eq(sent[0], 'run-9', 'requestId:');
  eq(typeof sent[1], 'number', 'rtt measured:');
  live.close();
});

await check('clock sync progress folds into the run it belongs to, and nothing else', async () => {
  const { live, socket } = await readyWorld();
  const syncs = collect(live, 'sync');
  socket.push(E.clockStatus, ['run-4', 0, 0, 'Stage manager', 4000, [['a', 'A', 0], ['b', 'B', 0]]]);
  socket.push(E.clockProgress, ['run-4', 0, 0, [[1, 1, 18]]]);
  eq(syncs.length, 2, 'sync events:');
  eq(syncs[1]!.clients[1]!.state, 'synced', 'b:');
  eq(syncs[1]!.clients[1]!.rtt, 18, 'b rtt:');
  eq(syncs[0]!.clients[1]!.state, 'waiting', 'the earlier event changed:');
  socket.push(E.clockProgress, ['another-run', 1, 0, []]);
  eq(syncs.length, 2, 'progress for another run:');
  socket.push(E.clockProgress, ['run-4', 1, 0, [[0, 3]]]);
  eq(syncs[2]!.state, 'done', 'done:');
  eq(syncs[2]!.clients[0]!.state, 'no-report', 'a:');
  live.close();
});

section('reading');

await check('tracks by name, timecode, and what is playing where', async () => {
  const { live } = await readyWorld();
  eq(live.tracks.find(' PROGRAMME ')?.id, 't1', 'find by name:');
  eq(live.tracks.find('t2')?.name, 'Lights', 'find by id:');
  eq(live.tracks.find('nope'), null, 'unknown:');
  eq(live.timecode(500), '00:00:20:00', 'timecode:');
  eq(live.toFrame('00:00:20:00'), 500, 'toFrame:');
  eq(live.clips.nowPlaying(250).map(n => `${n.track.name}:${n.clip.id}`).join(), 'Programme:A', 'nowPlaying at a frame:');
  eq(live.clips.nowPlaying('00:00:20:00')[0]?.clip.id, 'B', 'nowPlaying at a timecode:');
  eq(live.clips.nowPlaying().length, 0, 'no playhead yet:');
  live.close();
});

await check('the production is reachable once the timeline is known', async () => {
  const w = world();
  const live = w.open();
  eq(live.production, null, 'before ready:');
  w.socket.connect();
  await live.whenReady();
  eq(live.production?.id, 'p1', 'id:');
  eq(live.production, live.production, 'cached:');
  await live.production!.storage.stats();
  eq(w.server.last().path, '/api/production/p1/storage-stats', 'request:');
  live.close();
});

section('acting');

await check('a write goes over REST with the socket id, and updates the local copy at once', async () => {
  const { live, server } = await readyWorld();
  const changes = collect(live, 'change');
  const updated = await live.clips.rename('B', 'Close up');
  const patch = server.last();
  eq(patch.headers.get('x-socket-id'), 'sock-1', 'x-socket-id:');
  eq(JSON.stringify(patch.body), '{"label":"Close up"}', 'body:');
  eq(updated?.label, 'Close up', 'returned clip:');
  eq(live.clips.get('B')?.label, 'Close up', 'local copy:');
  eq(changes[changes.length - 1]?.kind, 'clip', 'change event:');

  await live.clips.move('B', '00:00:30:00');
  eq(JSON.stringify(server.last().body), '{"position":750}', 'move by timecode:');
  eq(live.clips.get('B')?.position, 750, 'moved locally:');

  await live.clips.remove('B');
  eq(live.clips.get('B'), null, 'removed locally:');
  live.close();
});

await check('transport commands take timecodes, and a burst of seeks is throttled to its last frame', async () => {
  const { live, socket } = await readyWorld();
  eq(live.play('00:00:04:00'), true, 'play sent:');
  for (const frame of [20, 30, 40, '00:00:02:00']) live.seek(frame);
  await new Promise(r => setTimeout(r, 150));
  eq(live.pause(), true, 'pause sent:');
  const commands = socket.sent.filter(s => s.event === E.transportCommand).map(s => s.args[0] as number[]);
  eq(JSON.stringify(commands[0]), '[1,100]', 'play:');
  eq(commands.filter(c => c[0] === 2).map(c => c[1]).join(), '20,50', 'seeks:');
  eq(JSON.stringify(commands[commands.length - 1]), '[0]', 'pause:');
  const ack = await live.syncClocks();
  eq('ok' in ack && ack.requestId, 'run-1', 'syncClocks ack:');
  live.close();
  eq(live.play(0), false, 'play after close:');
});

section('stopping');

await check('a dead token at the handshake stops the client for good', async () => {
  const w = world();
  const live = w.open();
  const failures = collect(live, 'authFailed');
  const ready = live.whenReady().then(() => 'ready', () => 'rejected');
  w.socket.connectError('errors.auth.tokenExpired');
  eq(failures[0]?.errorKey, 'errors.auth.tokenExpired', 'errorKey:');
  eq(live.closed, true, 'closed:');
  ok(w.socket.disconnects > 0, 'disconnected:');
  eq(await ready, 'rejected', 'whenReady:');
});

await check('a server on another protocol stops the client and says which side is behind', async () => {
  const w = world();
  const live = w.open();
  const incompatible = collect(live, 'incompatible');
  const failures = collect(live, 'authFailed');
  const ready = live.whenReady().then(() => 'ready', (err: Error) => err.message);
  w.socket.connectError(PROTOCOL_ERROR, { protocol: PROTOCOL + 1 });
  eq(incompatible[0]?.serverProtocol, PROTOCOL + 1, 'server protocol:');
  eq(incompatible[0]?.clientProtocol, PROTOCOL, 'client protocol:');
  ok(incompatible[0]?.message.includes('update cino-sdk'), `message: ${incompatible[0]?.message}`);
  eq(failures.length, 0, 'reported as an auth failure:');
  eq(live.closed, true, 'closed:');
  ok((await ready).includes('update cino-sdk'), 'whenReady rejects with the reason:');
});

await check('a token refused during the fetch stops it too', async () => {
  const w = world({ status: 401 });
  const live = w.open();
  const failures = collect(live, 'authFailed');
  w.socket.connect();
  await until(() => failures.length === 1, 'authFailed');
  eq(failures[0]!.errorKey, 'errors.auth.tokenExpired', 'errorKey:');
  eq(live.closed, true, 'closed:');
});

await check('access revoked while connected stops it', async () => {
  const { live, socket } = await readyWorld();
  const failures = collect(live, 'authFailed');
  socket.push('access:revoked', { reason: 'errors.auth.tokenInvalid' });
  eq(failures[0]?.errorKey, 'errors.auth.tokenInvalid', 'errorKey:');
  eq(live.connected, false, 'connected:');
});

await check('close leaves the room and refuses further writes', async () => {
  const { live, socket } = await readyWorld();
  live.close();
  ok(socket.sent.some(s => s.event === E.leave), 'left:');
  const err = await rejects(live.clips.update('A', { label: 'x' }), 'write after close:');
  ok(err.message.includes('closed'), 'message:');
});

await check('a url that is not http(s) or ws(s) is refused up front', () => {
  let message = '';
  try { new Cino({ url: 'cino.no', token: 't' }); } catch (err) { message = (err as Error).message; }
  ok(message.includes('http(s)://'), `message: ${message}`);
});

finish();
