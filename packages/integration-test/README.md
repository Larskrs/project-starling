# @starling/integration-test

A terminal client that follows a timeline over the live API and prints a line
whenever it cuts to a **different camera**.

It exists for two reasons: to prove the API token flow works end to end against
a running server, and to be a worked example of the shape a real integration
takes. It is built the way [the integration guide](../../docs/integrations)
tells integrators to build one — bootstrap over REST, never trust socket events
alone, re-bootstrap on every reconnect, and stop retrying a dead credential.

## Running it

Create a token in the production settings under **Integrations**, then:

```bash
CINO_TOKEN=cino_svc_… CINO_TIMELINE=<timeline-uuid> npm start -w @starling/integration-test
```

Or with flags:

```bash
node packages/integration-test/src/index.ts \
  --token cino_svc_… --timeline <uuid> --url http://localhost:3000
```

`CINO_URL` defaults to `http://localhost:3000`.

Output looks like this, one line per cut:

```
14:22:07 00:01:12:08  [Programme]  CAM 1 → CAM 2  Cue 14
```

## What counts as a cut

`clip:active` fires every time the clip under the playhead changes, which is far
more often than the camera does — a single camera usually holds several cues in
a row. Printing each one buries the thing you are watching for.

So a line is printed only when the **source** changes on a track:

- a new clip on the same camera is silent
- a gap between clips is silent, and returning to the same camera afterwards is
  not treated as a cut
- tracks are watched independently, so a programme feed and a preview feed each
  get their own line
- a reconnect resets the memory, because the gap was unobserved and whatever is
  live now is news

That logic is pure and lives in [`cameraWatch.ts`](src/cameraWatch.ts), with
tests:

```bash
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
