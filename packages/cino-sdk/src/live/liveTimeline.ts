import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';
import { ClipsApi } from '../api/clips.ts';
import { ProductionApi } from '../api/production.ts';
import { TracksApi } from '../api/tracks.ts';
import { startClockSync } from '../clock/clockSync.ts';
import { answerMeasure } from '../clock/resync.ts';
import { createServerClock } from '../clock/serverClock.ts';
import { createEmitter, type Emitter } from '../core/emitter.ts';
import { CinoApiError } from '../core/errors.ts';
import { encode, type Http } from '../core/http.ts';
import { fps, fromTimecode, isDropFrame, toTimecode } from '../core/timecode.ts';
import {
  TIMELINE_NAMESPACE, TimelineEvent, isClipChange, isTrackChange,
  type ClipChange, type ClockMeasureRequest, type ClockReport, type ClockResyncAck, type ClockSyncStatus,
  type JoinAck, type PresenceUser, type TrackChange, type TransportState,
} from '../protocol.ts';
import type { ClipInput, ClipPatch, FrameRate, Source, TimelineSnapshot, TrackInput, TrackPatch, TrackType } from '../types.ts';
import { createClipScheduler, type ClipEvent } from './clipScheduler.ts';
import { createCueScheduler, type CueListener } from './cues.ts';
import { createTimelineModel, type Clip, type Row, type Track, type TrackRow } from './timelineModel.ts';
import { background, frameAt, TICK_MS } from './transport.ts';

export type SocketFactory = (url: string, options: Partial<ManagerOptions & SocketOptions>) => Socket;

/** A frame number, or a timecode such as `01:02:03:04`. */
export type FrameOrTimecode = number | string;

export interface LiveOptions {
  /** Announce clips and cues this many ms early: the latency of whatever acts on them. */
  leadMs?: number;
  /** Defaults to polling with a WebSocket upgrade, which works behind proxies that refuse the upgrade. */
  transports?: Array<'polling' | 'websocket'>;
  /** Emit `stall` when the process freezes for longer than this. 0 turns it off. Default 250. */
  stallWarnMs?: number;
}

export interface TimelineInfo {
  readonly id: string;
  readonly productionId: string;
  readonly name: string;
  readonly frameRate: number;
  readonly frameRateName: FrameRate;
  readonly dropFrame: boolean;
  readonly startFrame: number;
  readonly endFrame: number | null;
  readonly row: Row;
}

export type ChangeEvent =
  | { kind: 'clip'; change: ClipChange }
  | { kind: 'track'; change: TrackChange }
  | { kind: 'refresh' };

export interface LiveEvents extends Record<string, unknown> {
  /** Fetched and joined, on every connect. */
  ready: { timeline: TimelineInfo; reconnected: boolean; canEdit: boolean };
  clip: ClipEvent;
  transport: TransportState;
  change: ChangeEvent;
  presence: PresenceUser[];
  clock: { outcome: 'first' | 'step' | 'jump'; offsetMs: number; errorMs: number };
  /** A room-wide clock sync's progress. */
  sync: ClockSyncStatus;
  /** This client answered a clock sync. */
  syncReport: ClockReport;
  token: { expiresAt: Date; daysLeft: number };
  /** Clip events and cues keep coming from the last known state until the connection is back. */
  disconnected: { reason: string };
  /** The credential is dead or revoked. The client has stopped and will not retry. */
  authFailed: { errorKey: string | null; message: string };
  error: { error: Error; retrying: boolean };
  stall: { ms: number };
}

export interface NowPlaying {
  track: Track;
  clip: Clip;
}

export type LiveClipInput = Omit<ClipInput, 'position'> & { position: FrameOrTimecode };

export interface LiveTracks {
  /** In the editor's order. */
  list(): readonly Track[];
  get(trackId: string): Track | null;
  /** By id, or by name ignoring case. */
  find(nameOrId: string): Track | null;
  create(input: TrackInput): Promise<Track | null>;
  update(trackId: string, patch: TrackPatch): Promise<Track | null>;
  remove(trackId: string): Promise<void>;
  reorder(trackIds: readonly string[]): Promise<void>;
}

export interface LiveClips {
  /** A track's clips by position, or every clip. */
  list(trackId?: string): readonly Clip[];
  get(clipId: string): Clip | null;
  /** The clip live on a track at a frame or timecode, or at the playhead. */
  live(trackId: string, at?: FrameOrTimecode): Clip | null;
  /** Every track's live clip at a frame or timecode, or at the playhead. */
  nowPlaying(at?: FrameOrTimecode): NowPlaying[];
  create(input: LiveClipInput): Promise<Clip | null>;
  /** Send only the fields being changed. */
  update(clipId: string, patch: ClipPatch): Promise<Clip | null>;
  rename(clipId: string, label: string): Promise<Clip | null>;
  move(clipId: string, to: FrameOrTimecode): Promise<Clip | null>;
  remove(clipId: string): Promise<void>;
}

export interface LiveTimeline extends Emitter<LiveEvents> {
  readonly timeline: TimelineInfo | null;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly closed: boolean;
  readonly canEdit: boolean;
  readonly clock: { readonly synced: boolean; readonly offsetMs: number | null; readonly errorMs: number | null };
  readonly transport: TransportState | null;
  readonly sources: readonly Source[];
  readonly trackTypes: readonly TrackType[];
  readonly tracks: LiveTracks;
  readonly clips: LiveClips;
  /** The timeline's production, once fetched. */
  readonly production: ProductionApi | null;

  serverNow(): number | null;
  currentFrame(): number | null;
  /** The playhead at a server clock time. */
  frameAt(serverTime: number): number | null;
  /** A frame (or the playhead) as timecode in the timeline's rate. */
  timecode(frame?: number): string | null;
  toFrame(at: FrameOrTimecode): number;
  source(sourceId: string | null | undefined): Source | null;

  /** Clip events for one track, by id or name. */
  onTrack(nameOrId: string, listener: (event: ClipEvent) => void): () => void;
  /** Runs `listener` each time playback crosses a frame, a timecode, or a frame worked out on every tick. */
  cue(at: FrameOrTimecode | (() => number | null), listener: CueListener): () => void;

  play(from?: FrameOrTimecode): boolean;
  pause(): boolean;
  seek(to: FrameOrTimecode): boolean;
  /** Make every client in the room re-measure its clock. Play is held until they have. */
  syncClocks(): Promise<ClockResyncAck>;

  refresh(): Promise<void>;
  whenReady(): Promise<TimelineInfo>;
  close(): void;
}

export interface LiveTimelineConfig {
  http: Http;
  io: SocketFactory;
  timelineId: string;
  options?: LiveOptions;
}

const SEEK_THROTTLE_MS = 100;
const RETRY_BASE_MS    = 1000;
const RETRY_MAX_MS     = 30_000;
const STALL_CHECK_MS   = 1000;
const DAY_MS           = 86_400_000;
const EMPTY: readonly never[] = Object.freeze([]);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function toInfo(snapshot: TimelineSnapshot): TimelineInfo {
  const row = snapshot.timeline;
  const rate = (String(row.frameRate ?? '25') as FrameRate);
  return Object.freeze({
    id:            row.id,
    productionId:  row.productionId,
    name:          row.name,
    frameRate:     fps(rate),
    frameRateName: rate,
    dropFrame:     isDropFrame(rate),
    startFrame:    typeof row.startFrame === 'number' ? row.startFrame : 0,
    endFrame:      typeof row.endFrame === 'number' ? row.endFrame : null,
    row:           Object.freeze({ ...row }),
  });
}

export function createLiveTimeline({ http, io, timelineId, options = {} }: LiveTimelineConfig): LiveTimeline {
  if (!timelineId) throw new TypeError('cino-sdk: a timelineId is required');
  const stallMs = options.stallWarnMs ?? 250;
  const leadMs = options.leadMs ?? 0;

  const events = createEmitter<LiveEvents>();
  const model  = createTimelineModel();
  const clock  = createServerClock();

  let info: TimelineInfo | null = null;
  let production: ProductionApi | null = null;
  let sources: readonly Source[] = EMPTY;
  let sourceById = new Map<string, Source>();
  let trackTypes: readonly TrackType[] = EMPTY;
  let canEdit = false;
  let transport: TransportState | null = null;
  let isReady = false;
  let everReady = false;
  let closed = false;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const intervals: Array<ReturnType<typeof setInterval>> = [];

  let resolveReady!: (info: TimelineInfo) => void;
  let rejectReady!: (err: Error) => void;
  const firstReady = new Promise<TimelineInfo>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  firstReady.catch(() => {});

  const socket = io(`${http.baseUrl}${TIMELINE_NAMESPACE}`, {
    path:       '/socket',
    transports: options.transports ?? ['polling', 'websocket'],
    auth:       { token: http.token },
  });

  const socketId = () => (socket.connected ? socket.id : null);
  const restTracks = new TracksApi(http, timelineId, socketId);
  const restClips  = new ClipsApi(http, timelineId, socketId);

  const scheduler = createClipScheduler({
    model,
    leadMs,
    serverNow: () => clock.now(),
    onClip:    event => events.emit('clip', event),
  });

  const cues = createCueScheduler({ serverNow: () => clock.now(), transport: () => transport, leadMs });

  // Registered before the connect handler below, so the first ping is already out when the join answers.
  const clockSync = startClockSync(socket, clock, (outcome) => {
    if (outcome !== 'first' && outcome !== 'step' && outcome !== 'jump') return;
    events.emit('clock', { outcome, offsetMs: clock.offset ?? 0, errorMs: (clock.rtt ?? 0) / 2 });
  });

  intervals.push(background(setInterval(() => { scheduler.tick(); cues.tick(); }, TICK_MS)));

  if (stallMs > 0) {
    let last = performance.now();
    intervals.push(background(setInterval(() => {
      const now = performance.now();
      const stall = now - last - STALL_CHECK_MS;
      last = now;
      if (stall > stallMs) events.emit('stall', { ms: Math.round(stall) });
    }, STALL_CHECK_MS)));
  }

  // ── Frames and timecode ─────────────────────────────────────────────────────

  function toFrame(at: FrameOrTimecode): number {
    if (typeof at === 'number') return at;
    if (!info) throw new Error('cino-sdk: a timecode needs the timeline\'s frame rate; wait for ready');
    return fromTimecode(at, info.frameRateName);
  }

  const playhead = () => scheduler.currentFrame();

  // ── Local copy ──────────────────────────────────────────────────────────────

  function applyClip(change: ClipChange): void {
    if (!model.applyClipChange(change)) return;
    scheduler.invalidate();
    events.emit('change', { kind: 'clip', change });
  }

  function applyTrack(change: TrackChange): void {
    if (!model.applyTrackChange(change)) return;
    scheduler.invalidate();
    events.emit('change', { kind: 'track', change });
  }

  async function loadTimeline(): Promise<void> {
    const snapshot = await http.json<TimelineSnapshot>('GET', `/timeline/${encode(timelineId)}`);
    model.load((snapshot.tracks ?? []) as unknown as TrackRow[]);
    info       = toInfo(snapshot);
    sources    = Object.freeze([...(snapshot.sources ?? [])]);
    sourceById = new Map(sources.map(source => [source.id, source]));
    trackTypes = Object.freeze([...(snapshot.trackTypes ?? [])]);
    canEdit    = snapshot.canEdit === true;
    if (production?.id !== info.productionId) production = null;
    scheduler.invalidate();
    events.emit('change', { kind: 'refresh' });

    const expiresAt = http.tokenExpiresAt;
    if (expiresAt) events.emit('token', { expiresAt, daysLeft: (expiresAt.getTime() - Date.now()) / DAY_MS });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  function shutdown(): void {
    closed  = true;
    isReady = false;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    for (const interval of intervals) clearInterval(interval);
    clockSync.stop();
    scheduler.reset();
    cues.clear();
    socket.disconnect();
  }

  function stop(errorKey: string | null, message: string): void {
    if (closed) return;
    shutdown();
    events.emit('authFailed', { errorKey, message });
    rejectReady(new CinoApiError(401, message, errorKey));
  }

  async function onConnect(): Promise<void> {
    if (closed) return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    // What was live described a room we stopped watching; the join brings a fresh anchor.
    scheduler.reset();
    transport = null;
    cues.transportChanged();

    try {
      await loadTimeline();
    } catch (err) {
      if (closed) return;
      if (err instanceof CinoApiError && err.isFatal) { stop(err.errorKey, err.message); return; }
      events.emit('error', { error: err as Error, retrying: true });
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retries++);
      retryTimer = background(setTimeout(() => {
        retryTimer = null;
        if (socket.connected) void onConnect();
      }, delay));
      return;
    }
    retries = 0;
    if (closed || !socket.connected) return;

    socket.emit(TimelineEvent.join, { timelineId }, (ack: JoinAck | undefined) => {
      if (closed) return;
      if (!ack || 'error' in ack) {
        stop(null, `the server refused to join this timeline: ${ack?.error ?? 'no answer'}`);
        return;
      }
      canEdit = ack.canEdit;
      const reconnected = everReady;
      everReady = true;
      isReady   = true;
      events.emit('ready', { timeline: info!, reconnected, canEdit });
      resolveReady(info!);
    });
  }

  socket.on('connect', () => { void onConnect(); });

  socket.on('disconnect', (reason: string) => {
    isReady = false;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (!closed) events.emit('disconnected', { reason });
  });

  socket.on('connect_error', (err: Error) => {
    if (closed) return;
    if (err.message.startsWith('errors.auth.')) { stop(err.message, err.message); return; }
    events.emit('error', { error: err, retrying: true });
  });

  socket.on('access:revoked', (payload?: { reason?: unknown }) => {
    stop(typeof payload?.reason === 'string' ? payload.reason : null, 'access to this timeline was revoked');
  });

  socket.on(TimelineEvent.presence, (users: PresenceUser[]) => events.emit('presence', users));

  socket.on(TimelineEvent.transportState, (state: TransportState) => {
    transport = state;
    scheduler.setTransport(state);
    cues.transportChanged();
    events.emit('transport', state);
  });

  socket.on(TimelineEvent.clipChange, (change: unknown) => { if (isClipChange(change)) applyClip(change); });
  socket.on(TimelineEvent.trackChange, (change: unknown) => { if (isTrackChange(change)) applyTrack(change); });

  socket.on(TimelineEvent.clockMeasure, async (request: ClockMeasureRequest) => {
    if (closed || typeof request?.requestId !== 'string') return;
    const report = await answerMeasure(request, {
      measure: () => clockSync.measure(),
      get rtt() { return clock.rtt; },
    });
    if (closed || !socket.connected) return;
    socket.emit(TimelineEvent.clockReport, report);
    events.emit('syncReport', report);
  });

  socket.on(TimelineEvent.clockStatus, (status: ClockSyncStatus) => events.emit('sync', status));

  // ── Transport commands ──────────────────────────────────────────────────────

  let lastSeekAt = -Infinity;
  let pendingSeek: ReturnType<typeof setTimeout> | null = null;
  let pendingFrame = 0;

  function cancelSeek(): void {
    if (pendingSeek) clearTimeout(pendingSeek);
    pendingSeek = null;
  }

  function command(payload: { action: 'play' | 'pause' | 'seek'; frame?: number }): boolean {
    if (closed || !socket.connected) return false;
    socket.emit(TimelineEvent.transportCommand, payload);
    return true;
  }

  function requireOpen(): void {
    if (closed) throw new Error('cino-sdk: this connection is closed');
  }

  let allClips: { version: number; clips: readonly Clip[] } | null = null;

  // ── Tracks and clips ────────────────────────────────────────────────────────

  const tracks: LiveTracks = {
    list: () => model.tracks(),
    get:  trackId => model.track(trackId),
    find: nameOrId => model.track(nameOrId) ?? model.tracks().find(track => sameName(track.name, nameOrId)) ?? null,

    async create(input) {
      requireOpen();
      const row = await restTracks.create(input);
      applyTrack({ type: 'upsert', track: row });
      return model.track(row.id);
    },
    async update(trackId, patch) {
      requireOpen();
      const row = await restTracks.update(trackId, patch);
      applyTrack({ type: 'upsert', track: row });
      return model.track(row.id);
    },
    async remove(trackId) {
      requireOpen();
      await restTracks.remove(trackId);
      applyTrack({ type: 'remove', trackId });
    },
    async reorder(trackIds) {
      requireOpen();
      const order = await restTracks.reorder(trackIds);
      applyTrack({ type: 'reorder', order });
    },
  };

  const clips: LiveClips = {
    list(trackId) {
      if (trackId !== undefined) return model.track(trackId)?.clips ?? EMPTY;
      if (allClips?.version !== model.version) {
        allClips = { version: model.version, clips: Object.freeze(model.tracks().flatMap(t => t.clips)) };
      }
      return allClips.clips;
    },
    get: clipId => model.clip(clipId),

    live(trackId, at) {
      const frame = at === undefined ? playhead() : toFrame(at);
      return frame === null ? null : model.liveClip(trackId, frame);
    },

    nowPlaying(at) {
      const frame = at === undefined ? playhead() : toFrame(at);
      if (frame === null) return [];
      return model.tracks().flatMap((track) => {
        const clip = model.liveClip(track.id, frame);
        return clip ? [{ track, clip }] : [];
      });
    },

    async create(input) {
      requireOpen();
      const row = await restClips.create({ ...input, position: Math.round(toFrame(input.position)) });
      applyClip({ type: 'upsert', trackId: row.trackId ?? input.trackId, clip: row });
      return model.clip(row.id);
    },
    async update(clipId, patch) {
      requireOpen();
      const row = await restClips.update(clipId, patch);
      applyClip({ type: 'upsert', trackId: row.trackId, clip: row });
      return model.clip(row.id);
    },
    rename: (clipId, label) => clips.update(clipId, { label }),
    move:   (clipId, to) => clips.update(clipId, { position: Math.round(toFrame(to)) }),
    async remove(clipId) {
      requireOpen();
      const trackId = model.clip(clipId)?.trackId ?? '';
      await restClips.remove(clipId);
      applyClip({ type: 'remove', trackId, clipId });
    },
  };

  // ── The handle ──────────────────────────────────────────────────────────────

  return {
    on:   events.on,
    once: events.once,
    off:  events.off,

    get timeline()  { return info; },
    get ready()     { return isReady && !closed; },
    get connected() { return !closed && socket.connected; },
    get closed()    { return closed; },
    get canEdit()   { return canEdit; },
    get clock() {
      return { synced: clock.synced, offsetMs: clock.offset, errorMs: clock.rtt === null ? null : clock.rtt / 2 };
    },
    get transport()  { return transport; },
    get sources()    { return sources; },
    get trackTypes() { return trackTypes; },
    get production() {
      if (!production && info) production = new ProductionApi(http, info.productionId);
      return production;
    },
    tracks,
    clips,

    serverNow:    () => clock.now(),
    currentFrame: playhead,
    frameAt:      serverTime => (transport ? frameAt(transport, serverTime) : null),
    toFrame,

    timecode(frame) {
      const at = frame ?? playhead() ?? transport?.frame ?? info?.startFrame;
      return info && at !== undefined ? toTimecode(at, info.frameRateName) : null;
    },

    source: sourceId => (sourceId ? sourceById.get(sourceId) ?? null : null),

    onTrack(nameOrId, listener) {
      return events.on('clip', (event) => {
        if (event.track.id === nameOrId || sameName(event.track.name, nameOrId)) listener(event);
      });
    },

    cue(at, listener) {
      if (typeof at === 'string') {
        fromTimecode(at, 25);
        return cues.add(() => (info ? fromTimecode(at, info.frameRateName) : null), listener);
      }
      return cues.add(at, listener);
    },

    play(from) {
      cancelSeek();
      const frame = from !== undefined ? toFrame(from) : playhead() ?? transport?.frame ?? info?.startFrame ?? 0;
      return command({ action: 'play', frame });
    },

    pause() {
      cancelSeek();
      return command({ action: 'pause' });
    },

    seek(to) {
      if (closed || !socket.connected) return false;
      pendingFrame = toFrame(to);
      const now = performance.now();
      if (now - lastSeekAt >= SEEK_THROTTLE_MS) {
        cancelSeek();
        lastSeekAt = now;
        return command({ action: 'seek', frame: pendingFrame });
      }
      pendingSeek ??= background(setTimeout(() => {
        pendingSeek = null;
        lastSeekAt = performance.now();
        command({ action: 'seek', frame: pendingFrame });
      }, SEEK_THROTTLE_MS - (now - lastSeekAt)));
      return true;
    },

    syncClocks() {
      if (closed || !socket.connected) return Promise.resolve({ error: 'Not connected' });
      return new Promise((resolve) => {
        socket.timeout(5000).emit(TimelineEvent.clockResync, {}, (err: Error | null, ack: ClockResyncAck) => {
          resolve(err ? { error: err.message } : ack);
        });
      });
    },

    async refresh() {
      requireOpen();
      await loadTimeline();
    },

    whenReady: () => firstReady,

    close() {
      if (closed) return;
      if (socket.connected) socket.emit(TimelineEvent.leave);
      cancelSeek();
      shutdown();
      rejectReady(new Error('cino-sdk: closed before the timeline was ready'));
    },
  };
}
