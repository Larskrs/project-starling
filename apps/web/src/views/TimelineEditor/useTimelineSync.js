import { ref } from 'vue'
import { io } from 'socket.io-client'

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
export function useTimelineSync({ onClipChange, onTrackChange, onTransport } = {}) {
  const connected = ref(false)
  const peers     = ref([])   // everyone in the room, including self

  let socket     = null
  let timelineId = null

  // ── Clock sync ──────────────────────────────────────────────────────────────
  // NTP-style: a short burst of pings estimates the offset between the server
  // clock and ours (offset = serverNow − localNow). Transport anchors carry a
  // server stamp; with the offset we can place them precisely on our clock
  // regardless of either machine's wall time or one message's network delay.
  const CLOCK_SAMPLES = 5
  let _clockOffset = null   // ms; null until the first burst completes

  function syncClock() {
    const samples = []
    let attempts  = 0
    const ping = () => {
      if (!socket?.connected) return
      const t0 = Date.now()
      socket.timeout(2000).emit('time:ping', (err, serverNow) => {
        attempts++
        if (!err && typeof serverNow === 'number') {
          const t2 = Date.now()
          // Server clock at receipt ≈ serverNow + rtt/2 (symmetric-path assumption).
          samples.push({ offset: serverNow + (t2 - t0) / 2 - t2, rtt: t2 - t0 })
        }
        if (attempts >= CLOCK_SAMPLES) {
          if (samples.length) {
            // The lowest-RTT sample carries the least queueing noise.
            samples.sort((a, b) => a.rtt - b.rtt)
            _clockOffset = samples[0].offset
          }
          return
        }
        setTimeout(ping, 120)
      })
    }
    ping()
  }

  /** Server-stamp → local clock ms; falls back to "now" until the offset is measured. */
  function anchorLocalMs(at) {
    if (typeof at !== 'number' || _clockOffset === null) return Date.now()
    return at - _clockOffset
  }

  function join(id) {
    timelineId = id
    if (!socket) {
      socket = io('/timeline', { path: '/socket', withCredentials: true })

      socket.on('connect', () => {
        connected.value = true
        // (Re)join after connect and after every reconnect; re-measure the
        // clock offset too — the transport path may have changed.
        if (timelineId) socket.emit('timeline:join', { timelineId })
        syncClock()
      })
      socket.on('disconnect', () => {
        connected.value = false
        peers.value = []
      })

      socket.on('timeline:presence', (users) => { peers.value = users })
      if (onClipChange)  socket.on('clip:change', onClipChange)
      if (onTrackChange) socket.on('track:change', onTrackChange)
      if (onTransport)   socket.on('transport:state', (state) => {
        onTransport({ ...state, anchorLocalMs: anchorLocalMs(state.at) })
      })

      socket.on('connect_error', (err) => {
        console.error('[timeline socket]', err.message)
      })
    } else if (socket.connected) {
      socket.emit('timeline:join', { timelineId })
    }
  }

  function leave() {
    socket?.emit('timeline:leave')
    socket?.disconnect()
    socket          = null
    timelineId      = null
    connected.value = false
    peers.value     = []
  }

  function sendClipChange(change) {
    if (socket?.connected) socket.emit('clip:change', change)
  }

  function sendTrackChange(change) {
    if (socket?.connected) socket.emit('track:change', change)
  }

  // Transport commands. play/pause send immediately (and drop any queued
  // seek — the newer intent wins); seeks are throttled leading+trailing so a
  // scrub doesn't flood the server, with the trailing send carrying the
  // LATEST frame of the burst.
  const SEEK_THROTTLE_MS = 120
  let _lastSeekSent  = 0
  let _pendingSeek   = null
  let _pendingFrame  = null

  function sendTransport(action, frame = null) {
    if (!socket?.connected) return

    if (action !== 'seek') {
      if (_pendingSeek) { clearTimeout(_pendingSeek); _pendingSeek = null }
      socket.emit('transport:command', frame != null ? { action, frame } : { action })
      return
    }

    const now = Date.now()
    _pendingFrame = frame
    if (now - _lastSeekSent >= SEEK_THROTTLE_MS) {
      if (_pendingSeek) { clearTimeout(_pendingSeek); _pendingSeek = null }
      _lastSeekSent = now
      socket.emit('transport:command', { action: 'seek', frame })
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
