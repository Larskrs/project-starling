# Timeline live-sync from an iOS SwiftUI app

How to connect a SwiftUI app to Starling's `/timeline` Socket.IO namespace: authenticate with the cookie session, join a timeline room, follow the **server-authoritative transport clock**, and send play/pause/seek commands. The server contract is documented in [API.md §8](API.md); this guide is the Swift side of it.

> **Ground rules inherited from the protocol**
> - REST is the source of truth for data. Sockets relay already-persisted clip/track changes and drive the ephemeral transport + presence. Never invent state from socket events alone — bootstrap from `GET /api/timeline/{tlId}` first.
> - The **server owns the transport clock**. The app never streams positions; it sends commands and *derives* the current frame from the server's anchor.
> - A stopped timeline is browsed **privately**. Don't send seek commands while stopped, and ignore a stop state when already stopped.

---

## 1. Dependency

Use the official Socket.IO Swift client (the server runs Socket.IO v4 — the v16 Swift client speaks its protocol):

```
File ▸ Add Package Dependencies…
https://github.com/socketio/socket.io-client-swift   (up to next major from 16.0.0)
```

```swift
import SocketIO
```

## 2. Authentication — the session cookie

The API uses a DB-backed cookie session: `syncsw_sid`, obtained from `POST /api/auth/login`. The socket handshake authenticates with that same cookie (`socketAuth` middleware on the server); there is no token flow.

```swift
struct AuthClient {
    let baseURL = URL(string: "https://cino.no")!

    /// Logs in and returns the session cookie to attach to the socket handshake.
    func login(email: String, password: String) async throws -> HTTPCookie {
        var req = URLRequest(url: baseURL.appending(path: "/api/auth/login"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["email": email, "password": password])

        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.userAuthenticationRequired)
        }
        // URLSession stores Set-Cookie automatically (HttpOnly is a browser-JS
        // restriction — native HTTP stacks see the cookie fine).
        guard let cookie = HTTPCookieStorage.shared.cookies(for: baseURL)?
            .first(where: { $0.name == "syncsw_sid" }) else {
            throw URLError(.cannotParseResponse)
        }
        return cookie
    }
}
```

Notes:

- **Sliding renewal**: authenticated REST responses may re-send the cookie once the session passes half its 24h TTL. `URLSession` updates `HTTPCookieStorage` automatically; read the *current* cookie from storage right before connecting, not a stale copy.
- **Origin**: native clients send no `Origin` header — the server's allowlist explicitly permits that, so no CORS configuration is needed.
- Use the same cookie for all REST calls (`URLSession` does this for you as long as you share the default session).

## 3. Connecting

Path is `/socket`, namespace is `/timeline`:

```swift
final class TimelineSocket {
    private let manager: SocketManager
    let socket: SocketIOClient

    init(cookie: HTTPCookie) {
        manager = SocketManager(
            socketURL: URL(string: "https://cino.no")!,
            config: [
                .path("/socket"),
                .extraHeaders(["Cookie": "\(cookie.name)=\(cookie.value)"]),
                .forceWebSockets(true),   // skip the polling upgrade dance
                .reconnects(true),
                .compress,
            ]
        )
        socket = manager.socket(forNamespace: "/timeline")
    }
}
```

`forceWebSockets(true)` is recommended: the cookie rides the single websocket upgrade request and you avoid long-polling edge cases behind the reverse proxy.

## 4. The wire types

Mirror the TypeScript interfaces from `apps/api/src/lib/timelineSockets.ts`. Socket.IO hands you `[Any]` arrays; decode via `JSONSerialization` → `JSONDecoder` or read dictionaries directly. Codable models:

```swift
/// The room's authoritative transport anchor. `frame` is the position at
/// server time `at` (epoch ms); while playing, the position at server time t
/// is frame + (t − at)/1000 × frameRate.
struct TransportState: Codable {
    let playing: Bool
    let frame: Double
    let frameRate: Double
    let userId: String
    let at: Double
}

struct PresenceUser: Codable, Identifiable {
    let id: String
    let name: String
    let avatarImageId: String?
    let createdAt: String     // ISO-8601
}

enum TransportAction: String { case play, pause, seek }
```

Clip/track change relays are passed through verbatim (the `clip`/`track` payloads are full REST rows) — decode them with the same models you use for `GET /api/timeline/{tlId}`.

Helper to decode a socket payload:

```swift
func decode<T: Decodable>(_ type: T.Type, from any: Any) -> T? {
    guard let data = try? JSONSerialization.data(withJSONObject: any) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
}
```

## 5. Joining a room

One socket follows one timeline at a time; join with an ack and treat a non-`ok` ack as access denied. Rejoin on every (re)connect — the server clears rooms on restart:

```swift
socket.on(clientEvent: .connect) { [weak self] _, _ in
    self?.join()
    self?.syncClock()   // §6 — re-measure on every reconnect
}

func join() {
    socket.emitWithAck("timeline:join", ["timelineId": timelineId])
        .timingOut(after: 5) { [weak self] response in
            guard let first = response.first as? [String: Any], first["ok"] as? Bool == true else {
                self?.state = .accessDenied
                return
            }
            // If the timeline is actively playing, a `transport:state` arrives
            // right after this ack — handled by the normal listener (§7).
        }
}
```

## 6. Clock sync (`time:ping`)

Everything about tight sync rests on knowing the offset between the server clock and the device clock. Same algorithm as the web client: a 5-sample burst, keep the lowest-RTT sample (least queueing noise), `offset = serverNow + rtt/2 − localNow`:

```swift
private(set) var clockOffsetMs: Double?   // serverNow − localNow; nil until measured

private func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

func syncClock(samples: Int = 5) {
    var best: (offset: Double, rtt: Double)?
    func ping(_ remaining: Int) {
        guard remaining > 0 else { clockOffsetMs = best?.offset; return }
        let t0 = nowMs()
        socket.emitWithAck("time:ping").timingOut(after: 2) { [weak self] response in
            guard let self else { return }
            if let serverNow = response.first as? Double {
                let t2  = self.nowMs()
                let rtt = t2 - t0
                let sample = (offset: serverNow + rtt / 2 - t2, rtt: rtt)
                if best == nil || sample.rtt < best!.rtt { best = sample }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { ping(remaining - 1) }
        }
    }
    ping(samples)
}

/// Server stamp (epoch ms) → the same instant on the device clock.
func anchorLocalMs(_ serverAt: Double) -> Double {
    guard let offset = clockOffsetMs else { return nowMs() }   // degrade gracefully
    return serverAt - offset
}
```

## 7. Following the transport — the core loop

The app is a *follower* of the server anchor. Store the latest `TransportState`, convert its stamp to local time once, and derive the playhead every UI frame:

```swift
@MainActor
final class TransportModel: ObservableObject {
    @Published var playing = false
    @Published var playheadFrame: Double = 0

    var timelineEndFrame: Double = 0        // from the REST bootstrap
    private var anchor: (frame: Double, localMs: Double, fps: Double)?

    /// transport:state listener — every accepted command (yours included)
    /// echoes one of these; joiners get one if the timeline is playing.
    func apply(_ state: TransportState, sync: TimelineSocket) {
        if state.playing {
            let localMs   = sync.anchorLocalMs(state.at)
            let predicted = state.frame + (sync.nowMs() - localMs) / 1000 * state.frameRate

            // A run that outlived the timeline (driver vanished) — treat as ended.
            guard predicted < timelineEndFrame else { anchor = nil; playing = false; return }

            anchor  = (state.frame, localMs, state.frameRate)
            playing = true
            playheadFrame = predicted
        } else {
            anchor = nil
            // Private browsing: ignore a stop when we're already stopped.
            guard playing else { return }
            playing = false
            playheadFrame = state.frame   // server-computed stop position
        }
    }

    /// Call once per rendered frame while `playing` (see the view below).
    func tick(sync: TimelineSocket) {
        guard playing, let anchor else { return }
        let predicted = anchor.frame + (sync.nowMs() - anchor.localMs) / 1000 * anchor.fps
        if predicted >= timelineEndFrame {
            playheadFrame = timelineEndFrame
            playing = false
            sync.send(.pause)             // idempotent server-side
            return
        }
        playheadFrame = predicted
    }
}
```

Wire the listener:

```swift
socket.on("transport:state") { [weak self] data, _ in
    guard let self, let payload = data.first,
          let state = decode(TransportState.self, from: payload) else { return }
    Task { @MainActor in self.transport.apply(state, sync: self) }
}
```

Drive `tick` from SwiftUI — `TimelineView(.animation)` re-evaluates every display frame while visible:

```swift
struct PlayheadView: View {
    @ObservedObject var transport: TransportModel
    let sync: TimelineSocket

    var body: some View {
        TimelineView(.animation(paused: !transport.playing)) { context in
            TimecodeLabel(frame: transport.playheadFrame)
                .onChange(of: context.date) { _ in transport.tick(sync: sync) }
        }
    }
}
```

Because the position is *derived* (`anchor + elapsed × fps`) rather than integrated, there is no accumulation error, backgrounding the app costs nothing (recompute on return), and every device shows the same wall-clock-aligned frame as the web clients.

## 8. Sending commands

Three commands, mirroring the client contract:

```swift
extension TimelineSocket {
    enum Command {
        case play(frame: Double)
        case pause
        case seek(frame: Double)
    }

    private static let seekThrottle: TimeInterval = 0.12
    private var seekPending: Double? { get { _seekPending } set { _seekPending = newValue } }

    func send(_ command: Command) {
        switch command {
        case .play(let frame):
            socket.emit("transport:command", ["action": "play", "frame": frame])
        case .pause:
            socket.emit("transport:command", ["action": "pause"])   // server computes the frame
        case .seek(let frame):
            throttleSeek(frame)
        }
    }

    /// Leading + trailing throttle; the trailing send carries the LATEST frame
    /// of a scrub burst. The server additionally drops seeks < 80ms apart.
    private func throttleSeek(_ frame: Double) { /* mirror useTimelineSync.js */ }
}
```

Rules to respect (the server enforces them, but honoring them client-side avoids dropped commands and UX surprises):

- **`play` requires a frame** — your local (private) position becomes the shared one.
- **`seek` only while the shared transport is playing.** Stopped-state seeks are local UI only.
- **`pause` carries no frame** — the server computes the authoritative stop position from its own clock and echoes it back.
- Act **optimistically**: start local playback/seek immediately, then let the echoed `transport:state` take over as the time base. The correction when the echo lands is a couple of frames at most.

## 9. Presence, clip and track relays

```swift
socket.on("timeline:presence") { data, _ in
    let users: [PresenceUser] = decode([PresenceUser].self, from: data.first ?? []) ?? []
    // publish to the UI — includes yourself; deduped per user across devices
}

socket.on("clip:change") { data, _ in
    // { type: "upsert"|"remove", trackId, clip?, clipId? }
    // Apply to your local model the same way the web client does:
    // upsert = merge by id + resort by position; remove = filter out.
}

socket.on("track:change") { data, _ in
    // { type: "upsert"|"remove"|"reorder", track?, trackId?, order? }
    // "reorder": order[i] is the track id whose sortOrder becomes i.
}
```

If the app also *edits*: persist through REST first (`POST/PATCH/DELETE /api/timeline/{tlId}/…`), then emit the same `clip:change`/`track:change` shape with the REST response row. Emitting requires the member to hold `EDIT_TIMELINE` (or `RENAME_CLIPS` for label-only clip upserts) — sockets without the permission are silently dropped, and payloads over 32 KB are discarded.

## 10. `clip:active` — server-computed "now playing" per track

While the transport plays, the server walks the timeline's clip boundaries on its own clock and emits an event whenever the clip under the playhead **changes** on a track — so a lightweight client can show what's playing without holding the clip model at all:

```swift
/// clipId == nil → the track went silent (a length clip ended).
struct ActiveClipEvent: Codable {
    let trackId: String
    let clipId: String?
    let label: String?
    let sourceId: String?   // prefix the source short name, e.g. "K1 - Total shot"
    let frame: Double       // transport frame at emit time
    let at: Double          // server epoch ms — age with anchorLocalMs if needed
}

socket.on("clip:active") { data, _ in
    guard let payload = data.first,
          let event = decode(ActiveClipEvent.self, from: payload) else { return }
    // e.g. update a per-track "now playing" row keyed by event.trackId
}
```

Semantics to rely on:

- Events fire **only while the shared transport is playing** (pause disarms the watcher; a stopped timeline is private anyway).
- You get **changes**, not a stream — plus an initial snapshot of currently active clips right after play starts and right after you join a room that's mid-playback.
- Clip and track edits during playback are handled server-side (the watcher reloads); you don't need to recompute anything.

## 11. Lifecycle checklist

| Moment | Do |
| --- | --- |
| App start | REST login (or reuse stored cookie) → `GET /api/timeline/{tlId}` bootstrap → connect socket |
| `.connect` | `timeline:join` (with ack) + `syncClock()` — both on *every* reconnect |
| Enter background | Nothing required; socket may drop |
| Return to foreground | The client auto-reconnects → rejoin + clock re-sync fire from the `.connect` handler; the join's `transport:state` snaps you to the live position |
| Timeline end reached locally | send `pause` (idempotent — first client wins, the rest are dropped) |
| Leaving the editor screen | `socket.emit("timeline:leave")` then `socket.disconnect()` |

## 12. Pitfalls

- **Don't cache the cookie string** — read `HTTPCookieStorage` before each connect (sliding renewal rotates the expiry, and logout invalidates it server-side immediately).
- **Numbers are `Double`** on the wire (JSON). Frames are fractional by design — only round for display.
- **Permission bitfields are strings** in REST payloads (`role.permissions`) — they're bigints; parse with `UInt64(string)` if you need them, never as JSON numbers.
- **Clock offset before first sync**: `anchorLocalMs` falls back to "now", which degrades to un-compensated behavior — fine for the first second; the anchor check self-corrects once the burst completes.
- The Swift client's `.forceWebSockets(false)` (polling) also works, but every polling request must carry the cookie — websockets keep that surface small.
- Server restarts clear all rooms and transports. The reconnect → rejoin flow recovers everything; design the UI so a brief "reconnecting" state is unremarkable.
