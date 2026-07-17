import { ref, computed, watch } from 'vue'
import { clamp } from './useEditorUtils.js'
import { startAudioPlayback, seekAudioPlayback, resyncAudioPlayback, stopAudioPlayback, getPlaybackFrame, nudgePlaybackAnchor } from './useAudioEngine.js'
import { resolveTrackSettings } from './behaviors/trackSettings.js'
import { createMetronome } from './behaviors/metronome.js'
import { createCueSpeaker } from './behaviors/tts.js'

const PLAYING_SYNC_INTERVAL_MS = 500

// Two-tier drift correction: the visual playhead corrects on ANY measurable
// drift so every client shows the same frame as closely as possible, but audio
// only re-anchors (restarts voices) when the correction is at least
// AUDIO_RESYNC_FRAMES — anything smaller is absorbed by shifting the run's
// clock anchor, which is inaudible. Corrections below the deadband are noise
// (clock-offset estimation error) and are ignored entirely.
const AUDIO_RESYNC_FRAMES   = 10
const DRIFT_DEADBAND_FRAMES = 0.25

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

  // Align the running audio with the playhead. Close-enough corrections
  // (< AUDIO_RESYNC_FRAMES, incl. accumulated nudges) don't restart audio at
  // all: the run's anchor shifts so the clocks agree and the sounding voices
  // play on — no jitter from small seeks or sync corrections. Only a genuine
  // jump re-anchors the run in place (voices retire with a declick fade, the
  // gain subtree and scheduler survive).
  function resyncAudioFull() {
    if (!isPlaying.value || !timeline.value) return
    const fps = parseFloat(timeline.value.frameRate)

    const engineFrame = getPlaybackFrame()
    if (engineFrame != null) {
      const delta = playheadFrame.value - engineFrame
      if (Math.abs(delta) < AUDIO_RESYNC_FRAMES) {
        const skew = nudgePlaybackAnchor(delta)
        if (skew < AUDIO_RESYNC_FRAMES) {
          // Metronome/TTS are timed off the reported frame — re-time them for
          // noticeable shifts; audio clips stay untouched either way.
          if (Math.abs(delta) >= 1) resyncBehaviors()
          return
        }
      }
    }

    seekAudioPlayback(currentClips(), playheadFrame.value, fps)
    _stopBehaviors()
    _startBehaviors(fps)
  }

  // A clip edit (move / crop / add / delete / mute) does NOT move the playhead, so
  // re-point the running audio in place: unchanged clips keep sounding, only the
  // edited clip is rescheduled. This is what avoids the whole mix dropping out for
  // a moment when a single clip is moved.
  function resyncAudioClips() {
    if (!isPlaying.value || !timeline.value) return
    const fps = parseFloat(timeline.value.frameRate)
    resyncAudioPlayback(currentClips(), playheadFrame.value, fps)
  }

  // Behavior tracks (metronome / TTS) are deterministic from the playhead, so a
  // clean restart at the current position re-aligns them without artifacts.
  function resyncBehaviors() {
    if (!isPlaying.value || !timeline.value) return
    _stopBehaviors()
    _startBehaviors(parseFloat(timeline.value.frameRate))
  }

  // Leading edge + true trailing debounce: a lone trigger (a single seek click)
  // fires immediately; calls arriving in a burst (a scrub, a relay storm) keep
  // deferring one trailing call until the burst pauses — so a fast scrub does
  // NOT re-anchor audio a dozen times a second, it re-attacks once where the
  // scrub lands (and at natural pauses of a slow scrub). Each kind of resync
  // gets its own debounce so, e.g., a bpm edit doesn't also restart clip audio.
  function debounceWhilePlaying(fn, delayMs = 80) {
    let timer    = null
    let lastCall = 0
    const run = () => {
      if (!isPlaying.value) return
      const now   = Date.now()
      const burst = now - lastCall < delayMs
      lastCall = now
      if (timer) clearTimeout(timer)
      if (!burst) { fn(); return }
      timer = setTimeout(() => { timer = null; fn() }, delayMs)
    }
    run.pending = () => timer !== null
    run.cancel  = () => { if (timer) { clearTimeout(timer); timer = null } }
    return run
  }

  const scheduleResync    = debounceWhilePlaying(resyncAudioFull)
  const scheduleClipSync  = debounceWhilePlaying(resyncAudioClips)
  const scheduleBehaviors = debounceWhilePlaying(resyncBehaviors)

  // Audio-clip scheduling signature: only the fields that decide what sample plays
  // and when (position / crop / source), plus each track's mute. Moving or cropping
  // a clip changes this and triggers an in-place clip resync — which leaves every
  // OTHER clip's audio untouched, so the mix no longer drops out on an edit.
  const audioClipsKey = computed(() =>
    trackList.value
      .map(t => (isMuted(t) ? 'm' : '') + t.clips
        .filter(c => c.fileId)
        .map(c => `${c.id}:${c.position}:${c.mediaStart}:${c.end}:${c.fileId}`)
        .join(','))
      .join('|'),
  )
  watch(audioClipsKey, scheduleClipSync)

  // Behavior signature: only clips on metronome / TTS tracks, keyed by what those
  // controllers consume (position, bpm/beatsPerBar, label) plus mute. Editing an
  // audio clip on an ordinary track leaves this unchanged, so the metronome/TTS
  // are never needlessly restarted.
  const behaviorKey = computed(() =>
    trackList.value
      .map(t => {
        const settings = resolveTrackSettings(t, trackTypes?.value ?? [])
        if (!settings.metronome && !settings.tts) return ''
        return (isMuted(t) ? 'm' : '') + t.clips.map(c =>
          `${c.id}:${c.position}:${c.data?.bpm ?? ''}:${c.data?.beatsPerBar ?? ''}:${c.label ?? ''}`,
        ).join(',')
      })
      .join('|'),
  )
  watch(behaviorKey, scheduleBehaviors)

  function setPlayhead(frame, { broadcast = true } = {}) {
    if (!timeline.value) return
    playheadFrame.value = clamp(frame, timeline.value.startFrame, timeline.value.endFrame)
    // Seeking a STOPPED timeline is private — everyone browses their own
    // position. Only an active (playing) transport is shared, so only then
    // does a seek broadcast and re-anchor the running audio.
    if (broadcast && isPlaying.value) {
      sendPlayhead(playheadFrame.value, true)
      scheduleResync()
    }
  }

  // Home/End: if the shared transport is running this stops it for everyone
  // (broadcast), then the jump itself is a private stopped-state seek.
  function seekStart() {
    stopPlayback()
    setPlayhead(timeline.value?.startFrame ?? 0)
  }

  function seekEnd() {
    stopPlayback()
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
    scheduleResync.cancel()
    scheduleClipSync.cancel()
    scheduleBehaviors.cancel()
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

    // The audio clock is the time base while it runs: the playhead is DERIVED
    // from the engine's run position, so sound and visuals cannot drift apart
    // (no accumulated rAF error, no lead-time offset) and the periodic peer
    // broadcasts below carry audio-true positions. rAF integration covers a
    // context that isn't running (autoplay-blocked remote playback) and the
    // moments the engine anchor disagrees with the playhead — mid-scrub before
    // the debounced resync lands, or a context that resumed after being
    // suspended. Disagreement routes through scheduleResync (debounced) so a
    // scrub doesn't re-anchor audio sixty times a second.
    const engineFrame = getPlaybackFrame()
    if (engineFrame != null && Math.abs(engineFrame - playheadFrame.value) <= fps / 2) {
      playheadFrame.value = engineFrame
    } else {
      playheadFrame.value += elapsed * fps / 1000
      // Nudge a re-anchor only when none is queued — repeating the call every
      // frame would keep resetting the trailing debounce and starve it.
      if (engineFrame != null && !scheduleResync.pending()) scheduleResync()
    }

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

  /**
   * Apply a peer's transport state without echoing it back.
   *
   * The shared transport is the PLAYING state: while a peer plays, everyone
   * displays the active timeline. `ageMs` (from useTimelineSync) is how old
   * the state is by the time it gets here — while playing, the target is
   * frame + age, i.e. where the playhead is SUPPOSED to be now, not where it
   * was when the message left, so a behind follower catches up on every sync.
   * A stopped timeline is browsed privately: a remote stop ends the shared run
   * at its stop position, but is ignored when we're already stopped — it must
   * never yank a privately-seeking user's playhead.
   */
  function applyRemotePlayhead({ frame, isPlaying: remotePlaying, ageMs = 0 }) {
    if (!timeline.value) return
    const fps    = parseFloat(timeline.value.frameRate)
    const target = remotePlaying ? frame + (ageMs / 1000) * fps : frame

    if (remotePlaying) {
      if (!isPlaying.value) {
        setPlayhead(target, { broadcast: false })
        startPlayback(false)
      } else if (Math.abs(playheadFrame.value - target) > DRIFT_DEADBAND_FRAMES) {
        // Correct ANY measurable drift so every client tracks the same frame.
        // resyncAudioFull decides how: small corrections nudge the audio
        // anchor (voices play on, no jitter); only ≥ AUDIO_RESYNC_FRAMES
        // actually re-anchors the audio.
        setPlayhead(target, { broadcast: false })
        resyncAudioFull()
      }
    } else {
      if (!isPlaying.value) return
      stopPlayback(false)
      setPlayhead(target, { broadcast: false })
    }
  }

  return {
    playheadFrame, playheadX, isPlaying,
    setPlayhead, seekStart, seekEnd,
    startPlayback, stopPlayback, togglePlayback,
    applyRemotePlayhead,
  }
}
