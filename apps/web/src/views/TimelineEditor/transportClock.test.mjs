/**
 * Regression guard for the transport clock.
 *
 *     node apps/web/src/views/TimelineEditor/transportClock.test.mjs
 *
 * (Standalone, same convention as useAudioEngine.test.mjs — the repo has no
 * test runner, and this module is deliberately Vue-free so it runs in bare
 * node. Exits non-zero on failure. Pass an alternative module path as argv[2].)
 *
 * The behaviour worth pinning down is what happens to an anchor that arrives
 * before the clock offset is known. The server answers `timeline:join` with the
 * room's anchor immediately, so on a room that is already playing that reply
 * routinely beats the client's own ping burst. Read with no offset, the
 * anchor's server stamp is taken for "now", its age comes out as zero, and the
 * joiner starts at the frame playback STARTED on rather than where the room
 * actually is — permanently, because nobody re-sends the anchor.
 */

const modulePath = process.argv[2] ?? './transportClock.js'
const { createTransportClock } = await import(modulePath)

let failures = 0

function check(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures++
    console.error(`FAIL  ${name}\n      ${err.message}`)
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function assertClose(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ≈${expected}, got ${actual}`)
  }
}

// A room playing at 25fps: play was pressed on frame 100, two minutes ago.
// The server's clock runs 30s ahead of ours, to prove the offset is what maps
// between them rather than any assumption that the two agree.
const FPS          = 25
const SERVER_SKEW  = 30_000
const LOCAL_NOW    = 1_000_000
const PLAY_LOCAL   = LOCAL_NOW - 120_000            // two minutes of playback
const ANCHOR       = { playing: true, frame: 100, frameRate: FPS, at: PLAY_LOCAL + SERVER_SKEW }
const EXPECTED     = 100 + (120_000 / 1000) * FPS   // 3100

/** What a client would put the playhead at, given a delivered anchor. */
const positionFrom = (state, now = LOCAL_NOW) =>
  state.frame + ((now - state.anchorLocalMs) / 1000) * state.frameRate

/**
 * One ping round trip, `rtt` ms long, against a server skewed by SERVER_SKEW.
 *
 * `outbound` is how much of the trip was spent on the way there. The estimator
 * assumes half, so a symmetric trip yields the skew exactly and an asymmetric
 * one is off by `outbound − rtt/2` — which is the error a long, queued ping
 * carries, and the reason the burst prefers the fastest sample.
 */
const pingAt = (localSendTime, rtt, outbound = rtt / 2) => ({
  t0:        localSendTime,
  t2:        localSendTime + rtt,
  serverNow: localSendTime + outbound + SERVER_SKEW,
})

check('an anchor arriving before the clock is measured is held, not guessed at', () => {
  const delivered = []
  const clock = createTransportClock({ deliver: s => delivered.push(s), now: () => LOCAL_NOW })

  const accepted = clock.accept(ANCHOR)

  assert(accepted === false, 'accept() reported delivery with no offset measured')
  assert(delivered.length === 0, `anchor was delivered early (${delivered.length} deliveries)`)
  assert(clock.hasPending, 'anchor was dropped rather than held')
})

check('the first ping releases it at the room\'s real position', () => {
  const delivered = []
  const clock = createTransportClock({ deliver: s => delivered.push(s), now: () => LOCAL_NOW })

  clock.accept(ANCHOR)
  clock.addSample(pingAt(LOCAL_NOW - 40, 40))

  assert(delivered.length === 1, `expected one delivery, got ${delivered.length}`)
  // The whole point: two minutes in, not back at the frame play started on.
  assertClose(positionFrom(delivered[0]), EXPECTED, 1, 'joiner landed at the wrong frame')
  assert(!clock.hasPending, 'anchor stayed queued after delivery')
})

check('reading it with no offset would have stranded the joiner (the bug)', () => {
  const clock = createTransportClock({ deliver: () => {}, now: () => LOCAL_NOW })
  // localMsFor falls back to "now" while unmeasured — the anchor reads as if it
  // were stamped this instant, which is exactly how the frame was lost.
  const naive = { ...ANCHOR, anchorLocalMs: clock.localMsFor(ANCHOR.at) }
  assertClose(positionFrom(naive), ANCHOR.frame, 1, 'fallback no longer collapses the anchor age')
  assert(EXPECTED - ANCHOR.frame === 3000, 'fixture no longer represents a meaningful drift')
})

check('a burst that never answers still lets the client play', () => {
  const delivered = []
  const clock = createTransportClock({ deliver: s => delivered.push(s), now: () => LOCAL_NOW })

  clock.accept(ANCHOR)
  clock.settle()   // every ping timed out; no samples at all

  assert(delivered.length === 1, 'a failed clock burst stranded the anchor')
})

check('the burst settles on the lowest-RTT sample', () => {
  const clock = createTransportClock({ deliver: () => {}, now: () => LOCAL_NOW })

  clock.addSample(pingAt(LOCAL_NOW - 400, 400, 360))   // queued on the way out
  const provisional = clock.offset
  clock.addSample(pingAt(LOCAL_NOW - 20, 20))         // clean, symmetric
  clock.settle()

  assertClose(clock.offset, SERVER_SKEW, 1, 'settled offset ignored the cleaner sample')
  assert(Math.abs(provisional - SERVER_SKEW) > Math.abs(clock.offset - SERVER_SKEW),
    'the provisional sample was already as good as the settled one — fixture is not exercising the sort')
})

check('once measured, later anchors go straight through', () => {
  const delivered = []
  const clock = createTransportClock({ deliver: s => delivered.push(s), now: () => LOCAL_NOW })

  clock.addSample(pingAt(LOCAL_NOW - 30, 30))
  const accepted = clock.accept(ANCHOR)

  assert(accepted === true, 'accept() queued an anchor despite a known offset')
  assert(delivered.length === 1, `expected one delivery, got ${delivered.length}`)
  assertClose(positionFrom(delivered[0]), EXPECTED, 1, 'delivered anchor was misplaced')
})

check('only the newest held anchor survives', () => {
  const delivered = []
  const clock = createTransportClock({ deliver: s => delivered.push(s), now: () => LOCAL_NOW })

  clock.accept({ ...ANCHOR, frame: 1 })
  clock.accept({ ...ANCHOR, frame: 2 })
  clock.addSample(pingAt(LOCAL_NOW - 30, 30))

  assert(delivered.length === 1, `stale anchor was replayed (${delivered.length} deliveries)`)
  assert(delivered[0].frame === 2, `expected the newest anchor, got frame ${delivered[0].frame}`)
})

check('reset drops a held anchor from a room we have left', () => {
  const delivered = []
  const clock = createTransportClock({ deliver: s => delivered.push(s), now: () => LOCAL_NOW })

  clock.accept(ANCHOR)
  clock.reset()
  clock.addSample(pingAt(LOCAL_NOW - 30, 30))

  assert(delivered.length === 0, 'an anchor from a left room was applied')
})

if (failures) {
  console.error(`\n${failures} failing`)
  process.exit(1)
}
console.log('\nall passing')
