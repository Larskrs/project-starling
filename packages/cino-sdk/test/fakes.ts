import type { Socket } from 'socket.io-client';
import type { SocketFactory } from '../src/live/liveTimeline.ts';
import type { Timers } from '../src/live/transport.ts';
import { PROTOCOL, TimelineEvent } from '../src/protocol.ts';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export interface Recorded {
  method: string;
  url: URL;
  /** Path and query, e.g. `/api/timelines?pid=p1`. */
  path: string;
  headers: Headers;
  body: unknown;
  form: FormData | null;
}

export function fakeFetch(handler: (request: Recorded) => Response | Promise<Response> = () => json({})) {
  const requests: Recorded[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const raw = init?.body;
    const request: Recorded = {
      method:  init?.method ?? 'GET',
      url,
      path:    url.pathname + url.search,
      headers: new Headers(init?.headers),
      body:    typeof raw === 'string' ? JSON.parse(raw) : undefined,
      form:    raw instanceof FormData ? raw : null,
    };
    requests.push(request);
    return handler(request);
  }) as typeof globalThis.fetch;

  return { fetch, requests, last: () => requests[requests.length - 1]! };
}

export interface FakeTimer {
  fn: () => void;
  ms: number;
  cancelled: boolean;
  fired: boolean;
}

export function fakeTimers() {
  const handles: FakeTimer[] = [];
  const timers: Timers = {
    setTimeout(fn, ms) {
      const handle: FakeTimer = { fn, ms, cancelled: false, fired: false };
      handles.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      (handle as FakeTimer).cancelled = true;
    },
  };
  return {
    timers,
    armed: () => handles.filter(h => !h.cancelled && !h.fired),
    fire(handle: FakeTimer | undefined) {
      if (!handle) throw new Error('no timer to fire');
      handle.fired = true;
      handle.fn();
    },
  };
}

type Handler = (...args: unknown[]) => void;

export interface FakeSocketOptions {
  joinAck?: unknown;
  /** A server this many ms ahead of the local clock. */
  skewMs?: number;
  answersPings?: boolean;
}

/** Enough of a socket.io client for the SDK. */
export function fakeSocket({
  joinAck = { ok: true, protocol: PROTOCOL, canEdit: true, canRename: true, users: [] },
  skewMs = 1000,
  answersPings = true,
}: FakeSocketOptions = {}) {
  const handlers = new Map<string, Handler[]>();
  const sent: Array<{ event: string; args: unknown[] }> = [];
  const pingTimes: number[] = [];
  let opened: { url: string; options: Record<string, unknown> } | null = null;
  let disconnects = 0;

  const fire = (event: string, ...args: unknown[]) => [...(handlers.get(event) ?? [])].forEach(fn => fn(...args));

  const socket = {
    id: 'sock-1',
    connected: false,
    io: { engine: { transport: { name: 'websocket' }, once() {} } },
    on(event: string, fn: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      return socket;
    },
    off(event: string, fn: Handler) {
      handlers.set(event, (handlers.get(event) ?? []).filter(h => h !== fn));
      return socket;
    },
    emit(event: string, ...args: unknown[]) {
      sent.push({ event, args });
      const ack = args[args.length - 1];
      if (event === TimelineEvent.join && typeof ack === 'function') queueMicrotask(() => ack(joinAck));
      return socket;
    },
    timeout() {
      return {
        emit(event: string, ...args: unknown[]) {
          sent.push({ event, args });
          const ack = args[args.length - 1] as (err: Error | null, value?: unknown) => void;
          if (event === TimelineEvent.timePing) {
            pingTimes.push(performance.now());
            setTimeout(() => answersPings
              ? ack(null, performance.timeOrigin + performance.now() + skewMs)
              : ack(new Error('operation has timed out')), 1);
          }
          if (event === TimelineEvent.clockResync) setTimeout(() => ack(null, { ok: true, requestId: 'run-1' }), 1);
        },
      };
    },
    disconnect() {
      disconnects++;
      if (socket.connected) {
        socket.connected = false;
        fire('disconnect', 'io client disconnect');
      }
      return socket;
    },
  };

  const io: SocketFactory = (url, options) => {
    opened = { url, options: options as Record<string, unknown> };
    return socket as unknown as Socket;
  };

  return {
    socket: socket as unknown as Socket,
    raw: socket,
    io,
    sent,
    pingTimes,
    fire,
    get opened() { return opened; },
    get disconnects() { return disconnects; },
    connect() { socket.connected = true; fire('connect'); },
    drop(reason = 'transport close') { socket.connected = false; fire('disconnect', reason); },
    push(event: string, payload?: unknown) { fire(event, payload); },
    /** A refused handshake; `data` is what the server attached, as socket.io passes it on. */
    connectError(message: string, data?: unknown) {
      fire('connect_error', Object.assign(new Error(message), data === undefined ? {} : { data }));
    },
  };
}
