import { ref, computed, watch } from 'vue'
import { clamp } from './useEditorUtils.js'
import { startAudioPlayback, stopAudioPlayback } from './useAudioEngine.js'
import { resolveTrackSettings } from './behaviors/trackSettings.js'
import { createMetronome } from './behaviors/metronome.js'
import { createCueSpeaker } from './behaviors/tts.js'

const PLAYING_SYNC_INTERVAL_MS = 1000

/**
 * Playhead + transport state for the timeline editor.
 *
 * Owns the rAF animation loop, audio scheduling, auto-follow scrolling, and
 * the live-sync playhead protocol (broadcast local transport actions, apply
 * remote ones without echo).
 *
 * @param {{
 *   timeline:     import('vue').Ref<object|null>,
 *   trackList:    import('vue').Ref<Array>,
 *   trackTypes:   import('vue').Ref<Array>,
 *   mutedTracks:  import('vue').Ref<Record<string, boolean>>,  // client-local mute (cookie)
 *   pxPerFrame:   import('vue').Ref<number>,
 *   canvasRef:    import('vue').Ref<HTMLElement|null>,
 *   sendPlayhead: (frame: number, isPlaying: boolean, opts?: object) => void,
 * }} deps
 */
export function usePlayback({ timeline, trackList, trackTypes, mutedTracks, pxPerFrame, canvasRef, sendPlayhead }) {
  // Stored as float for smooth animation; TC display rounds it.
  const playheadFrame = ref(0)
  const isPlaying     = ref(false)

  watch(timeline, tl => { if (tl) playheadFrame.value = tl.startFrame }, { immediate: true })

  const playheadX = computed(() =>
    timeline.value ? (playheadFrame.value - timeline.value.startFrame) * pxPerFrame.value : 0,
  )

  let _rafId       = null
  let _lastTs      = null
  let _lastSyncMs  = 0
  let _resyncTimer = null

  // Mute is client-local (cookie), not the server's isMuted flag.
  const isMuted = (track) => !!mutedTracks?.value?.[track.id]

  // Clips that should currently sound: everything on unmuted tracks.
  const currentClips = () => trackList.value.flatMap(t => isMuted(t) ? [] : t.clips)

  // Behavior playback controllers (metronome, TTS, …) active for this run —
  // built from each unmuted track's type settings.
  let _behaviors = []

  function _startBehaviors(fps) {
    for (const track of trackList.value) {
      if (isMuted(track)) continue
      const settings = resolveTrackSettings(track, trackTypes?.value ?? [])
      if (settings.metronome) _behaviors.push(createMetronome({ clips: track.clips, fps, endFrame: timeline.value.endFrame }))
      if (settings.tts)       _behaviors.push(createCueSpeaker({ clips: track.clips, fps }))
    }
    for (const b of _behaviors) b.start(playheadFrame.value)
  }

  function _stopBehaviors() {
    for (const b of _behaviors) { try { b.stop() } catch {} }
    _behaviors = []
  }

  // Re-point the audio at the live timeline state (position, mutes, clip edits)
  // without touching the visual rAF loop, so playback keeps rolling. A restart
  // is cheap here: each run is its own gain subtree, torn down cleanly on stop.
  function resyncAudio() {
    if (!isPlaying.value || !timeline.value) return
    const fps = parseFloat(timeline.value.frameRate)
    startAudioPlayback(currentClips(), playheadFrame.value, fps)
    _stopBehaviors()
    _startBehaviors(fps)
  }

  // Coalesce high-frequency triggers (scrubbing) into a single trailing resync.
  function scheduleResync() {
    if (!isPlaying.value) return
    if (_resyncTimer) clearTimeout(_resyncTimer)
    _resyncTimer = setTimeout(() => { _resyncTimer = null; resyncAudio() }, 80)
  }

  // Mute flips and clip edits (add / move / crop / delete) during playback should
  // be reflected in the audio. This key changes only when the timeline is edited
  // (not every frame), so the watch stays cheap.
  const audioStateKey = computed(() =>
    trackList.value
      .map(t => (isMuted(t) ? 'm' : '') + t.clips.map(c =>
        `${c.id}:${c.position}:${c.mediaStart}:${c.end}:${c.fileId}:${c.data?.bpm ?? ''}:${c.data?.beatsPerBar ?? ''}:${c.label ?? ''}`,
      ).join(','))
      .join('|'),
  )
  watch(audioStateKey, () => { if (isPlaying.value) resyncAudio() })

  function setPlayhead(frame, { broadcast = true } = {}) {
    if (!timeline.value) return
    playheadFrame.value = clamp(frame, timeline.value.startFrame, timeline.value.endFrame)
    if (broadcast) {
      sendPlayhead(playheadFrame.value, isPlaying.value)
      scheduleResync()  // local seek while playing → audio follows the playhead
    }
  }

  function seekStart() {
    stopPlayback(false)
    setPlayhead(timeline.value?.startFrame ?? 0)
  }

  function seekEnd() {
    stopPlayback(false)
    setPlayhead(timeline.value?.endFrame ?? 0)
  }

  function startPlayback(broadcast = true) {
    if (!timeline.value) return
    if (playheadFrame.value >= timeline.value.endFrame) {
      playheadFrame.value = timeline.value.startFrame
    }
    isPlaying.value = true
    _lastTs         = null
    _lastSyncMs     = Date.now()
    _rafId          = requestAnimationFrame(_tick)

    const fps = parseFloat(timeline.value.frameRate)
    startAudioPlayback(currentClips(), playheadFrame.value, fps)
    _startBehaviors(fps)

    if (broadcast) sendPlayhead(playheadFrame.value, true, { immediate: true })
  }

  function stopPlayback(broadcast = true) {
    const wasPlaying = isPlaying.value
    isPlaying.value = false
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null }
    if (_resyncTimer) { clearTimeout(_resyncTimer); _resyncTimer = null }
    _lastTs = null
    stopAudioPlayback()
    _stopBehaviors()

    if (broadcast && wasPlaying) sendPlayhead(playheadFrame.value, false, { immediate: true })
  }

  function togglePlayback() {
    isPlaying.value ? stopPlayback() : startPlayback()
  }

  function _tick(ts) {
    if (!_lastTs) _lastTs = ts
    const elapsed = ts - _lastTs
    _lastTs = ts

    const fps = parseFloat(timeline.value.frameRate)
    playheadFrame.value += elapsed * fps / 1000

    if (playheadFrame.value >= timeline.value.endFrame) {
      playheadFrame.value = timeline.value.endFrame
      stopPlayback()
      return
    }

    // Keep the playhead in view while playing (scroll event refreshes viewport).
    const canvas = canvasRef.value
    if (canvas) {
      const x     = (playheadFrame.value - timeline.value.startFrame) * pxPerFrame.value
      const viewL = canvas.scrollLeft
      const viewR = viewL + canvas.clientWidth
      if (x > viewR - 40 || x < viewL) {
        canvas.scrollLeft = Math.max(0, x - canvas.clientWidth * 0.2)
      }
    }

    // Periodic re-sync so followers correct drift.
    const now = Date.now()
    if (now - _lastSyncMs >= PLAYING_SYNC_INTERVAL_MS) {
      _lastSyncMs = now
      sendPlayhead(playheadFrame.value, true)
    }

    _rafId = requestAnimationFrame(_tick)
  }

  /** Apply a peer's transport state without echoing it back. */
  function applyRemotePlayhead({ frame, isPlaying: remotePlaying }) {
    if (!timeline.value) return
    const fps = parseFloat(timeline.value.frameRate)

    if (remotePlaying) {
      if (!isPlaying.value) {
        setPlayhead(frame, { broadcast: false })
        startPlayback(false)
      } else if (Math.abs(playheadFrame.value - frame) > fps / 2) {
        // Drifted more than half a second — snap and restart audio at the new position.
        stopPlayback(false)
        setPlayhead(frame, { broadcast: false })
        startPlayback(false)
      }
    } else {
      if (isPlaying.value) stopPlayback(false)
      setPlayhead(frame, { broadcast: false })
    }
  }

  return {
    playheadFrame, playheadX, isPlaying,
    setPlayhead, seekStart, seekEnd,
    startPlayback, stopPlayback, togglePlayback,
    applyRemotePlayhead,
  }
}
