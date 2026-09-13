import { readFileSync } from 'node:fs';
import { SOCKET_ID_HEADER, TimelineEvent } from '../src/protocol.ts';
import { check, eq, finish, section } from './harness.ts';

section('protocol');

await check('the SDK carries the current wire contract, unedited', () => {
  const generated = readFileSync(new URL('../src/protocol.ts', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../../realtime/src/index.ts', import.meta.url), 'utf8');
  eq(generated.startsWith('// GENERATED'), true, 'generated header:');
  eq(generated.endsWith(source), true, 'in step with packages/realtime (run npm run sync-protocol):');
});

await check('the events the SDK relies on exist', () => {
  const names = ['join', 'leave', 'presence', 'clipChange', 'trackChange', 'transportCommand', 'transportState',
    'timePing', 'clockResync', 'clockMeasure', 'clockReport', 'clockStatus'] as const;
  for (const name of names) eq(typeof TimelineEvent[name], 'string', `TimelineEvent.${name}:`);
  eq(SOCKET_ID_HEADER, 'x-socket-id', 'socket id header:');
});

finish();
