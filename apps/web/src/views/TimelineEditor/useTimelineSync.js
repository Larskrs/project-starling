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
 *   onTrackChange({ type: 'upsert'|'remove', track?, trackId? })
 *   onPlayhead({ frame, isPlaying, userId })
 */
export function useTimelineSync({ onClipChange, onTrackChange, onPlayhead } = {}) {
  const connected = ref(false)
  const peers     = ref([])   // everyone in the room, including self

  let socket     = null
  let timelineId = null

  function join(id) {
    timelineId = id
    if (!socket) {
      socket = io('/timeline', { path: '/socket', withCredentials: true })

      socket.on('connect', () => {
        connected.value = true
        // (Re)join after connect and after every reconnect.
        if (timelineId) socket.emit('timeline:join', { timelineId })
      })
      socket.on('disconnect', () => {
        connected.value = false
        peers.value = []
      })

      socket.on('timeline:presence', (users) => { peers.value = users })
      if (onClipChange)  socket.on('clip:change', onClipChange)
      if (onTrackChange) socket.on('track:change', onTrackChange)
      if (onPlayhead)    socket.on('playhead:sync', onPlayhead)

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
