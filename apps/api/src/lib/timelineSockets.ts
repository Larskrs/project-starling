import type { Server as SocketIOServer, Namespace } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db, timelines, productions, tracks, clips } from '@starling/db';
import type { SocketUser, SocketPrincipal } from './sockets.js';
import { createLiveRoom, type LiveRoomContext } from './liveRoom.js';
import { trackActivity } from './activity.js';
import { serverNow } from './clock.js';
import { createClockResyncs } from './clockResync.js';
import { resolveAccessLevel, type AccessLevel, type AccessPrincipal } from './production.js';
import { can } from './permissions.js';
import { Permission } from '@starling/auth/permissions';
import {
  TIMELINE_NAMESPACE, TimelineEvent,
  isClipChange, isTrackChange, isTransportCommand, isClockReport,
  type ClockResyncAck,
  type ClipChange, type TrackChange, type PresenceUser, type TransportState,
  type TransportCommand,
} from '@starling/realtime';

// Re-exported so existing importers keep working; the definitions now live in
// @starling/realtime, shared with the web client and any native client.
export type { ClipChange, TrackChange, PresenceUser, TransportState };

/** Capabilities resolved once at join and cached on the socket. */
export interface TimelineCaps {
  canEdit:      boolean;
  canRename:    boolean;
  frameRate:    number;
  productionId: string;
  companyId:    string;
}

// ── Room state ────────────────────────────────────────────────────────────────

// timelineId → the room's authoritative transport (one object per socket room).
// An anchor never goes stale — playing position is derived from the server clock
// — so late joiners simply receive it while playing; a stopped timeline is
// browsed privately, nothing to replay. Cleared when the room empties.
const roomTransport = new Map<string, TransportState>();

// Seek commands arrive as scrub bursts — bound them per socket.
const SEEK_MIN_INTERVAL_MS = 80;
const lastSeekAt = new Map<string, number>();

/** Must match createLiveRoom's roomPrefix below — the watcher emits directly. */
function roomName(timelineId: string): string {
  return `tl:${timelineId}`;
}

/** Whether a resolved access level grants a specific production permission. */
function accessGrants(access: AccessLevel, user: SocketUser, required: bigint): boolean {
  if (access.privileged) return true;
  return can(user.role, access.rolePermissions, required);
}
// ── Active-clip watcher ───────────────────────────────────────────────────────
// While a room's transport plays, the server walks the timeline's clip
// boundaries on its own clock and emits `clip:active` whenever the clip under
// the playhead changes on a track. Semantics mirror the web editor's
// activeClipLabel: a clip is active from `position`; with an `end` it runs for
// `end − mediaStart` frames, otherwise until the next clip on the track.
// Armed on play/seek, reloaded on clip/track edits, disarmed on pause/empty.

interface WatcherClip {
  id:         string;
  trackId:    string;
  position:   number;
  mediaStart: number | null;
  end:        number | null;
  label:      string | null;
  sourceId:   string | null;
}

interface RoomWatcher {
  timer:        ReturnType<typeof setTimeout> | null;
  clipsByTrack: Map<string, WatcherClip[]>;   // sorted by position
  active:       Map<string, string | null>;   // trackId → active clipId
}

const roomWatchers = new Map<string, RoomWatcher>();

function transportFrameAt(state: TransportState, now: number): number {
  return state.playing ? state.frame + ((now - state.at) / 1000) * state.frameRate : state.frame;
}

function activeClipAt(trackClips: WatcherClip[], frame: number): WatcherClip | null {
  let active: WatcherClip | null = null;
  for (const clip of trackClips) {
    if (clip.position > frame) break;
    active = clip;
  }
  if (!active) return null;
  if (active.end != null && frame >= active.position + (active.end - (active.mediaStart ?? 0))) return null;
  return active;
}

/** The next frame at which any track's active clip can change. */
function nextBoundaryAfter(clipsByTrack: Map<string, WatcherClip[]>, frame: number): number | null {
  let next: number | null = null;
  const consider = (b: number | null) => {
    if (b != null && b > frame && (next == null || b < next)) next = b;
  };
  for (const trackClips of clipsByTrack.values()) {
    for (const clip of trackClips) {
      consider(clip.position);
      consider(clip.end != null ? clip.position + (clip.end - (clip.mediaStart ?? 0)) : null);
    }
  }
  return next;
}

function disarmWatcher(timelineId: string): void {
  const watcher = roomWatchers.get(timelineId);
  if (watcher?.timer) clearTimeout(watcher.timer);
  roomWatchers.delete(timelineId);
}

/** (Re)load the timeline's clip windows and start walking boundaries. */
async function armWatcher(nsp: Namespace, timelineId: string): Promise<void> {
  const prev = roomWatchers.get(timelineId);
  if (prev?.timer) clearTimeout(prev.timer);

  const state = roomTransport.get(timelineId);
  if (!state?.playing) { roomWatchers.delete(timelineId); return; }

  const rows = await db
    .select({
      id:         clips.id,
      trackId:    clips.trackId,
      position:   clips.position,
      mediaStart: clips.mediaStart,
      end:        clips.end,
      label:      clips.label,
      sourceId:   clips.sourceId,
    })
    .from(clips)
    .innerJoin(tracks, eq(clips.trackId, tracks.id))
    .where(eq(tracks.timelineId, timelineId))
    .orderBy(clips.position);

  const clipsByTrack = new Map<string, WatcherClip[]>();
  for (const row of rows) {
    const list = clipsByTrack.get(row.trackId);
    if (list) list.push(row);
    else clipsByTrack.set(row.trackId, [row]);
  }

  // Keep the previous active map across re-arms (seeks, edits) so only genuine
  // changes emit; a fresh play starts empty and emits the initial snapshot.
  roomWatchers.set(timelineId, { timer: null, clipsByTrack, active: prev?.active ?? new Map() });
  evaluateWatcher(nsp, timelineId);
}

function evaluateWatcher(nsp: Namespace, timelineId: string): void {
  const watcher = roomWatchers.get(timelineId);
  const state   = roomTransport.get(timelineId);
  if (!watcher || !state?.playing) { disarmWatcher(timelineId); return; }

  const now   = serverNow();
  const frame = transportFrameAt(state, now);

  for (const [trackId, trackClips] of watcher.clipsByTrack) {
    const active = activeClipAt(trackClips, frame);
    if ((active?.id ?? null) === (watcher.active.get(trackId) ?? null)) continue;
    watcher.active.set(trackId, active?.id ?? null);
    nsp.to(roomName(timelineId)).emit('clip:active', {
      trackId,
      clipId:   active?.id ?? null,
      label:    active?.label ?? null,
      sourceId: active?.sourceId ?? null,
      frame,
      at:       now,
    });
  }

  const boundary = nextBoundaryAfter(watcher.clipsByTrack, frame);
  if (boundary == null) return;   // no more changes ahead — sleep until re-armed
  const delayMs = Math.max(10, ((boundary - frame) / state.frameRate) * 1000 + 5);
  watcher.timer = setTimeout(() => evaluateWatcher(nsp, timelineId), delayMs);
}

// ── Access check ──────────────────────────────────────────────────────────────
// Resolves the timeline's owning production, then delegates to the same
// membership resolution REST uses (resolveAccessLevel in production.ts), so the
// two layers can never drift.

async function resolveTimelineAccess(
  principal: SocketPrincipal,
  timelineId: string,
): Promise<{ level: AccessLevel; frameRate: number; productionId: string; companyId: string } | null> {
  const [tl] = await db
    .select({ productionId: timelines.productionId, companyId: productions.companyId, frameRate: timelines.frameRate })
    .from(timelines)
    .innerJoin(productions, eq(timelines.productionId, productions.id))
    .where(eq(timelines.id, timelineId))
    .limit(1);
  if (!tl) return null;

  const access: AccessPrincipal = principal.kind === 'token'
    ? { kind: 'token', id: principal.tokenId, productionId: principal.productionId, permissions: principal.permissions }
    : { kind: 'user',  id: principal.userId,  role: principal.role };

  const level = await resolveAccessLevel(access, tl.companyId, tl.productionId);
  if (!level) return null;

  return {
    level,
    frameRate:    parseFloat(tl.frameRate) || 25,
    productionId: tl.productionId,
    companyId:    tl.companyId,
  };
}

// ── Namespace setup ───────────────────────────────────────────────────────────

/** Relays fan one sender's payload to every peer — bound what that can cost. */
const MAX_RELAY_BYTES = 32 * 1024;

function relayTooLarge(payload: unknown): boolean {
  try { return JSON.stringify(payload).length > MAX_RELAY_BYTES; }
  catch { return true; }
}

/**
 * Set once the namespace exists, so REST routes can broadcast a write the
 * instant it is persisted. See emitTimelineChange.
 */
let live: LiveRoomContext<TimelineCaps, PresenceUser> | null = null;

/**
 * Broadcast a persisted change to everyone watching a timeline.
 *
 * ── Why the server relays, and not the client ──────────────────────────────
 * The write path used to be: client PATCHes, AWAITS the response, updates its
 * own model, then emits a relay. That serialised every peer's update behind the
 * originator's full REST round trip — measured at 10.4ms median against a local
 * database versus 0.8ms for the socket hop itself, so peers spent ~93% of their
 * wait on a hop they had no reason to wait for. Over a real network the REST
 * leg grows and the socket leg does not, so the ratio only gets worse.
 *
 * Relaying here, from inside the route that just did the write, cuts a peer's
 * latency to one socket hop. It also removes an entire class of bug: the old
 * design depended on ten separate call sites each remembering to relay, with
 * the right payload shape, and a silent desync if any of them forgot.
 *
 * `exceptSocketId` keeps the originator from receiving its own change back —
 * see SOCKET_ID_HEADER. It is optional everywhere: a caller without a socket
 * (curl, a native client, an older build) simply gets the echo, which is
 * idempotent.
 */
export function emitTimelineChange(
  timelineId: string,
  event: typeof TimelineEvent.clipChange | typeof TimelineEvent.trackChange,
  payload: ClipChange | TrackChange,
  exceptSocketId: string | null = null,
): void {
  if (!live || relayTooLarge(payload)) return;
  live.emitExcept(timelineId, exceptSocketId, event, payload);

  // A clip or track edit moves the boundaries the active-clip watcher walks, so
  // reload it if this room is currently playing.
  if (roomWatchers.has(timelineId)) {
    void armWatcher(live.nsp, timelineId).catch(() => {});
  }
}

/** Makes `next` the room's transport, tells the whole room, and (dis)arms the watcher. */
function commitTransport(timelineId: string, next: TransportState): void {
  if (!live) return;
  roomTransport.set(timelineId, next);
  live.emit(timelineId, TimelineEvent.transportState, next);
  if (next.playing) void armWatcher(live.nsp, timelineId).catch(() => {});
  else disarmWatcher(timelineId);
}

export function setupTimelineSockets(io: SocketIOServer): void {
  // Room-wide clock resync. The rules are in clockResync.ts; this wires them to
  // the room — who is asked, where progress goes, and how a held Play starts.
  const resyncs = createClockResyncs({
    now:     serverNow,
    measure: (timelineId, request) => live?.emit(timelineId, TimelineEvent.clockMeasure, request),
    publish: (timelineId, status) => live?.emit(timelineId, TimelineEvent.clockStatus, status),
    // Stamped when it is released, not when it was pressed: every clock has just
    // been measured, and the anchor must describe the moment playback begins.
    releasePlay: (timelineId, play) => commitTransport(timelineId, {
      playing:   true,
      frame:     play.frame,
      frameRate: play.frameRate,
      userId:    play.userId,
      at:        serverNow(),
    }),
  });

  live = createLiveRoom<TimelineCaps, PresenceUser>(io, {
    namespace:     TIMELINE_NAMESPACE,
    roomPrefix:    'tl',
    joinEvent:     TimelineEvent.join,
    leaveEvent:    TimelineEvent.leave,
    presenceEvent: TimelineEvent.presence,
    roomIdField:   'timelineId',

    async authorize({ user, principal }, timelineId) {
      const resolved = await resolveTimelineAccess(principal, timelineId);
      if (!resolved) return null;

      return {
        // Resolved ONCE here so the relays below never hit the database, no
        // matter how many events a room produces.
        caps: {
          canEdit:      accessGrants(resolved.level, user, Permission.EDIT_TIMELINE),
          canRename:    accessGrants(resolved.level, user, Permission.RENAME_CLIPS),
          frameRate:    resolved.frameRate,
          productionId: resolved.productionId,
          companyId:    resolved.companyId,
        },
        presence: {
          id:            user.id,
          name:          user.name,
          avatarImageId: user.avatarImageId,
          createdAt:     user.createdAt,
        },
      };
    },

    onJoined(socket, timelineId, caps) {
      // Joining the room IS opening the timeline — this is what puts it in the
      // user's "recently opened" list on the home page.
      //
      // People only: a token's presence id is not a user id, so this would
      // break the foreign key, and a device reconnecting all night has no place
      // in anybody's recents.
      if (socket.data.principal.kind === 'user') {
        trackActivity({
          userId:       socket.data.user.id,
          entityType:   'timeline',
          entityId:     timelineId,
          productionId: caps.productionId,
          companyId:    caps.companyId,
        });
      }

      // A clock sync in progress: show the joiner the panel everyone else sees.
      // It was not asked to measure — connecting has just made it measure anyway.
      const resync = resyncs.measuring(timelineId);
      if (resync) socket.emit(TimelineEvent.clockStatus as never, resync as never);

      // An ACTIVE timeline is shared: the joiner receives the authoritative
      // anchor and derives the current frame from it — anchors never go stale.
      // A stopped timeline is browsed privately, so there is nothing to replay.
      const state = roomTransport.get(timelineId);
      if (!state?.playing) return;

      socket.emit(TimelineEvent.transportState as never, state as never);

      // Catch the joiner up on what is currently active per track.
      const watcher = roomWatchers.get(timelineId);
      if (!watcher) return;
      const now   = serverNow();
      const frame = transportFrameAt(state, now);
      for (const [trackId, clipId] of watcher.active) {
        if (clipId == null) continue;
        const clip = watcher.clipsByTrack.get(trackId)?.find(c => c.id === clipId);
        socket.emit(TimelineEvent.clipActive as never, {
          trackId,
          clipId,
          label:    clip?.label ?? null,
          sourceId: clip?.sourceId ?? null,
          frame,
          at:       now,
        } as never);
      }
    },

    onLeaving(socket, timelineId) {
      // Gone mid-sync counts as answered, so a closed laptop cannot hold a Play.
      resyncs.leave(timelineId, socket.id);
    },

    onRoomEmpty(timelineId) {
      roomTransport.delete(timelineId);
      disarmWatcher(timelineId);
      resyncs.clear(timelineId);
    },

    events(socket, ctx) {
      const user = socket.data.user;

      // ── Client-initiated relays (compatibility path) ───────────────────
      // Persisted changes now fan out from the REST routes themselves, which is
      // both faster and impossible to forget. These handlers stay for clients
      // that still relay by hand — notably the native client documented in
      // docs/swiftSocket.md — and are exactly as guarded as they always were.
      //
      // A client that sends BOTH (an old web build against a new server) makes a
      // peer apply the same row twice. Upserts are idempotent, so that is
      // wasteful rather than wrong.
      socket.on(TimelineEvent.clipChange as never, ((raw: unknown) => {
        const change = raw as ClipChange;
        const timelineId = socket.data.roomId;
        const caps = socket.data.caps;
        if (!timelineId || !caps) return;
        if (!caps.canEdit && !caps.canRename) return;
        if (!isClipChange(raw)) return;
        // Rename-only members persist label PATCHes (upserts); they have no REST
        // path to a remove, so they get no relay for one either.
        if (!caps.canEdit && change.type !== 'upsert') return;
        if (relayTooLarge(change)) return;

        ctx.emitExcept(timelineId, socket.id, TimelineEvent.clipChange, change);
        if (roomWatchers.has(timelineId)) void armWatcher(ctx.nsp, timelineId).catch(() => {});
      }) as never);

      socket.on(TimelineEvent.trackChange as never, ((raw: unknown) => {
        const change = raw as TrackChange;
        const timelineId = socket.data.roomId;
        const caps = socket.data.caps;
        if (!timelineId || !caps?.canEdit) return;
        if (!isTrackChange(raw)) return;
        if (relayTooLarge(change)) return;

        ctx.emitExcept(timelineId, socket.id, TimelineEvent.trackChange, change);
        if (change.type === 'remove' && roomWatchers.has(timelineId)) {
          void armWatcher(ctx.nsp, timelineId).catch(() => {});
        }
      }) as never);

      // ── Transport ──────────────────────────────────────────────────────
      // The server OWNS the clock. A command updates the room's anchor and the
      // resulting authoritative state goes to the whole room INCLUDING the
      // sender, so every client derives its position from the same anchor.
      // Stays at join level — any member may drive the shared transport.
      socket.on(TimelineEvent.transportCommand as never, ((raw: unknown) => {
        const cmd = raw as TransportCommand;
        const timelineId = socket.data.roomId;
        if (!timelineId || !isTransportCommand(raw)) return;

        const now  = serverNow();
        const prev = roomTransport.get(timelineId);

        let next: TransportState;
        if (cmd.action === 'play') {
          // The room's clocks are being re-measured for a show. Hold the Play;
          // it starts on a fresh anchor the moment every client has answered
          // (releasePlay above). An anchor stamped now would be read by clients
          // whose estimate is still settling, and they would start apart.
          const held = resyncs.holdPlay(timelineId, {
            frame:     cmd.frame!,
            frameRate: socket.data.caps?.frameRate ?? 25,
            userId:    user.id,
          });
          if (held) return;
          next = {
            playing:   true,
            frame:     cmd.frame!,
            frameRate: socket.data.caps?.frameRate ?? 25,
            userId:    user.id,
            at:        now,
          };
        } else if (cmd.action === 'seek') {
          // Stopped timelines are browsed privately — shared seeks exist only
          // while the transport runs. Scrub bursts are rate-bounded per socket.
          if (!prev?.playing) return;
          if (lastSeekAt.get(socket.id) && now - lastSeekAt.get(socket.id)! < SEEK_MIN_INTERVAL_MS) return;
          lastSeekAt.set(socket.id, now);
          next = { ...prev, frame: cmd.frame!, userId: user.id, at: now };
        } else {
          // A pause also takes back a Play that is waiting on a clock sync.
          resyncs.cancelPlay(timelineId);
          // pause: idempotent, and the frame comes from the SERVER clock rather
          // than the client, so everyone stops at the authoritative spot.
          if (!prev?.playing) return;
          next = {
            playing:   false,
            frame:     prev.frame + ((now - prev.at) / 1000) * prev.frameRate,
            frameRate: prev.frameRate,
            userId:    user.id,
            at:        now,
          };
        }

        commitTransport(timelineId, next);
      }) as never);

      socket.on(TimelineEvent.timePing as never, ((ack: unknown) => {
        if (typeof ack === 'function') (ack as (n: number) => void)(serverNow());
      }) as never);

      // ── Clock sync ─────────────────────────────────────────────────────
      // Join-level, like the transport it protects: anyone who may press Play
      // may make sure the room is ready for it. Every socket in the room is
      // asked — a user with two tabs has two clocks.
      socket.on(TimelineEvent.clockResync as never, ((_payload: unknown, ack?: unknown) => {
        const reply = typeof ack === 'function' ? ack as (result: ClockResyncAck) => void : () => {};
        const timelineId = socket.data.roomId;
        if (!timelineId) { reply({ error: 'Not in a timeline' }); return; }

        const socketIds = ctx.nsp.adapter.rooms.get(ctx.roomName(timelineId)) ?? new Set<string>();
        const clients = [...socketIds].flatMap((socketId) => {
          const member = ctx.nsp.sockets.get(socketId);
          return member ? [{ socketId, id: member.data.user.id as string, name: member.data.user.name as string }] : [];
        });

        const { requestId } = resyncs.start(timelineId, { id: user.id, name: user.name }, clients);
        reply({ ok: true, requestId });
      }) as never);

      socket.on(TimelineEvent.clockReport as never, ((raw: unknown) => {
        const timelineId = socket.data.roomId;
        if (!timelineId || !isClockReport(raw)) return;
        resyncs.report(timelineId, socket.id, raw);
      }) as never);

      socket.on('disconnect', () => { lastSeekAt.delete(socket.id); });
    },
  });
}
