import { ref } from 'vue'
import { io } from 'socket.io-client'

/**
 * Live-sync channel for the timeline editor (socket.io namespace `/timeline`).
 *
 * - Relays clip/track changes the local user persisted over REST to everyone
 *   else in the same timeline room, and applies theirs via the callbacks.
 * - Broadcasts the local transport (playhead frame + play state) so all
 *   clients follow the same current time.
 * - Tracks who else is in the editor (`peers`).
 *
 * Callbacks receive exactly the payloads the peer sent:
 *   onClipChange({ type: 'upsert'|'remove', trackId, clip?, clipId? })
 *   onTrackChange({ type: 'upsert'|'remove'|'reorder', track?, trackId?, order? })
 *   onPlayhead({ frame, isPlaying, userId, ageMs })
 *     ageMs = how old the state is by the time the callback runs — derived
 *     from the server's relay stamp and the measured clock offset, so it
 *     reflects when the state was produced, not when the message arrived.
 */
export function useTimelineSync({ onClipChange, onTrackChange, onPlayhead } = {}) {
  const connected = ref(false)
  const peers     = ref([])   // everyone in the room, including self

  let socket     = null
  let timelineId = null

  // ── Clock sync ──────────────────────────────────────────────────────────────
  // NTP-style: a short burst of pings estimates the offset between the server
  // clock and ours (offset = serverNow − localNow). playhead:sync relays carry
  // a server stamp; with the offset we can age them precisely regardless of
  // either machine's wall clock or the network delay of this one message.
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

  /** Age of a server-stamped message in local ms (0 when not measurable). */
  function messageAge(at) {
    if (typeof at !== 'number' || _clockOffset === null) return 0
    return Math.min(10_000, Math.max(0, Date.now() - (at - _clockOffset)))
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
      if (onPlayhead)    socket.on('playhead:sync', (state) => {
        onPlayhead({ ...state, ageMs: messageAge(state.at) })
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

  // Playhead updates are throttled (trailing-edge) so scrubbing doesn't flood
  // the socket; play/pause transitions bypass the throttle via `immediate`.
  const PLAYHEAD_THROTTLE_MS = 120
  let _lastSent = 0
  let _pending  = null

  function sendPlayhead(frame, isPlaying, { immediate = false } = {}) {
    if (!socket?.connected) return
    const now = Date.now()

    if (immediate || now - _lastSent >= PLAYHEAD_THROTTLE_MS) {
      if (_pending) { clearTimeout(_pending); _pending = null }
      _lastSent = now
      socket.emit('playhead:update', { frame, isPlaying })
      return
    }

    if (_pending) clearTimeout(_pending)
    _pending = setTimeout(() => {
      _pending  = null
      _lastSent = Date.now()
      if (socket?.connected) socket.emit('playhead:update', { frame, isPlaying })
    }, PLAYHEAD_THROTTLE_MS - (now - _lastSent))
  }

  return { connected, peers, join, leave, sendClipChange, sendTrackChange, sendPlayhead }
}
