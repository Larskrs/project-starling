import { ref, computed, watch } from 'vue'
import { clamp } from './useEditorUtils.js'
import { startAudioPlayback, seekAudioPlayback, resyncAudioPlayback, stopAudioPlayback, getPlaybackFrame, nudgePlaybackAnchor } from './useAudioEngine.js'
import { resolveTrackSettings } from './behaviors/trackSettings.js'
import { createMetronome } from './behaviors/metronome.js'
import { createCueSpeaker } from './behaviors/tts.js'

// The SERVER owns the transport clock: clients send commands (play/pause/seek)
// and continuously converge on the server's anchor — position now =
// anchorFrame + (localNow − anchorLocalMs)/1000 × fps. Convergence is checked
// on an interval while playing.
const ANCHOR_CHECK_MS = 500

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
 *   sendTransport: (action: 'play'|'pause'|'seek', frame?: number) => void,
 * }} deps
 */
export function usePlayback({ timeline, trackList, trackTypes, mutedTracks, pxPerFrame, canvasRef, sendTransport }) {
  // Stored as float for smooth animation; TC display rounds it.
  const playheadFrame = ref(0)
  const isPlaying     = ref(false)

  watch(timeline, tl => { if (tl) playheadFrame.value = tl.startFrame }, { immediate: true })

  const playheadX = computed(() =>
    timeline.value ? (playheadFrame.value - timeline.value.startFrame) * pxPerFrame.value : 0,
  )

  let _rafId       = null
  let _lastTs      = null

  // The server's authoritative anchor while the shared transport plays:
  // { frame, localMs, fps } — null while stopped, and cleared on local
  // optimistic actions (play/seek) until the server echoes the new anchor.
  let _serverAnchor    = null
  let _lastAnchorCheck = 0

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
    // position. Only an active (playing) transport is shared: the seek goes to
    // the server as a command (the server re-anchors its clock and echoes the
    // authoritative state back), while local audio follows optimistically.
    if (broadcast && isPlaying.value) {
      _serverAnchor = null   // stale until the server echoes the new anchor
      sendTransport('seek', playheadFrame.value)
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
    isPlaying.value  = true
    _lastTs          = null
    _serverAnchor    = null   // set by the server's echo of our play command
    _lastAnchorCheck = 0
    _rafId           = requestAnimationFrame(_tick)

    const fps = parseFloat(timeline.value.frameRate)
    startAudioPlayback(currentClips(), playheadFrame.value, fps)
    _startBehaviors(fps)

    if (broadcast) sendTransport('play', playheadFrame.value)
  }

  function stopPlayback(broadcast = true) {
    const wasPlaying = isPlaying.value
    isPlaying.value = false
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null }
    scheduleResync.cancel()
    scheduleClipSync.cancel()
    scheduleBehaviors.cancel()
    _lastTs       = null
    _serverAnchor = null
    stopAudioPlayback()
    _stopBehaviors()

    // The server computes the authoritative stop frame from ITS clock.
    if (broadcast && wasPlaying) sendTransport('pause')
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

    // Converge on the server's clock: where the anchor says the transport is
    // NOW vs where we are. resyncAudioFull applies the two-tier correction
    // (sub-deadband ignored, small drift nudges the audio anchor inaudibly,
    // ≥ AUDIO_RESYNC_FRAMES re-anchors audio for real).
    const now = Date.now()
    if (_serverAnchor && now - _lastAnchorCheck >= ANCHOR_CHECK_MS) {
      _lastAnchorCheck = now
      const serverFrame = _serverAnchor.frame + ((now - _serverAnchor.localMs) / 1000) * _serverAnchor.fps
      if (Math.abs(serverFrame - playheadFrame.value) > DRIFT_DEADBAND_FRAMES) {
        setPlayhead(serverFrame, { broadcast: false })
        resyncAudioFull()
      }
    }

    _rafId = requestAnimationFrame(_tick)
  }

  /**
   * Apply the server's authoritative transport state (every command — ours
   * included — echoes back as one of these).
   *
   * While playing, the state is a clock anchor: `frame` at server time `at`,
   * mapped to our clock as `anchorLocalMs`. The current position is PREDICTED
   * as frame + elapsed-since-anchor × fps — however delayed the message was,
   * every client lands on the same wall-clock-aligned frame. The anchor is
   * kept and `_tick` keeps converging on it, so the server decides how fast
   * frames go from then on. A stopped timeline is browsed privately: a stop
   * ends the shared run at the server-computed frame but is ignored when
   * we're already stopped — it must never yank a privately-seeking user.
   */
  function applyTransportState({ playing, frame, frameRate, anchorLocalMs }) {
    if (!timeline.value) return
    const fps = frameRate || parseFloat(timeline.value.frameRate)

    if (playing) {
      const predicted = frame + ((Date.now() - anchorLocalMs) / 1000) * fps

      // A run that outlived the timeline (driver vanished mid-play, nobody
      // paused) — treat as ended rather than chasing an impossible position.
      if (predicted >= timeline.value.endFrame) {
        _serverAnchor = null
        if (isPlaying.value) stopPlayback(false)
        return
      }

      if (!isPlaying.value) {
        setPlayhead(predicted, { broadcast: false })
        startPlayback(false)
      }
      // Adopt the anchor AFTER a possible startPlayback (which clears it);
      // the next tick converges us onto it via the two-tier correction.
      _serverAnchor    = { frame, localMs: anchorLocalMs, fps }
      _lastAnchorCheck = 0
    } else {
      _serverAnchor = null
      if (!isPlaying.value) return
      stopPlayback(false)
      setPlayhead(frame, { broadcast: false })
    }
  }

  return {
    playheadFrame, playheadX, isPlaying,
    setPlayhead, seekStart, seekEnd,
    startPlayback, stopPlayback, togglePlayback,
    applyTransportState,
  }
}
