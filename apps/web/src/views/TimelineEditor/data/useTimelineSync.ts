import { ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import {
  TIMELINE_NAMESPACE, TimelineEvent,
  type ClipChange, type TrackChange, type TransportAction,
  type ClockMeasureRequest, type ClockSyncStatus, type ClockResyncAck,
} from '@starling/realtime'
import { createTransportClock, monotonicNow } from '../audio/transportClock'
import { setLiveSocketId } from '../../../composables/useLiveSocketId'
import type { PlayheadAnchor } from '../../../types/timeline'

// Re-exported so the editor keeps importing its wire types from one place.
export type { ClipChange, TrackChange, TransportAction, ClockSyncStatus, ClockResyncAck }

/**
 * The room's transport anchor. Mirrors the API's TransportState
 * (apps/api/src/lib/timelineSockets.ts).
 *
 * `at` stays a SERVER clock reading. Read the position through `serverNow()`
 * each time — `frame + (serverNow() − at)/1000 × frameRate` — rather than
 * converting `at` to local time once, so it improves as the clock estimate does.
 */
export interface TransportState extends PlayheadAnchor {
  /** fps the server advances the clock with, resolved from the DB. */
  frameRate?: number
  /** Who issued the last command. */
  userId?: string
}

/** One person in the room, as the API's presence payload describes them. */
export interface Peer {
  id: string
  name: string
  avatarImageId?: string | null
  createdAt?: string
}

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
 * - Relays clip/track changes the local user persisted over REST to everyone
 *   else in the same timeline room, and applies theirs via the callbacks.
 * - Transport: the SERVER owns the clock. Clients send commands only
 *   (`sendTransport('play'|'pause'|'seek', frame?)`) and receive the room's
 *   authoritative anchor via `onTransport`.
 * - Clock: measures the server's clock, and takes part in room-wide resyncs
 *   (`requestResync`, `clockStatus`).
 * - Tracks who else is in the editor (`peers`).
 *
 * Callbacks:
 *   onClipChange({ type: 'upsert'|'remove', trackId, clip?, clipId? })
 *   onTrackChange({ type: 'upsert'|'remove'|'reorder', track?, trackId?, order? })
 *   onTransport({ playing, frame, frameRate, userId, at })
 *     `frame` is the anchor position at server time `at`;
 *     `frame + (serverNow() − at)/1000 × frameRate` is where the transport is
 *     right now, with the command's network delay cancelled out.
 */
export function useTimelineSync({ onClipChange, onTrackChange, onTransport, onReconnect }: TimelineSyncOptions = {}) {
  const connected = ref(false)
  /** Was connected, lost it, and is trying to get back — not the initial connect. */
  const reconnecting = ref(false)
  const peers     = ref<Peer[]>([])   // everyone in the room, including self
  /**
   * The room's latest clock resync, as `clock:status` reports it; null until one
   * has run while we were here. While its state is `measuring` the server holds
   * any Play, which usePlayback respects so it does not start ahead of the room.
   */
  const clockStatus = ref<ClockSyncStatus | null>(null)

  let socket: Socket | null = null
  let timelineId: string | null = null
  let everConnected = false

  // ── Clock sync ──────────────────────────────────────────────────────────────
  // NTP-style pings measure how the server's clock relates to ours. When:
  //  - a burst on every connect — nothing is known, or the path changed;
  //  - a burst once the transport upgrades to a websocket, because samples
  //    taken over long-polling are lopsided and make poor estimates;
  //  - a burst when the tab becomes visible or the network returns — a machine
  //    that slept may have had its monotonic clock stand still;
  //  - a burst when anyone in the room presses "Sync clocks", answered with a
  //    report of how good the estimate now is;
  //  - one ping every CLOCK_RESYNC_MS, so an all-night session keeps tracking.
  // transportClock.ts keeps the best recent sample, throws out samples a clock
  // jump invalidated, and glides between estimates. It also gates anchors that
  // arrive before the first sample — see there for why that matters to anyone
  // joining mid-playback.
  const CLOCK_BURST     = 5
  const CLOCK_GAP_MS    = 120
  const CLOCK_RESYNC_MS = 15_000

  const clock = createTransportClock({
    deliver: (state: PlayheadAnchor) => onTransport?.(state as TransportState),
    now: monotonicNow,
  })

  function ping(done?: () => void): void {
    const active = socket
    if (!active?.connected) { done?.(); return }
    const t0 = monotonicNow()
    active.timeout(2000).emit(TimelineEvent.timePing, (err: Error | null, serverNow: number) => {
      if (!err) clock.addSample({ t0, t2: monotonicNow(), serverNow })
      done?.()
    })
  }

  let bursting = false
  // Someone waits on a measurement that began after they asked. A burst already
  // under way started before the request, so a fresh one follows it.
  let rerun = false
  let burstWaiters: Array<() => void> = []

  function burst(onDone?: () => void): void {
    if (onDone) {
      burstWaiters.push(onDone)
      if (bursting) rerun = true
    }
    if (bursting) return
    bursting = true
    let answered = 0
    const next = () => ping(() => {
      if (++answered < CLOCK_BURST && socket?.connected) { setTimeout(next, CLOCK_GAP_MS); return }
      bursting = false
      clock.settle()
      if (rerun && socket?.connected) { rerun = false; burst(); return }
      rerun = false
      const waiters = burstWaiters
      burstWaiters = []
      for (const done of waiters) done()
    })
    next()
  }

  let resyncTimer: ReturnType<typeof setInterval> | null = null
  const onVisibility = () => { if (document.visibilityState === 'visible') burst() }
  const onOnline     = () => burst()

  function startClockWatch(): void {
    resyncTimer = setInterval(() => { if (!bursting) ping() }, CLOCK_RESYNC_MS)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
  }

  function stopClockWatch(): void {
    if (resyncTimer) { clearInterval(resyncTimer); resyncTimer = null }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
  }

  function join(id: string): void {
    timelineId = id
    if (!socket) {
      socket = io(TIMELINE_NAMESPACE, { path: '/socket', withCredentials: true })
      startClockWatch()

      const active = socket
      active.on('connect', () => {
        connected.value    = true
        reconnecting.value = false
        if (everConnected) onReconnect?.()
        everConnected = true
        // Every REST mutation now carries this id, so the server can relay the
        // write to the room WITHOUT echoing it back to us.
        setLiveSocketId(active.id ?? null)
        // Clock first: joining a playing room is answered with an anchor, and
        // the first ping should already be in flight when it arrives.
        burst()
        // Each connection gets a fresh engine, which starts on long-polling.
        const engine = active.io.engine
        if (engine && engine.transport?.name !== 'websocket') engine.once('upgrade', () => burst())
        if (timelineId) active.emit(TimelineEvent.join, { timelineId })
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

      active.on(TimelineEvent.presence, (users: Peer[]) => { peers.value = users })
      if (onClipChange)  active.on(TimelineEvent.clipChange, onClipChange)
      if (onTrackChange) active.on(TimelineEvent.trackChange, onTrackChange)
      if (onTransport) active.on(TimelineEvent.transportState, (state: PlayheadAnchor) => clock.accept(state))

      // "Sync clocks", pressed by anyone in the room. Measure afresh, then say
      // how good the estimate now is; the server holds any Play until every
      // client has.
      active.on(TimelineEvent.clockMeasure, ({ requestId }: ClockMeasureRequest) => {
        burst(() => {
          if (socket === active && active.connected) {
            active.emit(TimelineEvent.clockReport, { requestId, rtt: clock.rtt })
          }
        })
      })
      active.on(TimelineEvent.clockStatus, (status: ClockSyncStatus) => { clockStatus.value = status })

      active.on('connect_error', (err: Error) => {
        console.error('[timeline socket]', err.message)
      })
    } else if (socket.connected) {
      socket.emit(TimelineEvent.join, { timelineId })
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
    peers.value     = []
    clockStatus.value = null
    burstWaiters    = []
    rerun           = false
  }

  function sendClipChange(change: ClipChange): void {
    if (socket?.connected) socket.emit(TimelineEvent.clipChange, change)
  }

  function sendTrackChange(change: TrackChange): void {
    if (socket?.connected) socket.emit(TimelineEvent.trackChange, change)
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
      active.emit(TimelineEvent.transportCommand, frame != null ? { action, frame } : { action })
      return
    }

    const now = Date.now()
    _pendingFrame = frame
    if (now - _lastSeekSent >= SEEK_THROTTLE_MS) {
      if (_pendingSeek) { clearTimeout(_pendingSeek); _pendingSeek = null }
      _lastSeekSent = now
      active.emit(TimelineEvent.transportCommand, { action: 'seek', frame })
      return
    }
    if (_pendingSeek) return   // trailing send already queued; frame updated above
    _pendingSeek = setTimeout(() => {
      _pendingSeek  = null
      _lastSeekSent = Date.now()
      if (socket?.connected) socket.emit(TimelineEvent.transportCommand, { action: 'seek', frame: _pendingFrame })
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
      active.timeout(5000).emit(TimelineEvent.clockResync, {}, (err: Error | null, ack: ClockResyncAck) => {
        resolve(err ? { error: err.message } : ack)
      })
    })
  }

  return {
    connected, reconnecting, peers, clockStatus,
    join, leave, sendClipChange, sendTrackChange, sendTransport, serverNow, requestResync,
  }
}
