import { ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { createTransportClock } from './transportClock'
import type { Clip, PlayheadAnchor, Track } from '../../types/timeline'

export interface ClipChange {
  type: 'upsert' | 'remove'
  trackId: string
  clip?: Clip
  clipId?: string
}

export interface TrackChange {
  type: 'upsert' | 'remove' | 'reorder'
  track?: Track
  trackId?: string
  order?: string[]
}

/**
 * The room's transport anchor, with the server stamp mapped onto our clock.
 * Mirrors the API's TransportState (apps/api/src/lib/timelineSockets.ts) plus
 * the locally-derived `anchorLocalMs`.
 */
export interface TransportState extends PlayheadAnchor {
  /** fps the server advances the clock with, resolved from the DB. */
  frameRate?: number
  /** Who issued the last command. */
  userId?: string
  /** `at` expressed on OUR clock, via the measured offset. */
  anchorLocalMs: number
}

export interface Peer {
  userId: string
  firstName?: string
  lastName?: string
  profileImageId?: string | null
}

export type TransportAction = 'play' | 'pause' | 'seek'

export interface TimelineSyncOptions {
  onClipChange?: (change: ClipChange) => void
  onTrackChange?: (change: TrackChange) => void
  onTransport?: (state: TransportState) => void
}

/**
 * Live-sync channel for the timeline editor (socket.io namespace `/timeline`).
 *
 * - Relays clip/track changes the local user persisted over REST to everyone
 *   else in the same timeline room, and applies theirs via the callbacks.
 * - Transport: the SERVER owns the clock. Clients send commands only
 *   (`sendTransport('play'|'pause'|'seek', frame?)`) and receive the room's
 *   authoritative anchor via `onTransport`.
 * - Tracks who else is in the editor (`peers`).
 *
 * Callbacks:
 *   onClipChange({ type: 'upsert'|'remove', trackId, clip?, clipId? })
 *   onTrackChange({ type: 'upsert'|'remove'|'reorder', track?, trackId?, order? })
 *   onTransport({ playing, frame, frameRate, userId, at, anchorLocalMs })
 *     `frame` is the anchor position at server time `at`; `anchorLocalMs` is
 *     that same instant on OUR clock (server stamp mapped through the measured
 *     clock offset) — `frame + (Date.now() − anchorLocalMs)/1000 × frameRate`
 *     is where the transport is right now, with the command's network delay
 *     cancelled out.
 */
export function useTimelineSync({ onClipChange, onTrackChange, onTransport }: TimelineSyncOptions = {}) {
  const connected = ref(false)
  const peers     = ref<Peer[]>([])   // everyone in the room, including self

  let socket: Socket | null = null
  let timelineId: string | null = null

  // ── Clock sync ──────────────────────────────────────────────────────────────
  // NTP-style: a short burst of pings estimates the offset between the server
  // clock and ours (offset = serverNow − localNow). Transport anchors carry a
  // server stamp; with the offset we can place them precisely on our clock
  // regardless of either machine's wall time or one message's network delay.
  // The clock also gates anchors that arrive before it is measured — see
  // transportClock.js for why that matters to anyone joining mid-playback.
  const CLOCK_SAMPLES = 5

  const clock = createTransportClock({
    deliver: (state: PlayheadAnchor) => onTransport?.({ ...state, anchorLocalMs: clock.localMsFor(state.at) }),
  })

  function syncClock(): void {
    let attempts = 0
    const ping = () => {
      if (!socket?.connected) return
      const t0 = Date.now()
      socket.timeout(2000).emit('time:ping', (err: Error | null, serverNow: number) => {
        attempts++
        if (!err) clock.addSample({ t0, t2: Date.now(), serverNow })
        if (attempts >= CLOCK_SAMPLES) { clock.settle(); return }
        setTimeout(ping, 120)
      })
    }
    ping()
  }

  function join(id: string): void {
    timelineId = id
    if (!socket) {
      socket = io('/timeline', { path: '/socket', withCredentials: true })

      const active = socket
      active.on('connect', () => {
        connected.value = true
        // Clock first: joining a playing room is answered with an anchor, and
        // the first ping should already be in flight when it arrives. Re-run on
        // every reconnect — the transport path may have changed.
        syncClock()
        if (timelineId) active.emit('timeline:join', { timelineId })
      })
      active.on('disconnect', () => {
        connected.value = false
        peers.value = []
        // An anchor held from before the drop describes a room we are no longer
        // in step with; the rejoin brings a fresh one.
        clock.reset()
      })

      active.on('timeline:presence', (users: Peer[]) => { peers.value = users })
      if (onClipChange)  active.on('clip:change', onClipChange)
      if (onTrackChange) active.on('track:change', onTrackChange)
      if (onTransport) active.on('transport:state', (state: PlayheadAnchor) => clock.accept(state))

      active.on('connect_error', (err: Error) => {
        console.error('[timeline socket]', err.message)
      })
    } else if (socket.connected) {
      socket.emit('timeline:join', { timelineId })
    }
  }

  function leave(): void {
    clock.reset()
    socket?.emit('timeline:leave')
    socket?.disconnect()
    socket          = null
    timelineId      = null
    connected.value = false
    peers.value     = []
  }

  function sendClipChange(change: ClipChange): void {
    if (socket?.connected) socket.emit('clip:change', change)
  }

  function sendTrackChange(change: TrackChange): void {
    if (socket?.connected) socket.emit('track:change', change)
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
      active.emit('transport:command', frame != null ? { action, frame } : { action })
      return
    }

    const now = Date.now()
    _pendingFrame = frame
    if (now - _lastSeekSent >= SEEK_THROTTLE_MS) {
      if (_pendingSeek) { clearTimeout(_pendingSeek); _pendingSeek = null }
      _lastSeekSent = now
      active.emit('transport:command', { action: 'seek', frame })
      return
    }
    if (_pendingSeek) return   // trailing send already queued; frame updated above
    _pendingSeek = setTimeout(() => {
      _pendingSeek  = null
      _lastSeekSent = Date.now()
      if (socket?.connected) socket.emit('transport:command', { action: 'seek', frame: _pendingFrame })
    }, SEEK_THROTTLE_MS - (now - _lastSeekSent))
  }

  return { connected, peers, join, leave, sendClipChange, sendTrackChange, sendTransport }
}
