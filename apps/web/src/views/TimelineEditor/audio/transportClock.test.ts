/**
 * Regression guard for the transport clock.
 *
 *     node apps/web/src/views/TimelineEditor/audio/transportClock.test.ts
 *
 * (Standalone, same convention as useAudioEngine.test.ts — the repo has no
 * test runner, and this module is deliberately Vue-free so it runs in bare
 * node. Exits non-zero on failure. Pass an alternative module path as argv[2].)
 *
 * Two failures are worth pinning down, both about joining a room that is
 * already playing. The server answers `timeline:join` with the room's anchor
 * immediately, so that reply routinely beats the client's first ping:
 *
 * - Read with NO offset, the anchor's server stamp is compared against our own
 *   unrelated clock and the joiner lands wherever the two clocks' difference
 *   puts it.
 * - Converted to local time ONCE, on the first ping, the anchor keeps that
 *   ping's error until someone presses play again, however much better the
 *   estimate gets afterwards.
 *
 * The rest covers keeping the estimate right through a long session: gliding
 * through small corrections, jumping on real clock discontinuities, and
 * forgetting samples too old to trust.
 */

const modulePath = process.argv[2] ?? './transportClock.ts'
const { createTransportClock } = await import(modulePath) as
  typeof import('./transportClock.ts')

type Anchor = { frame: number; at: number; playing: boolean; frameRate: number }

let failures = 0

function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures++
    console.error(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`)
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
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
const EXPECTED     = 100 + (120_000 / 1000) * FPS   // 3100, at LOCAL_NOW

/** A local clock the test moves by hand. */
function fakeTime(start = LOCAL_NOW) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

/** What a client puts the playhead at: the anchor, read through the clock NOW. */
const positionFrom = (state: Anchor, serverNow: number) =>
  state.frame + ((serverNow - state.at) / 1000) * state.frameRate

/**
 * One ping round trip, `rtt` ms long, against a server `skew` ms ahead.
 *
 * `outbound` is how much of the trip was spent on the way there. The estimator
 * assumes half, so a symmetric trip yields the skew exactly and an asymmetric
 * one is off by `outbound − rtt/2` — which is the error a long, queued ping
 * carries, and the reason the fastest sample wins.
 */
const pingAt = (localSendTime: number, rtt: number, outbound = rtt / 2, skew = SERVER_SKEW) => ({
  t0:        localSendTime,
  t2:        localSendTime + rtt,
  serverNow: localSendTime + outbound + skew,
})

function clockWithLog() {
  const delivered: Anchor[] = []
  const time  = fakeTime()
  const clock = createTransportClock({ deliver: s => delivered.push(s as Anchor), now: time.now })
  return { clock, delivered, time }
}

check('an anchor arriving before the clock is measured is held, not guessed at', () => {
  const { clock, delivered } = clockWithLog()

  const accepted = clock.accept(ANCHOR)

  assert(accepted === false, 'accept() reported delivery with no offset measured')
  assert(delivered.length === 0, `anchor was delivered early (${delivered.length} deliveries)`)
  assert(clock.hasPending, 'anchor was dropped rather than held')
})

check('the first ping releases it at the room\'s real position', () => {
  const { clock, delivered } = clockWithLog()

  clock.accept(ANCHOR)
  clock.addSample(pingAt(LOCAL_NOW - 40, 40))

  assert(delivered.length === 1, `expected one delivery, got ${delivered.length}`)
  // The whole point: two minutes in, not back at the frame play started on.
  assertClose(positionFrom(delivered[0], clock.serverNow()), EXPECTED, 1, 'joiner landed at the wrong frame')
  assert(!clock.hasPending, 'anchor stayed queued after delivery')
})

check('reading it with no offset would misplace the joiner by the whole skew (why it is held)', () => {
  const { clock } = clockWithLog()
  // serverNow() falls back to our own clock while unmeasured.
  const naive = positionFrom(ANCHOR, clock.serverNow())
  assertClose(Math.abs(naive - EXPECTED), (SERVER_SKEW / 1000) * FPS, 1, 'fallback no longer shows the skew')
})

check('a joiner tightens up as the estimate improves, instead of keeping the first ping\'s error', () => {
  const { clock, delivered } = clockWithLog()

  clock.accept(ANCHOR)
  // First answer: a lopsided long-polling trip, 160ms (4 frames) off.
  clock.addSample(pingAt(LOCAL_NOW - 400, 400, 360))
  assert(delivered.length === 1, 'the first sample did not release the anchor')
  // What converting `at` to local time on delivery used to freeze in.
  const frozenLocalMs = ANCHOR.at - clock.offset!

  // Then a clean websocket trip.
  clock.addSample(pingAt(LOCAL_NOW - 20, 20))
  clock.settle()

  const read   = positionFrom(delivered[0], clock.serverNow())
  const frozen = ANCHOR.frame + ((LOCAL_NOW - frozenLocalMs) / 1000) * FPS
  assertClose(read, EXPECTED, 0.1, 'the anchor did not follow the better estimate')
  assert(Math.abs(frozen - EXPECTED) > 3.5,
    `fixture no longer shows the frozen error (${(frozen - EXPECTED).toFixed(2)} frames)`)
  assert(delivered.length === 1, 'the anchor was re-delivered — reading at use time should make that unnecessary')
})

check('a burst that never answers still lets the client play', () => {
  const { clock, delivered } = clockWithLog()

  clock.accept(ANCHOR)
  clock.settle()   // every ping timed out; no samples at all

  assert(delivered.length === 1, 'a failed clock burst stranded the anchor')
})

check('the lowest-RTT sample wins', () => {
  const { clock } = clockWithLog()

  clock.addSample(pingAt(LOCAL_NOW - 400, 400, 360))   // queued on the way out
  const provisional = clock.offset
  clock.addSample(pingAt(LOCAL_NOW - 20, 20))         // clean, symmetric
  clock.addSample(pingAt(LOCAL_NOW - 90, 90, 80))     // later, but slower

  assert(provisional !== null, 'first sample was not adopted as a provisional offset')
  assert(clock.offset !== null, 'the offset is unmeasured after three samples')
  assertClose(clock.offset, SERVER_SKEW, 1, 'offset ignored the cleanest sample')
  assert(Math.abs(provisional - SERVER_SKEW) > Math.abs(clock.offset - SERVER_SKEW),
    'the provisional sample was already as good as the best one — fixture is not exercising the choice')
})

check('a small correction glides rather than jumping', () => {
  const { clock, time } = clockWithLog()

  clock.addSample(pingAt(LOCAL_NOW - 30, 30, 5, SERVER_SKEW + 10))    // lopsided: reads SKEW
  assertClose(clock.offset!, SERVER_SKEW, 0.01, 'fixture: first sample should read the skew')

  time.advance(1000)
  clock.addSample(pingAt(time.now() - 10, 10, 5, SERVER_SKEW + 10))   // clean: reads SKEW + 10
  assertClose(clock.offset!, SERVER_SKEW, 0.01, 'a 10ms correction was applied as a jump')

  time.advance(1000)
  assertClose(clock.offset!, SERVER_SKEW + 5, 0.01, 'the glide is not running at 5ms per second')

  time.advance(5000)
  assertClose(clock.offset!, SERVER_SKEW + 10, 0.01, 'the glide overshot or never arrived')
})

check('a large correction is adopted at once', () => {
  const { clock } = clockWithLog()

  clock.addSample(pingAt(LOCAL_NOW - 400, 400, 360))   // 160ms off
  clock.addSample(pingAt(LOCAL_NOW - 20, 20))

  assertClose(clock.offset!, SERVER_SKEW, 0.01, 'a 160ms correction was glided instead of stepped')
})

check('a clock that jumped outvotes older samples with better round trips', () => {
  const { clock, time } = clockWithLog()

  clock.addSample(pingAt(LOCAL_NOW - 10, 10))
  // Our monotonic clock stood still for 5s while the machine slept, so the
  // server is now 5s further ahead than it was. The new sample is slower, and
  // would lose to the old one on round trip alone.
  time.advance(1000)
  clock.addSample(pingAt(time.now() - 80, 80, 40, SERVER_SKEW + 5000))

  assertClose(clock.offset!, SERVER_SKEW + 5000, 0.01, 'a stale sample outvoted a clock jump')
})

check('samples too old to trust age out', () => {
  const { clock, time } = clockWithLog()

  clock.addSample(pingAt(LOCAL_NOW - 5, 5))            // excellent, but about to be stale
  time.advance(121_000)
  // Consistent with the old sample, so only its age can remove it.
  clock.addSample(pingAt(time.now() - 50, 50, 25, SERVER_SKEW + 20))
  time.advance(5000)

  assertClose(clock.offset!, SERVER_SKEW + 20, 0.01, 'a two-minute-old sample still decided the offset')
})

check('once measured, later anchors go straight through', () => {
  const { clock, delivered } = clockWithLog()

  clock.addSample(pingAt(LOCAL_NOW - 30, 30))
  const accepted = clock.accept(ANCHOR)

  assert(accepted === true, 'accept() queued an anchor despite a known offset')
  assert(delivered.length === 1, `expected one delivery, got ${delivered.length}`)
  assertClose(positionFrom(delivered[0], clock.serverNow()), EXPECTED, 1, 'delivered anchor was misplaced')
})

check('only the newest held anchor survives', () => {
  const { clock, delivered } = clockWithLog()

  clock.accept({ ...ANCHOR, frame: 1 })
  clock.accept({ ...ANCHOR, frame: 2 })
  clock.addSample(pingAt(LOCAL_NOW - 30, 30))

  assert(delivered.length === 1, `stale anchor was replayed (${delivered.length} deliveries)`)
  assert(delivered[0].frame === 2, `expected the newest anchor, got frame ${delivered[0].frame}`)
})

check('reset drops a held anchor from a room we have left', () => {
  const { clock, delivered } = clockWithLog()

  clock.accept(ANCHOR)
  clock.reset()
  clock.addSample(pingAt(LOCAL_NOW - 30, 30))

  assert(delivered.length === 0, 'an anchor from a left room was applied')
})

check('reset keeps the offset, so a rejoin is not gated', () => {
  const { clock, delivered } = clockWithLog()

  clock.addSample(pingAt(LOCAL_NOW - 30, 30))
  clock.reset()

  assert(clock.accept(ANCHOR) === true, 'a rejoin anchor was held despite a known offset')
  assert(delivered.length === 1, 'the rejoin anchor was not delivered')
})

check('rtt reports the best round trip the estimate rests on', () => {
  const { clock } = clockWithLog()
  assert(clock.rtt === null, `rtt before any sample: ${clock.rtt}`)
  clock.addSample(pingAt(LOCAL_NOW - 90, 90))
  clock.addSample(pingAt(LOCAL_NOW - 30, 30))
  assert(clock.rtt === 30, `expected the 30ms sample, got ${clock.rtt}`)
})

if (failures) {
  console.error(`\n${failures} failing`)
  process.exit(1)
}
console.log('\nall passing')

// Top-level await + isolated scope: this makes the script a module rather
// than a global script sharing names with its siblings.
export {}
