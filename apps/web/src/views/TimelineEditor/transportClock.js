/**
 * Server-clock offset estimation, and the gate that stops a transport anchor
 * being read before that offset exists.
 *
 * The server sends anchors as `{ frame, at }` — "the playhead was at `frame`
 * when my clock said `at`". A client turns that into a position by aging the
 * anchor: `frame + (now − at) × fps`. That only works once we know how the
 * server's clock relates to ours.
 *
 * The bug this exists to prevent: a client that joins a room mid-playback is
 * sent the anchor immediately, before its clock burst has finished. With no
 * offset the anchor's `at` reads as "now", the age comes out as zero, and the
 * joiner starts at the frame playback STARTED on — minutes behind everyone
 * else, and it stays there, because the anchor is never re-sent. So an anchor
 * that arrives early is held, not guessed at, and released the moment the first
 * ping lands.
 *
 * Vue-free and socket-free so the timing rules can be tested in bare node —
 * see transportClock.test.mjs.
 */
export function createTransportClock({ deliver, now = () => Date.now() } = {}) {
  let offset  = null   // ms; serverNow − localNow. null until a ping lands.
  let pending = null   // anchor held back while `offset` is unknown
  let samples = []

  function flush() {
    if (!pending) return
    const state = pending
    pending = null
    deliver?.(state)
  }

  return {
    get offset() { return offset },
    get hasPending() { return pending !== null },

    /**
     * Fold in one completed ping. The first usable sample is adopted straight
     * away — a rough offset beats none, and it releases a held anchor after one
     * round trip instead of a whole burst.
     */
    addSample({ t0, t2, serverNow }) {
      if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return
      const rtt = t2 - t0
      // Server clock at receipt ≈ serverNow + rtt/2 (symmetric-path assumption).
      samples.push({ offset: serverNow + rtt / 2 - t2, rtt })
      if (offset === null) {
        offset = samples[0].offset
        flush()
      }
    },

    /**
     * End of the burst: settle on the lowest-RTT sample, which carries the
     * least queueing noise. Flushes either way — a burst that produced nothing
     * has no better answer coming, and a stranded anchor means a client that
     * never plays.
     */
    settle() {
      if (samples.length) {
        samples.sort((a, b) => a.rtt - b.rtt)
        offset = samples[0].offset
      }
      samples = []
      flush()
    },

    /** Server stamp → our clock; "now" while the offset is unknown. */
    localMsFor(at) {
      if (typeof at !== 'number' || offset === null) return now()
      return at - offset
    },

    /**
     * Take an anchor from the server. Delivered immediately once the clock is
     * known, otherwise held — only the newest is kept, since an older anchor
     * describes the same transport less recently.
     */
    accept(state) {
      if (offset === null) { pending = state; return false }
      deliver?.(state)
      return true
    },

    /** Drop anything held — the room being left is no longer ours to follow. */
    reset() {
      pending = null
      samples = []
    },
  }
}
