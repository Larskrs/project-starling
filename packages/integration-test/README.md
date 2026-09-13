# @starling/integration-test

A terminal client that follows a timeline over the live API and prints a line
the moment it cuts to a **different camera**, timed on its own clock rather than
after the server says so.

It exists for two reasons: to prove the API token flow works end to end against
a running server, and to be a worked example of the shape a real integration
takes. It is built the way [the integration guide](../../docs/integrations)
tells integrators to build one — bootstrap over REST, never trust socket events
alone, re-bootstrap on every reconnect, stop retrying a dead credential, and
time everything against measured server time (see
[clocks and timing](../../docs/integrations/timing.md)).

## Running it

Create a token in the production settings under **Integrations**, then:

```bash
CINO_TOKEN=cino_svc_… CINO_TIMELINE=<timeline-uuid> npm start -w @starling/integration-test
```

`npm start` also reads a `.env` file in this package if there is one (it is
gitignored):

```bash
CINO_TOKEN="cino_svc_…"
CINO_TIMELINE="<timeline-uuid>"
```

Or with flags:

```bash
node packages/integration-test/src/index.ts \
  --token cino_svc_… --timeline <uuid> --url http://localhost:3000
```

`CINO_URL` defaults to `https://cino.no`. Tokens and timelines belong to the
server that issued them, so a token made on a local dev server is rejected by
cino.no (`errors.auth.tokenInvalid`) and the other way round — point `CINO_URL`
at the server you created the token on.

The socket starts on HTTP long-polling and upgrades to WebSocket when the
server allows it. cino.no's proxy does not forward WebSocket upgrades, so there
it stays on polling, which is expected. Clock samples over polling are less
precise, so the `±` on the synced line is larger there.

Output looks like this:

```
14:22:05 clock synced offset +3.2ms, good to ±6.5ms
14:22:07 00:01:12:08  [Programme]  CAM 1 → CAM 2  Cue 14
```

## How it times cuts

The server's `clip:active` is sent once the server's own timer for a clip
boundary fires, so it reaches a client late by that timer plus the network. A
device that has to act *on* the frame cannot wait for it. This client works the
boundary out itself:

1. **It measures the server's clock.** `time:ping` round trips on a monotonic
   clock give an offset that is never wrong by more than half the round trip.
   It pings in a burst on connect, again after the WebSocket upgrade, once every
   15 seconds, and in a burst when the machine looks like it slept. The fastest
   recent sample wins; small corrections glide and big ones jump.
   [`serverClock.ts`](src/serverClock.ts), [`clockSync.ts`](src/clockSync.ts)
2. **It keeps the timeline in memory.** Every track and clip from the bootstrap,
   kept current from `clip:change` and `track:change`, with clip windows
   computed exactly the way the server computes them.
   [`timelineModel.ts`](src/timelineModel.ts)
3. **It schedules the boundary.** Every 20ms it reads the playhead from the
   room's anchor through the clock and finds the next boundary; when that is
   under two ticks away it arms a timer for exactly the time left. Joining
   mid-clip, a seek, an edit, or a boundary the event loop missed are caught on
   the next tick. [`clipScheduler.ts`](src/clipScheduler.ts)

The anchor from `transport:state` is kept exactly as it arrived and read through
the clock every time, so it gets more accurate as the clock estimate improves.

`clip:active` is still received, as an audit. A moment after it lands the client
checks it already agrees and got there first, and prints `out of step:` or
`late cut:` if not. Silence means the timing is working.

If the connection drops mid-show, the client keeps cutting from what it already
knows: the anchor does not go stale and every clip is in memory. The reconnect
re-bootstraps and replaces all of it.

When someone presses **Sync clocks** in the editor, the client runs a fresh ping
burst and reports how good its estimate is (`clock:measure` → `clock:report`).
It shows up in the editor's sync panel as `±` its error in milliseconds, and any
Play pressed meanwhile waits for it. The terminal logs `clock sync requested`
and then what it reported.

## What counts as a cut

The active clip changes far more often than the camera does — a single camera
usually holds several cues in a row. Printing each one buries the thing you are
watching for.

So a line is printed only when the **source** changes on a track:

- a new clip on the same camera is silent
- a gap between clips is silent, and returning to the same camera afterwards is
  not treated as a cut
- tracks are watched independently, so a programme feed and a preview feed each
  get their own line
- a reconnect resets the memory, because the gap was unobserved and whatever is
  live now is news

That logic lives in [`cameraWatch.ts`](src/cameraWatch.ts).

## Tests

All of the timing and cut logic is pure, and tested without a server:

```bash
npm test -w @starling/integration-test
```

or one at a time:

```bash
node packages/integration-test/src/serverClock.test.ts
node packages/integration-test/src/clipScheduler.test.ts
node packages/integration-test/src/cameraWatch.test.ts
```

## What it demonstrates

- Authenticating with `Authorization: Bearer` on REST and `auth: { token }` on
  the Socket.IO handshake.
- Reading `X-Cino-Token-Expires` and warning locally with days to spare, rather
  than discovering expiry as a 401 mid-show.
- Backing off permanently on `errors.auth.*` instead of retrying a credential
  that will not fix itself.
- Handling `access:revoked`, which the server sends when a token is revoked
  while connected.
- Measuring server time with `time:ping` on a monotonic clock, and scheduling
  frame-accurate events from an in-memory timeline instead of reacting late.
