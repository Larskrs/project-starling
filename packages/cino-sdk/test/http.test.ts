import { CinoApiError } from '../src/core/errors.ts';
import { Http, normaliseUrl } from '../src/core/http.ts';
import { formWith } from '../src/core/upload.ts';
import { fakeFetch, json } from './fakes.ts';
import { check, eq, finish, ok, rejects, section } from './harness.ts';

const http = (handler?: Parameters<typeof fakeFetch>[0]) => {
  const fake = fakeFetch(handler);
  return { fake, http: new Http({ baseUrl: 'https://cino.no', token: 'cino_svc_test', fetch: fake.fetch }) };
};

section('requests');

await check('urls are normalised, and anything not http(s) or ws(s) is refused', () => {
  eq(normaliseUrl('https://cino.no///'), 'https://cino.no', 'trailing slashes:');
  eq(normaliseUrl('wss://cino.no'), 'https://cino.no', 'wss:');
  eq(normaliseUrl(' ws://localhost:3000 '), 'http://localhost:3000', 'ws:');
  let message = '';
  try { normaliseUrl('cino.no'); } catch (err) { message = (err as Error).message; }
  ok(message.includes('http(s)://'), 'refused:');
});

await check('every request carries the token; the query skips empty values', async () => {
  const { fake, http: client } = http(() => json({ ok: true }));
  await client.json('GET', '/storage', { query: { pid: 'p1', folder_id: null, type: undefined, n: 0 } });
  eq(fake.last().headers.get('authorization'), 'Bearer cino_svc_test', 'authorization:');
  eq(fake.last().path, '/api/storage?pid=p1&n=0', 'path:');
});

await check('a JSON body is typed; a form is left to set its own boundary', async () => {
  const { fake, http: client } = http();
  await client.json('POST', '/timelines', { body: { name: 'Act 1' } });
  eq(fake.last().headers.get('content-type'), 'application/json', 'json:');
  eq(JSON.stringify(fake.last().body), '{"name":"Act 1"}', 'body:');

  await client.json('POST', '/storage/upload', { form: formWith({ production_id: 'p1' }, { data: new Uint8Array([1, 2]), name: 'a.png', type: 'image/png' }) });
  eq(fake.last().headers.get('content-type'), null, 'form content type:');
  eq(fake.last().form?.get('production_id'), 'p1', 'form field:');
  eq((fake.last().form?.get('file') as File).name, 'a.png', 'file name:');
});

await check('the socket id goes on writes only', async () => {
  const { fake, http: client } = http();
  await client.json('GET', '/timeline/t', { socketId: 'sock-1' });
  eq(fake.last().headers.get('x-socket-id'), null, 'GET:');
  await client.json('PATCH', '/timeline/t', { body: {}, socketId: 'sock-1' });
  eq(fake.last().headers.get('x-socket-id'), 'sock-1', 'PATCH:');
});

await check('an empty response is null', async () => {
  const { http: client } = http(() => new Response(null, { status: 204 }));
  eq(await client.json('DELETE', '/storage/f1'), null, 'body:');
});

section('failures');

await check('a refusal becomes a CinoApiError with the server\'s key and permission', async () => {
  const { http: client } = http(() => json({ error: 'Missing permission', errorKey: 'errors.permission.missing', data: { missingPermission: 'MANAGE_STORAGE' } }, 403));
  const err = await rejects(client.json('POST', '/storage', { body: {} }), 'refused:') as CinoApiError;
  ok(err instanceof CinoApiError, 'type:');
  eq(err.status, 403, 'status:');
  eq(err.message, 'Missing permission', 'message:');
  eq(err.errorKey, 'errors.permission.missing', 'errorKey:');
  eq(err.missingPermission, 'MANAGE_STORAGE', 'missingPermission:');
  eq(err.isFatal, true, 'fatal:');
  eq(err.isAuth, false, 'auth:');
});

await check('auth keys, server errors and unreadable bodies', async () => {
  const auth = new CinoApiError(401, 'x', 'errors.auth.tokenExpired');
  eq(auth.isAuth && auth.isFatal, true, 'auth is fatal:');
  eq(new CinoApiError(503, 'x').isFatal, false, '503 is not:');
  const { http: client } = http(() => new Response('<html>', { status: 502 }));
  const err = await rejects(client.json('GET', '/timelines'), '502:') as CinoApiError;
  eq(err.message, 'GET /timelines failed (502)', 'fallback message:');
});

await check('a network failure is status 0; an abort is rethrown as is', async () => {
  const { http: down } = http(() => { throw new TypeError('fetch failed'); });
  const err = await rejects(down.json('GET', '/timelines'), 'network:') as CinoApiError;
  eq(err.status, 0, 'status:');
  ok(err.message.includes('fetch failed'), 'message:');

  const { http: aborted } = http(() => { throw new DOMException('aborted', 'AbortError'); });
  const abort = await rejects(aborted.json('GET', '/timelines'), 'abort:');
  eq(abort.name, 'AbortError', 'name:');
});

section('token');

await check('the token expiry is read from responses and announced when it changes', async () => {
  const expires = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const { http: client } = http(() => json({}, 200, { 'x-cino-token-expires': expires }));
  const seen: Date[] = [];
  const off = client.onTokenExpiry(date => seen.push(date));
  eq(client.tokenExpiresAt, null, 'before:');
  await client.json('GET', '/timelines');
  await client.json('GET', '/timelines');
  eq(client.tokenExpiresAt?.toISOString(), expires, 'after:');
  eq(seen.length, 1, 'announced once:');
  off();
});

finish();
