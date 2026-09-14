import { ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import {
  CLIP_EVENTS, PROTOCOL, TIMELINE_NAMESPACE, TRACK_EVENTS, TimelineEvent,
  applyProgress, decodeAnchor, decodeMeasure, decodePresence, decodeStatus, encodeCommand, encodeReport,
  isProtocolError, serverProtocolOf,
  type ClipChange, type TrackChange, type TransportAction, type JoinAck, type PresenceUser,
  type ClockSyncStatus, type ClockResyncAck,
} from '@starling/realtime'
import { answerMeasure, startClockSync, type ClockSync } from 'cino-sdk'
import { createTransportClock } from '../audio/transportClock'
import { setLiveSocketId } from '../../../composables/useLiveSocketId'
import type { PlayheadAnchor } from '../../../types/timeline'

// Re-exported so the editor keeps importing its wire types from one place.
export type { ClipChange, TrackChange, TransportAction, ClockSyncStatus, ClockResyncAck }

/**
 * The room's transport anchor, as decoded from the wire (TransportState in
 * @starling/realtime).
 *
 * `at` stays a SERVER clock reading. Read the position through `serverNow()`
 * each time — `frame + (serverNow() − at)/1000 × frameRate` — rather than
 * converting `at` to local time once, so it improves as the clock estimate does.
 */
export interface TransportState extends PlayheadAnchor {
  /** fps the server advances the clock with, resolved from the DB. */
  frameRate?: number
}

/** One person or device in the room, as the presence list describes them. */
export type Peer = PresenceUser

export interface TimelineSyncOptions {
  onClipChange?: (change: ClipChange) => void
  onTrackChange?: (change: TrackChange) => void
  onTransport?: (state: TransportState) => void
  /**
   * The socket came back after a drop. Relays sent while we were away are gone
   * for good — the room does not replay them — so the caller must re-read the
   * timeline or keep editing a stale copy of it.
   */
  onReconnect?: () => void
}

/**
 * Live-sync channel for the timeline editor (socket.io namespace `/timeline`).
 *
 * - Applies clip/track changes other people persisted, via the callbacks. Our
 *   own writes are relayed by the REST routes themselves; nothing is sent here.
 * - Transport: the SERVER owns the clock. Clients send commands only
 *   (`sendTransport('play'|'pause'|'seek', frame?)`) and receive the room's
 *   authoritative anchor via `onTransport`.
 * - Clock: measures the server's clock, and takes part in room-wide resyncs
 *   (`requestResync`, `clockStatus`).
 * - Tracks who else is in the editor (`peers`).
 *
 * Everything on the wire is encoded by @starling/realtime and decoded here, so
 * the callbacks receive readable shapes:
 *   onClipChange({ type: 'upsert', clip } | { type: 'patch', clip: { id, ...changed } } | { type: 'remove', clipId })
 *   onTrackChange({ type: 'upsert'|'patch', track } | { type: 'remove', trackId } | { type: 'reorder', order })
 *   onTransport({ playing, frame, frameRate, at })
 *     `frame` is the anchor position at server time `at`;
 *     `frame + (serverNow() − at)/1000 × frameRate` is where the transport is
 *     right now, with the command's network delay cancelled out.
 */
export function useTimelineSync({ onClipChange, onTrackChange, onTransport, onReconnect }: TimelineSyncOptions = {}) {
  const connected = ref(false)
  /** Was connected, lost it, and is trying to get back — not the initial connect. */
  const reconnecting = ref(false)
  /**
   * The server speaks a different wire protocol than this page: it was deployed
   * while the page stayed open. Nothing reconnects until the page is reloaded.
   */
  const outdated = ref(false)
  const peers     = ref<Peer[]>([])   // everyone in the room, including self
  /**
   * The room's latest clock resync; null until one has run while we were here.
   * While its state is `measuring` the server holds any Play, which usePlayback
   * respects so it does not start ahead of the room.
   */
  const clockStatus = ref<ClockSyncStatus | null>(null)

  let socket: Socket | null = null
  let timelineId: string | null = null
  let everConnected = false

  // ── Clock sync ──────────────────────────────────────────────────────────────
  // NTP-style pings measure how the server's clock relates to ours. cino-sdk's
  // startClockSync schedules them, as it does for every device in the room:
  //  - a burst on every connect — nothing is known, or the path changed;
  //  - a burst once the transport upgrades to a websocket, because samples
  //    taken over long-polling are lopsided and make poor estimates;
  //  - a burst when the machine slept and the monotonic clock stood still;
  //  - one ping every 15 seconds, so an all-night session keeps tracking.
  // The editor adds a burst when the tab becomes visible or the network returns,
  // and one when anyone in the room presses "Sync clocks", answered with a
  // report of how good the estimate now is.
  // transportClock.ts holds the estimate and gates anchors that arrive before
  // the first sample — see there for why that matters to anyone joining
  // mid-playback.
  const clock = createTransportClock({
    deliver: (state: PlayheadAnchor) => onTransport?.(state as TransportState),
  })
  let clockSync: ClockSync | null = null

  const onVisibility = () => { if (document.visibilityState === 'visible') void clockSync?.measure() }
  const onOnline     = () => { void clockSync?.measure() }

  /** Call before registering any other connect handler, so the first ping is out before the join. */
  function startClockWatch(active: Socket): void {
    clockSync = startClockSync(active, clock)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
  }

  function stopClockWatch(): void {
    clockSync?.stop()
    clockSync = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
  }

  /** Joins the current timeline. The ack carries the room: who is here, a playing anchor, a sync in progress. */
  function emitJoin(active: Socket): void {
    const id = timelineId
    if (!id) return
    active.emit(TimelineEvent.join, id, (ack: JoinAck | undefined) => {
      if (socket !== active || timelineId !== id) return
      if (!ack || 'error' in ack) {
        console.error('[timeline socket] join refused:', ack?.error ?? 'no answer')
        return
      }
      peers.value = decodePresence(ack.users)
      // Joining a playing room: the anchor waits in the clock until a ping has
      // landed. The clock sync's own connect handler ran before ours, so its
      // burst is already in flight.
      const anchor = decodeAnchor(ack.anchor)
      if (anchor && onTransport) clock.accept(anchor)
      clockStatus.value = decodeStatus(ack.sync)
    })
  }

  function join(id: string): void {
    timelineId = id
    if (!socket) {
      socket = io(TIMELINE_NAMESPACE, {
        path: '/socket',
        withCredentials: true,
        // Checked by the server before anything else: a page left open across a
        // deploy is told it is outdated instead of misreading every event.
        auth: { protocol: PROTOCOL },
      })
      startClockWatch(socket)

      const active = socket
      active.on('connect', () => {
        connected.value    = true
        reconnecting.value = false
        if (everConnected) onReconnect?.()
        everConnected = true
        // Every REST mutation now carries this id, so the server can relay the
        // write to the room WITHOUT echoing it back to us.
        setLiveSocketId(active.id ?? null)
        // When the connect burst ends, a held anchor is released even if no ping
        // answered.
        void clockSync?.idle().then(() => clock.settle())
        emitJoin(active)
      })
      active.on('disconnect', (reason: string) => {
        connected.value = false
        // Our own leave() is not a connection problem worth a banner.
        reconnecting.value = everConnected && reason !== 'io client disconnect'
        setLiveSocketId(null)
        peers.value = []
        // A run we were part of went on without us; the room will not tell us how it ended.
        clockStatus.value = null
        // An anchor held from before the drop describes a room we are no longer
        // in step with; the rejoin brings a fresh one.
        clock.reset()
      })

      active.on(TimelineEvent.presence, (raw: unknown) => { peers.value = decodePresence(raw) })

      if (onClipChange) {
        for (const [event, decode] of CLIP_EVENTS) {
          active.on(event, (raw: unknown) => { const change = decode(raw); if (change) onClipChange(change) })
        }
      }
      if (onTrackChange) {
        for (const [event, decode] of TRACK_EVENTS) {
          active.on(event, (raw: unknown) => { const change = decode(raw); if (change) onTrackChange(change) })
        }
      }
      if (onTransport) {
        active.on(TimelineEvent.transportState, (raw: unknown) => {
          const state = decodeAnchor(raw)
          if (state) clock.accept(state)
        })
      }

      // "Sync clocks", pressed by anyone in the room. Measure afresh, then say
      // how good the estimate now is; the server holds any Play until every
      // client has.
      active.on(TimelineEvent.clockMeasure, async (raw: unknown) => {
        const sync = clockSync
        const request = decodeMeasure(raw)
        if (!sync || !request) return
        const report = await answerMeasure(request, { measure: () => sync.measure(), get rtt() { return clock.rtt } })
        if (socket === active && active.connected) active.emit(TimelineEvent.clockReport, encodeReport(report))
      })
      active.on(TimelineEvent.clockStatus, (raw: unknown) => {
        const status = decodeStatus(raw)
        if (status) clockStatus.value = status
      })
      // Only what changed since the run was sent whole; a message for a run we
      // never saw leaves the status as it is.
      active.on(TimelineEvent.clockProgress, (raw: unknown) => {
        clockStatus.value = applyProgress(clockStatus.value, raw)
      })

      active.on('connect_error', (err: Error) => {
        if (isProtocolError(err)) {
          // A refused handshake is not retried by socket.io, and retrying could
          // not help: only a reload brings this page to the server's protocol.
          outdated.value     = true
          reconnecting.value = false
          console.error(`[timeline socket] this page speaks wire protocol ${PROTOCOL}, the server ${serverProtocolOf(err) ?? 'another'}; reload`)
          return
        }
        console.error('[timeline socket]', err.message)
      })
    } else if (socket.connected) {
      emitJoin(socket)
    }
  }

  function leave(): void {
    clock.reset()
    stopClockWatch()
    setLiveSocketId(null)
    socket?.emit(TimelineEvent.leave)
    socket?.disconnect()
    socket          = null
    timelineId      = null
    everConnected   = false
    connected.value = false
    reconnecting.value = false
    outdated.value  = false
    peers.value     = []
    clockStatus.value = null
  }

  // Transport commands. play/pause send immediately (and drop any queued
  // seek — the newer intent wins); seeks are throttled leading+trailing so a
  // scrub doesn't flood the server, with the trailing send carrying the
  // LATEST frame of the burst.
  const SEEK_THROTTLE_MS = 120
  let _lastSeekSent  = 0
  let _pendingSeek: ReturnType<typeof setTimeout> | null = null
  let _pendingFrame: number | null = null

  function sendTransport(action: TransportAction, frame: number | null = null): void {
    const active = socket
    if (!active?.connected) return

    if (action !== 'seek') {
      if (_pendingSeek) { clearTimeout(_pendingSeek); _pendingSeek = null }
      active.emit(TimelineEvent.transportCommand, encodeCommand({ action, frame: frame ?? undefined }))
      return
    }

    const now = Date.now()
    _pendingFrame = frame
    if (now - _lastSeekSent >= SEEK_THROTTLE_MS) {
      if (_pendingSeek) { clearTimeout(_pendingSeek); _pendingSeek = null }
      _lastSeekSent = now
      active.emit(TimelineEvent.transportCommand, encodeCommand({ action: 'seek', frame: frame ?? undefined }))
      return
    }
    if (_pendingSeek) return   // trailing send already queued; frame updated above
    _pendingSeek = setTimeout(() => {
      _pendingSeek  = null
      _lastSeekSent = Date.now()
      if (socket?.connected) {
        socket.emit(TimelineEvent.transportCommand, encodeCommand({ action: 'seek', frame: _pendingFrame ?? undefined }))
      }
    }, SEEK_THROTTLE_MS - (now - _lastSeekSent))
  }

  /** The server's clock right now, as currently estimated. Read anchors through this. */
  const serverNow = (): number => clock.serverNow()

  /**
   * Makes every client in the room — editors and devices — re-measure its clock.
   * Resolves to the server's ack; progress then arrives on `clockStatus`.
   */
  function requestResync(): Promise<ClockResyncAck> {
    const active = socket
    if (!active?.connected) return Promise.resolve({ error: 'Not connected' })
    return new Promise((resolve) => {
      active.timeout(5000).emit(TimelineEvent.clockResync, (err: Error | null, ack: ClockResyncAck) => {
        resolve(err ? { error: err.message } : ack)
      })
    })
  }

  return {
    connected, reconnecting, outdated, peers, clockStatus,
    join, leave, sendTransport, serverNow, requestResync,
  }
}
