import { readFileSync } from 'node:fs';
import {
  PROTOCOL, PROTOCOL_ERROR, SOCKET_ID_HEADER, TimelineEvent,
  applyProgress, decodeAnchor, decodeClipAdd, decodeClipUpdate, decodeCommand, decodeMeasure, decodePresence,
  decodeReport, decodeStatus, decodeTrackAdd, decodeTrackOrder, encodeAnchor, encodeClip, encodeCommand, encodeMeasure,
  encodePatch, encodePresence, encodeProgress, encodeReport, encodeStatus, encodeTrack, isProtocolError, serverProtocolOf,
  type ClockSyncStatus,
} from '../src/protocol.ts';
import { check, eq, finish, ok, section } from './harness.ts';

/** What socket.io does to a payload on its way across. */
const wire = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

/** Deep equality that ignores key order. */
const same = (a: unknown, b: unknown): boolean => {
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, sorted(x)]))
    : v);
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
};

section('protocol');

await check('the SDK carries the current wire contract, unedited', () => {
  const generated = readFileSync(new URL('../src/protocol.ts', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../../realtime/src/index.ts', import.meta.url), 'utf8');
  eq(generated.startsWith('// GENERATED'), true, 'generated header:');
  eq(generated.endsWith(source), true, 'in step with packages/realtime (run npm run sync-protocol):');
});

await check('the events the SDK relies on exist, each with its own wire name', () => {
  const names = ['join', 'leave', 'presence', 'clipAdd', 'clipUpdate', 'clipRemove', 'trackAdd', 'trackUpdate',
    'trackRemove', 'trackOrder', 'transportCommand', 'transportState', 'timePing', 'clockResync', 'clockMeasure',
    'clockReport', 'clockStatus', 'clockProgress'] as const;
  for (const name of names) eq(typeof TimelineEvent[name], 'string', `TimelineEvent.${name}:`);
  const values = Object.values(TimelineEvent);
  eq(new Set(values).size, values.length, 'distinct wire names:');
  eq(SOCKET_ID_HEADER, 'x-socket-id', 'socket id header:');
});

await check('a handshake refused for its protocol says so, and names the server\'s', () => {
  const refused = Object.assign(new Error(PROTOCOL_ERROR), { data: { protocol: PROTOCOL + 1 } });
  eq(isProtocolError(refused), true, 'protocol error:');
  eq(serverProtocolOf(refused), PROTOCOL + 1, 'server protocol:');
  eq(isProtocolError(new Error('errors.auth.tokenExpired')), false, 'auth error:');
  eq(serverProtocolOf(new Error(PROTOCOL_ERROR)), null, 'no data:');
});

section('codec');

await check('an anchor survives the trip, and junk does not decode', () => {
  const state = { playing: true, frame: 1500.25, frameRate: 29.97, at: 1_726_221_450_123.4 };
  ok(same(decodeAnchor(wire(encodeAnchor(state))), state), 'round trip');
  eq(decodeAnchor([2, 1, 1, 25]), null, 'bad flag:');
  eq(decodeAnchor({ playing: true }), null, 'object:');
});

await check('commands travel as codes, and a play without a frame is refused on arrival', () => {
  eq(JSON.stringify(encodeCommand({ action: 'pause' })), '[0]', 'pause:');
  ok(same(decodeCommand(wire(encodeCommand({ action: 'seek', frame: 20 }))), { action: 'seek', frame: 20 }), 'seek');
  eq(decodeCommand(wire(encodeCommand({ action: 'play' }))), null, 'play without a frame:');
  eq(decodeCommand([7, 1]), null, 'unknown code:');
});

await check('a created clip leaves out nulls and timestamps, and decodes with the nulls back', () => {
  const row = {
    id: 'c1', trackId: 't1', label: 'Cue 12', position: 1500, fileId: null, mediaStart: null, end: null,
    sourceId: 's1', hue: null, data: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const sent = wire(encodeClip(row)) as Record<string, unknown>;
  eq(Object.keys(sent).join(), 'id,trackId,label,position,sourceId', 'sent fields:');
  const change = decodeClipAdd(sent);
  ok(change?.type === 'upsert', 'decoded as a created clip');
  const clip = (change as { clip: Record<string, unknown> }).clip;
  eq(clip.end, null, 'end restored:');
  eq(clip.data, null, 'data restored:');
  eq(decodeClipAdd({ id: 'c1', trackId: 't1' }), null, 'no position:');
});

await check('a track keeps what the editor reads from it', () => {
  const row = { id: 't1', timelineId: 'tl', name: 'Cameras', icon: null, sourceId: null, sortOrder: 2, createdAt: '2026-01-01T00:00:00.000Z' };
  const sent = wire(encodeTrack(row)) as Record<string, unknown>;
  eq(sent.timelineId, 'tl', 'timelineId:');
  eq(sent.createdAt, row.createdAt, 'createdAt:');
  eq('icon' in sent, false, 'null icon sent:');
  eq((decodeTrackAdd(sent) as { track: Record<string, unknown> }).track.icon, null, 'icon restored:');
});

await check('a patch carries only what the write touched, nulls included', () => {
  const stored = { id: 'c1', trackId: 't1', label: 'Cue 13', position: 1500, end: null, updatedAt: new Date() };
  eq(JSON.stringify(encodePatch(stored, ['label', 'end'])), '{"id":"c1","label":"Cue 13","end":null}', 'patch:');
  eq(decodeClipUpdate(wire(encodePatch(stored, ['label'])))?.type, 'patch', 'decoded:');
  eq(decodeClipUpdate({ label: 'no id' }), null, 'no id:');
});

await check('presence keeps the avatar colour to the second, and leaves a device bare', () => {
  const sent = wire(encodePresence([
    { id: 'u1', name: 'Ada', avatarImageId: null, createdAt: new Date('2024-03-01T10:20:30.456Z') },
    { id: 'u2', name: 'Bo', avatarImageId: 'img-1', createdAt: null },
    { id: 'token:d', name: 'Desk', avatarImageId: null, createdAt: null },
  ]));
  eq(JSON.stringify((sent as unknown[])[2]), '["token:d","Desk"]', 'device:');
  const users = decodePresence(sent);
  eq(users[0]!.createdAt, '2024-03-01T10:20:30.000Z', 'createdAt:');
  eq(users[1]!.avatarImageId, 'img-1', 'avatar:');
  eq(users[2]!.createdAt, null, 'device createdAt:');
  eq(decodePresence('nope').length, 0, 'junk:');
});

await check('a clock sync travels whole once, then as changes that never mutate what was held', () => {
  const status: ClockSyncStatus = {
    requestId: 'r1', state: 'measuring', requestedBy: { name: 'SM' }, deadlineMs: 4000, playHeld: false,
    clients: [{ id: 'a', name: 'A', state: 'waiting', rtt: null }, { id: 'b', name: 'B', state: 'waiting', rtt: null }],
  };
  const held = decodeStatus(wire(encodeStatus(status)))!;
  ok(same(held, status), 'round trip');

  const next = applyProgress(held, wire(encodeProgress({
    requestId: 'r1', state: 'done', playHeld: false, changes: [{ index: 1, state: 'synced', rtt: 18.5 }],
  })))!;
  eq(next.state, 'done', 'state:');
  eq(next.clients[1]!.rtt, 18.5, 'rtt:');
  eq(next.clients[0]!.state, 'waiting', 'untouched client:');
  eq(held.clients[1]!.state, 'waiting', 'the held status changed:');
  eq(applyProgress(held, ['other', 1, 0, []]), held, 'another run:');
  eq(applyProgress(null, ['r1', 1, 0, []]), null, 'no run held:');
});

await check('measure requests, reports and orders check their shape', () => {
  ok(same(decodeMeasure(wire(encodeMeasure({ requestId: 'r1', deadlineMs: 4000 }))), { requestId: 'r1', deadlineMs: 4000 }), 'measure');
  eq(decodeReport(wire(encodeReport({ requestId: 'r1', rtt: null })))?.rtt, null, 'null rtt:');
  eq(decodeReport(['r1', -1]), null, 'negative rtt:');
  eq(decodeReport([42, 10]), null, 'bad id:');
  eq(decodeTrackOrder(['a', 'b'])?.type, 'reorder', 'order:');
  eq(decodeTrackOrder(['a', 3]), null, 'bad order:');
});

finish();
