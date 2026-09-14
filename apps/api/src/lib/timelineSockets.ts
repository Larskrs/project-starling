import type { Server as SocketIOServer } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db, timelines, productions } from '@starling/db';
import type { SocketUser, SocketPrincipal } from './sockets.js';
import { createLiveRoom, type LiveRoomContext } from './liveRoom.js';
import { trackActivity } from './activity.js';
import { serverNow } from './clock.js';
import { createClockResyncs } from './clockResync.js';
import { resolveAccessLevel, type AccessLevel, type AccessPrincipal } from './production.js';
import { can } from './permissions.js';
import { Permission } from '@starling/auth/permissions';
import {
  PROTOCOL, TIMELINE_NAMESPACE, TimelineEvent,
  decodeCommand, decodeReport,
  encodeAnchor, encodeClip, encodeMeasure, encodePatch, encodePresence, encodeProgress, encodeStatus, encodeTrack,
  type ClockResyncAck, type PresenceSource, type TimelineEventName, type TransportState,
} from '@starling/realtime';

export type { TransportState };

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
//
// That is ALL the server keeps for a playing room. It does not walk clip
// boundaries or announce which clip is live: every client holds the clips and
// the anchor, so the live clip is arithmetic on the client, and an event sent
// when a boundary passed would arrive late by the network anyway. What that
// buys here is that a play, a seek or an edit costs no database query and no
// timer — just the new anchor and one broadcast.
const roomTransport = new Map<string, TransportState>();

/**
 * Seeks arrive as scrub bursts, and every seek the room takes is a broadcast to
 * all of it. So the ROOM takes at most one per interval, whoever is scrubbing —
 * two people scrubbing at once used to double the rate. A seek inside the
 * interval waits for its end, and a newer one replaces it while it waits, so
 * the room lands on the last frame of a scrub instead of dropping it.
 */
const SEEK_MIN_INTERVAL_MS = 80;
const lastSeekAt   = new Map<string, number>();   // timelineId → server time of the room's last seek
const pendingSeeks = new Map<string, { frame: number; timer: ReturnType<typeof setTimeout> }>();

/**
 * Wire precision for anything sent on every command. A tenth of a millisecond
 * and a thousandth of a frame are far finer than any client can act on; the
 * digits past them are float noise — a pause frame of 3100.0000000004 — sent to
 * every socket in the room.
 */
const trimMs    = (ms: number): number => Math.round(ms * 10) / 10;
const trimFrame = (frame: number): number => Math.round(frame * 1000) / 1000;

/** Whether a resolved access level grants a specific production permission. */
function accessGrants(access: AccessLevel, user: SocketUser, required: bigint): boolean {
  if (access.privileged) return true;
  return can(user.role, access.rolePermissions, required);
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

// ── Relaying persisted changes ────────────────────────────────────────────────

/**
 * Set once the namespace exists, so REST routes can broadcast a write the
 * instant it is persisted. See timelineRelay.
 */
let live: LiveRoomContext<TimelineCaps, PresenceSource> | null = null;

function relay(timelineId: string, event: TimelineEventName, payload: unknown, exceptSocketId: string | null): void {
  live?.emitExcept(timelineId, exceptSocketId, event, payload);
}

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
 * An update relays only the fields the request changed, not the whole row: a
 * rename is a label, not a label plus a dozen columns every peer already holds.
 *
 * `exceptSocketId` keeps the originator from receiving its own change back —
 * see SOCKET_ID_HEADER. A caller without a socket (curl, a script) simply gets
 * the echo, which is idempotent.
 *
 * No size check: the payload is a row this server's own route just validated
 * and wrote, bounded by that route's limits (clip `data` at 2 KB).
 */
export const timelineRelay = {
  clipAdded(timelineId: string, row: object, exceptSocketId: string | null): void {
    relay(timelineId, TimelineEvent.clipAdd, encodeClip(row), exceptSocketId);
  },
  /** `fields` are the columns the request wrote; their values are read from the stored row. */
  clipUpdated(timelineId: string, row: { id: string }, fields: readonly string[], exceptSocketId: string | null): void {
    relay(timelineId, TimelineEvent.clipUpdate, encodePatch(row, fields), exceptSocketId);
  },
  clipRemoved(timelineId: string, clipId: string, exceptSocketId: string | null): void {
    relay(timelineId, TimelineEvent.clipRemove, clipId, exceptSocketId);
  },
  trackAdded(timelineId: string, row: object, exceptSocketId: string | null): void {
    relay(timelineId, TimelineEvent.trackAdd, encodeTrack(row), exceptSocketId);
  },
  trackUpdated(timelineId: string, row: { id: string }, fields: readonly string[], exceptSocketId: string | null): void {
    relay(timelineId, TimelineEvent.trackUpdate, encodePatch(row, fields), exceptSocketId);
  },
  trackRemoved(timelineId: string, trackId: string, exceptSocketId: string | null): void {
    relay(timelineId, TimelineEvent.trackRemove, trackId, exceptSocketId);
  },
  /** The full order the reorder applied; a track's index is its sortOrder. */
  tracksReordered(timelineId: string, order: readonly string[], exceptSocketId: string | null): void {
    relay(timelineId, TimelineEvent.trackOrder, order, exceptSocketId);
  },
};

// ── Transport ─────────────────────────────────────────────────────────────────

/** Makes `next` the room's transport and tells the whole room. */
function commitTransport(timelineId: string, next: TransportState): void {
  if (!live) return;
  // Trimmed before it is stored, so a later pause computes from the same numbers
  // everyone was sent.
  const trimmed: TransportState = { ...next, frame: trimFrame(next.frame), at: trimMs(next.at) };
  roomTransport.set(timelineId, trimmed);
  live.emit(timelineId, TimelineEvent.transportState, encodeAnchor(trimmed));
}

function cancelSeek(timelineId: string): void {
  const pending = pendingSeeks.get(timelineId);
  if (pending) clearTimeout(pending.timer);
  pendingSeeks.delete(timelineId);
}

/** A seek is only a new anchor: no query, no timer beyond the interval, one small broadcast. */
function seek(timelineId: string, frame: number): void {
  const prev = roomTransport.get(timelineId);
  // Stopped timelines are browsed privately — shared seeks exist only while the
  // transport runs.
  if (!prev?.playing) {
    cancelSeek(timelineId);
    return;
  }

  const now  = serverNow();
  const wait = SEEK_MIN_INTERVAL_MS - (now - (lastSeekAt.get(timelineId) ?? -Infinity));
  if (wait > 0) {
    const pending = pendingSeeks.get(timelineId);
    if (pending) { pending.frame = frame; return; }
    const timer = setTimeout(() => {
      const latest = pendingSeeks.get(timelineId);
      pendingSeeks.delete(timelineId);
      if (latest) seek(timelineId, latest.frame);
    }, wait);
    timer.unref?.();
    pendingSeeks.set(timelineId, { frame, timer });
    return;
  }

  lastSeekAt.set(timelineId, now);
  commitTransport(timelineId, { ...prev, frame, at: now });
}

// ── Namespace setup ───────────────────────────────────────────────────────────

export function setupTimelineSockets(io: SocketIOServer): void {
  // Room-wide clock resync. The rules are in clockResync.ts; this wires them to
  // the room — who is asked, where progress goes, and how a held Play starts.
  const resyncs = createClockResyncs({
    measure:  (timelineId, request) => live?.emit(timelineId, TimelineEvent.clockMeasure, encodeMeasure(request)),
    publish:  (timelineId, status) => live?.emit(timelineId, TimelineEvent.clockStatus, encodeStatus(status)),
    progress: (timelineId, update) => live?.emit(timelineId, TimelineEvent.clockProgress, encodeProgress(update)),
    // Stamped when it is released, not when it was pressed: every clock has just
    // been measured, and the anchor must describe the moment playback begins.
    releasePlay: (timelineId, play) => commitTransport(timelineId, {
      playing:   true,
      frame:     play.frame,
      frameRate: play.frameRate,
      at:        serverNow(),
    }),
  });

  live = createLiveRoom<TimelineCaps, PresenceSource>(io, {
    namespace:      TIMELINE_NAMESPACE,
    roomPrefix:     'tl',
    joinEvent:      TimelineEvent.join,
    leaveEvent:     TimelineEvent.leave,
    presenceEvent:  TimelineEvent.presence,
    protocol:       PROTOCOL,
    encodePresence,

    async authorize({ user, principal }, timelineId) {
      const resolved = await resolveTimelineAccess(principal, timelineId);
      if (!resolved) return null;

      return {
        // Resolved ONCE here so the handlers below never hit the database, no
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
          // A token's createdAt is only the moment it connected: nothing an
          // avatar colour should come from, and nothing worth sending.
          createdAt:     principal.kind === 'token' ? null : user.createdAt,
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

      // What the joiner needs to know about the room rides the ack. An ACTIVE
      // timeline is shared: the joiner receives the authoritative anchor and
      // derives the current frame from it — anchors never go stale. A stopped
      // timeline is browsed privately, so there is nothing to replay. A clock
      // sync in progress is shown whole; the joiner was not asked to measure,
      // but connecting has just made it measure anyway.
      const state  = roomTransport.get(timelineId);
      const resync = resyncs.measuring(timelineId);
      return {
        canEdit:   caps.canEdit,
        canRename: caps.canRename,
        ...(state?.playing ? { anchor: encodeAnchor(state) } : {}),
        ...(resync ? { sync: encodeStatus(resync) } : {}),
      };
    },

    onLeaving(socket, timelineId) {
      // Gone mid-sync counts as answered, so a closed laptop cannot hold a Play.
      resyncs.leave(timelineId, socket.id);
    },

    onRoomEmpty(timelineId) {
      roomTransport.delete(timelineId);
      cancelSeek(timelineId);
      lastSeekAt.delete(timelineId);
      resyncs.clear(timelineId);
    },

    events(socket, ctx) {
      const user = socket.data.user;

      // ── Transport ──────────────────────────────────────────────────────
      // The server OWNS the clock. A command updates the room's anchor and the
      // resulting authoritative state goes to the whole room INCLUDING the
      // sender, so every client derives its position from the same anchor.
      // Stays at join level — any member may drive the shared transport.
      socket.on(TimelineEvent.transportCommand as never, ((raw: unknown) => {
        const timelineId = socket.data.roomId;
        const cmd = decodeCommand(raw);
        if (!timelineId || !cmd) return;

        if (cmd.action === 'seek') {
          seek(timelineId, cmd.frame!);
          return;
        }

        // A play or a pause is newer intent than any seek still waiting its turn.
        cancelSeek(timelineId);
        const now  = serverNow();
        const prev = roomTransport.get(timelineId);
        const frameRate = socket.data.caps?.frameRate ?? 25;

        if (cmd.action === 'play') {
          // The room's clocks are being re-measured for a show. Hold the Play;
          // it starts on a fresh anchor the moment every client has answered
          // (releasePlay above). An anchor stamped now would be read by clients
          // whose estimate is still settling, and they would start apart.
          if (resyncs.holdPlay(timelineId, { frame: cmd.frame!, frameRate })) return;
          commitTransport(timelineId, { playing: true, frame: cmd.frame!, frameRate, at: now });
          return;
        }

        // A pause also takes back a Play that is waiting on a clock sync.
        resyncs.cancelPlay(timelineId);
        // pause: idempotent, and the frame comes from the SERVER clock rather
        // than the client, so everyone stops at the authoritative spot.
        if (!prev?.playing) return;
        commitTransport(timelineId, {
          playing:   false,
          frame:     prev.frame + ((now - prev.at) / 1000) * prev.frameRate,
          frameRate: prev.frameRate,
          at:        now,
        });
      }) as never);

      socket.on(TimelineEvent.timePing as never, ((ack: unknown) => {
        // Trimmed like transport stamps: a twentieth of a millisecond of offset
        // error is far below anything a ping's round trip can resolve.
        if (typeof ack === 'function') (ack as (n: number) => void)(trimMs(serverNow()));
      }) as never);

      // ── Clock sync ─────────────────────────────────────────────────────
      // Join-level, like the transport it protects: anyone who may press Play
      // may make sure the room is ready for it. Every socket in the room is
      // asked — a user with two tabs has two clocks.
      socket.on(TimelineEvent.clockResync as never, ((...args: unknown[]) => {
        const ack = args.find(arg => typeof arg === 'function') as ((result: ClockResyncAck) => void) | undefined;
        const reply = ack ?? (() => {});
        const timelineId = socket.data.roomId;
        if (!timelineId) { reply({ error: 'Not in a timeline' }); return; }

        const socketIds = ctx.nsp.adapter.rooms.get(ctx.roomName(timelineId)) ?? new Set<string>();
        const clients = [...socketIds].flatMap((socketId) => {
          const member = ctx.nsp.sockets.get(socketId);
          return member ? [{ socketId, id: member.data.user.id as string, name: member.data.user.name as string }] : [];
        });

        const { requestId } = resyncs.start(timelineId, { name: user.name }, clients);
        reply({ ok: true, requestId });
      }) as never);

      socket.on(TimelineEvent.clockReport as never, ((raw: unknown) => {
        const timelineId = socket.data.roomId;
        const report = decodeReport(raw);
        if (!timelineId || !report) return;
        resyncs.report(timelineId, socket.id, report);
      }) as never);
    },
  });
}
