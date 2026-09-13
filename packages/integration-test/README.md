# @starling/integration-test

A terminal client that follows a timeline over the live API and prints a line
the moment it cuts to a **different camera**, timed on its own clock rather than
after the server says so.

It exists for two reasons: to prove the API token flow works end to end against
a running server, and to be a worked example of a real integration. It is built
on [cino-sdk](../cino-sdk), the SDK for the Cino API and live protocol, which handles
everything [the integration guide](../../docs/integrations) asks of a device.
What is left here is what a real device adds on top: deciding what counts as a
cut, and doing something with it.

## Running it

Create a token in the production settings under **Integrations**, then:

```bash
npm run build -w cino-sdk     # the SDK is consumed from its build, like any package
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

The server does not announce clip changes. It sends the anchor, the clips and
every edit, and a device works the boundaries out for itself. cino-sdk does
that: it measures the server's clock, keeps every track and clip in memory, and
emits a `clip` event on the frame a track's live clip changes. This client
listens for those events. See the [cino-sdk README](../cino-sdk/README.md) for
how each part works.

If the process itself stalls — heavy output, CPU load, a paused terminal —
every cut due during it is late, so the client says so rather than leaving it to
look like a clock problem:

```
14:22:08 process stalled 850ms — cuts due during it were late
```

If the connection drops mid-show, the client keeps cutting from what it already
knows. The reconnect fetches the whole timeline again and replaces all of it.

When someone presses **Sync clocks** in the editor, cino-sdk answers with a fresh
measurement. This client prints only what an operator needs from the run:

```
14:21:50 clock sync started by Stage manager
14:21:51 clock reported offset +3.2ms, good to ±6.5ms
14:21:51 play is held until every clock has reported
14:21:52 clock sync done: 3/4 within a frame
14:21:52   Lighting desk: did not answer
```

## What counts as a cut

The live clip changes far more often than the camera does — a single camera
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

```bash
npm test -w @starling/integration-test   # what counts as a cut
npm test -w cino-sdk                      # the REST API, the clock, the timeline, scheduling, the protocol
```

## What it demonstrates

- Following a timeline with an API token through cino-sdk, in a few event
  listeners.
- Warning locally about token expiry with days to spare, rather than discovering
  it as a failure mid-show.
- Stopping permanently on a dead or revoked credential instead of retrying it.
- Cutting on the frame from an in-memory timeline and a measured server clock,
  instead of reacting late to the server.
