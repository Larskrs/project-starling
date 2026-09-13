import { Cino } from '../src/cino.ts';
import type { LiveEvents, LiveOptions, LiveTimeline } from '../src/live/liveTimeline.ts';
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
  w.socket.push('transport:state', { playing: true, frame, frameRate: 25, userId: 'u1', at: live.serverNow()! });
}

section('connecting');

await check('opens the timeline namespace with the token in the handshake', async () => {
  const w = world();
  const live = w.open();
  eq(w.socket.opened?.url, 'https://cino.no/timeline', 'url:');
  eq((w.socket.opened?.options.auth as { token: string }).token, 'cino_svc_test', 'token:');
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
  ok(w.socket.sent.some(s => s.event === 'timeline:join'), 'joined:');
  eq(live.tracks.list().length, 2, 'tracks:');
  eq(live.clips.list().length, 2, 'clips:');
  eq(live.source('s1')?.shortName, 'C1', 'source:');
  eq(live.ready, true, 'ready:');
  eq(Math.round(tokens[0]?.daysLeft ?? 0), 3, 'token days left:');
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

section('following');

await check('relays update the local copy; malformed ones are ignored', async () => {
  const { live, socket } = await readyWorld();
  const changes = collect(live, 'change');
  socket.push('clip:change', { type: 'upsert', trackId: 't1', clip: { id: 'A', trackId: 't1', position: 0, label: 'Opening' } });
  eq(live.clips.get('A')?.label, 'Opening', 'label:');
  eq(changes.length, 1, 'change events:');
  socket.push('clip:change', { type: 'explode' });
  socket.push('track:change', { type: 'remove' });
  eq(changes.length, 1, 'malformed relays applied:');
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
  socket.push('clock:measure', { requestId: 'run-9', deadlineMs: 4000 });
  await until(() => reports.length === 1, 'the report');
  const sent = socket.sent.find(s => s.event === 'clock:report')?.args[0] as { requestId: string; rtt: unknown };
  eq(sent.requestId, 'run-9', 'requestId:');
  eq(typeof sent.rtt, 'number', 'rtt measured:');
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
  const commands = socket.sent.filter(s => s.event === 'transport:command').map(s => s.args[0] as { action: string; frame?: number });
  eq(`${commands[0]!.action}:${commands[0]!.frame}`, 'play:100', 'play:');
  eq(commands.filter(c => c.action === 'seek').map(c => c.frame).join(), '20,50', 'seeks:');
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
  ok(socket.sent.some(s => s.event === 'timeline:leave'), 'left:');
  const err = await rejects(live.clips.update('A', { label: 'x' }), 'write after close:');
  ok(err.message.includes('closed'), 'message:');
});

await check('a url that is not http(s) or ws(s) is refused up front', () => {
  let message = '';
  try { new Cino({ url: 'cino.no', token: 't' }); } catch (err) { message = (err as Error).message; }
  ok(message.includes('http(s)://'), `message: ${message}`);
});

finish();
