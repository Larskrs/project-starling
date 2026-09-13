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

The API uses a DB-backed cookie session: `syncsw_sid`, obtained from `POST /api/auth/login`. The socket handshake authenticates with that same cookie (`socketAuth` middleware on the server).

> **This is the right flow only when a person logs in.** The app below collects a real user's email and password, acts as that user, and inherits their access everywhere. Do not use it for installed equipment — a lighting desk, a playback machine, a status display. Those authenticate with a scoped, revocable API token instead; see [the integration guide](./integrations/index.md). A session is also the wrong shape for unattended kit: it expires in 24 hours, which means storing the password on the device to renew it.

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
                .reconnects(true),
                .compress,
            ]
        )
        socket = manager.socket(forNamespace: "/timeline")
    }
}
```

Leave `forceWebSockets` off. The client then starts on long-polling and upgrades to WebSocket when the network allows it. cino.no's reverse proxy does **not** forward WebSocket upgrades, so a websocket-only client never connects there; against a server that does forward them, the upgrade happens on its own. Every polling request carries the `Cookie` header from `extraHeaders`.

## 4. The wire types

Mirror the TypeScript declarations in `packages/realtime/src/index.ts` — the one wire contract the API and the web client both compile against. Socket.IO hands you `[Any]` arrays; decode via `JSONSerialization` → `JSONDecoder` or read dictionaries directly. Codable models:

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
    self?.burst()       // §6 — re-measure on every reconnect
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

Everything about tight sync rests on knowing what time it is **on the server**. `time:ping` acks the server's clock in milliseconds. That clock is monotonic: its readings look like epoch ms, but they are not wall-clock time, so never compare them with `Date()`.

The device side must be monotonic too. `Date()` is the wall clock, and iOS corrects it against network time whenever it likes. Each correction moves your side of the offset without moving the server's, and the playhead moves with it. `CACurrentMediaTime()` only counts forward. It does stop while the device sleeps, which is why the app re-measures on returning to the foreground.

The algorithm and constants are the same as the web client's and as [integrations/timing.md](integrations/timing.md), which explains each one:

- A sample's offset is `serverNow + rtt/2 − t2`, and its error is at most `rtt/2`. Keep the **lowest-RTT** sample from the last 2 minutes (at most 24), never an average.
- A new sample that disagrees with an older one by more than `(rttA + rttB)/2 + 10ms` means a clock jumped. Drop the older samples.
- When the estimate moves by more than 40ms, apply it at once. Otherwise glide towards it at no more than 5ms per second.
- Ping 5 times, 120ms apart, on every connect and on returning to the foreground, then once every 15 seconds.

```swift
import QuartzCore

/// The server's clock, estimated. Use from the socket's handle queue (main by default).
final class ServerClock {
    private struct Sample { let offset: Double; let rtt: Double; let at: Double }

    private var samples: [Sample] = []
    private var target: Double?           // nil until the first ping answers
    private var from = 0.0, since = 0.0   // the applied offset glides from `from` towards `target`

    static func localNow() -> Double { CACurrentMediaTime() * 1000 }

    var synced: Bool { target != nil }

    /// Round trip of the best sample the estimate rests on; the offset is good to
    /// half this. What the app reports when the editor asks for a clock sync (§6.1).
    var bestRtt: Double? { samples.map(\.rtt).min() }

    /// The server's clock right now; nil until synced — never a guess.
    func now() -> Double? {
        let t = Self.localNow()
        guard let offset = offset(at: t) else { return nil }
        return t + offset
    }

    private func offset(at t: Double) -> Double? {
        guard let target else { return nil }
        let room = 5 * max(0, t - since) / 1000
        return from + max(-room, min(room, target - from))
    }

    func add(t0: Double, t2: Double, serverNow: Double) {
        let rtt = t2 - t0
        guard rtt >= 0 else { return }
        let sample = Sample(offset: serverNow + rtt / 2 - t2, rtt: rtt, at: t2)

        let fresh = samples.filter { sample.at - $0.at <= 120_000 }
        let agree = fresh.filter { abs($0.offset - sample.offset) <= ($0.rtt + sample.rtt) / 2 + 10 }
        samples = Array((agree + [sample]).suffix(24))

        let best    = samples.min { $0.rtt < $1.rtt }!
        let t       = Self.localNow()
        let jumped  = agree.count < fresh.count
        if let current = offset(at: t), !jumped, abs(best.offset - current) <= 40 {
            from = current
        } else {
            from = best.offset
        }
        since  = t
        target = best.offset
    }
}
```

Pinging, in `TimelineSocket`:

```swift
import UIKit

let clock = ServerClock()
private var bursting = false

private func ping(then next: (() -> Void)? = nil) {
    let t0 = ServerClock.localNow()
    socket.emitWithAck("time:ping").timingOut(after: 2) { [weak self] response in
        guard let self else { return }
        // A timed-out ack arrives as ["NO ACK"] and is simply not a sample.
        if let serverNow = response.first as? Double {
            self.clock.add(t0: t0, t2: ServerClock.localNow(), serverNow: serverNow)
        }
        next?()
    }
}

private var burstWaiters: [() -> Void] = []
private var rerun = false

/// Five pings, 120ms apart. On every connect, on returning to the foreground,
/// and when the editor asks (§6.1). `done` runs after a burst that STARTED after
/// the call: one already under way began before the request, so a fresh one follows.
func burst(then done: (() -> Void)? = nil) {
    if let done {
        burstWaiters.append(done)
        if bursting { rerun = true }
    }
    guard !bursting else { return }
    bursting = true
    step(5)
}

private func step(_ remaining: Int) {
    guard remaining > 0, socket.status == .connected else {
        bursting = false
        if rerun, socket.status == .connected { rerun = false; burst(); return }
        rerun = false
        let waiters = burstWaiters
        burstWaiters = []
        waiters.forEach { $0() }
        return
    }
    ping { [weak self] in
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { self?.step(remaining - 1) }
    }
}

/// Call once, after creating the socket.
func startClockSync() {
    Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
        guard let self, !self.bursting, self.socket.status == .connected else { return }
        self.ping()
    }
    NotificationCenter.default.addObserver(
        forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
        self?.burst()
    }
}
```

### 6.1 Syncing on request (`clock:measure`)

Before a show, an operator presses **Sync clocks** in the editor. Every client in the room is asked to re-measure and report, and the server **holds any Play** until each one has answered or 4 seconds have passed. Answer with a fresh burst and the round trip your estimate rests on:

```swift
socket.on("clock:measure") { [weak self] data, _ in
    guard let self,
          let request = data.first as? [String: Any],
          let requestId = request["requestId"] as? String else { return }
    self.burst { [weak self] in
        guard let self else { return }
        // nil → NSNull: tells the operator this device has no server time.
        let rtt: Any = self.clock.bestRtt ?? NSNull()
        self.socket.emit("clock:report", ["requestId": requestId, "rtt": rtt])
    }
}
```

The app shows up in the editor's sync panel as `±` half that round trip. Anything looser than one frame is flagged, and an app that never answers is listed as *did not answer*. A held Play reaches you as an ordinary `transport:state` once the run ends, so §7 needs no changes.

## 7. Following the transport — the core loop

The app is a *follower* of the server anchor. Store the latest `TransportState` **exactly as it arrived**, and derive the playhead every UI frame by reading its `at` through the clock from §6. Never convert `at` to local time once and store that: the clock estimate keeps improving, and a stored conversion freezes whatever error it had when the anchor landed — for a device joining mid-playback, the worst estimate of the session.

```swift
@MainActor
final class TransportModel: ObservableObject {
    @Published var playing = false
    @Published var playheadFrame: Double = 0

    var timelineEndFrame: Double = 0        // from the REST bootstrap
    /// The anchor as the server sent it; `at` is server time and stays that way.
    private var anchor: TransportState?

    /// transport:state listener — every accepted command (yours included)
    /// echoes one of these; joiners get one if the timeline is playing.
    func apply(_ state: TransportState, sync: TimelineSocket) {
        if state.playing {
            anchor  = state
            playing = true
            tick(sync: sync)
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
        // No server time yet — a join's anchor usually beats the first ping.
        // Hold still rather than guess; the first frame after it lands is right.
        guard playing, let anchor, let serverNow = sync.clock.now() else { return }
        let predicted = anchor.frame + (serverNow - anchor.at) / 1000 * anchor.frameRate
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

If the app also *edits*: persist through REST (`POST/PATCH/DELETE /api/timeline/{tlId}/…`) and **do not emit anything**. The route relays the change to the room itself the moment the row is written, usually before your HTTP response arrives. Send your socket id as `x-socket-id` on those requests so the relay skips you:

```swift
req.setValue(socket.sid, forHTTPHeaderField: "x-socket-id")
```

Without the header your own change comes back as a `clip:change`, which is harmless (every payload is an idempotent upsert or delete) but will fight optimistic UI. Emitting `clip:change`/`track:change` from the client is still accepted for older clients, gated on `EDIT_TIMELINE` (or `RENAME_CLIPS` for label-only upserts) with a 32 KB cap — but doing it as well as the REST write makes every peer apply the change twice.

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
    let at: Double          // server clock ms — compare only with clock.now(), never Date()
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
| Socket created | `startClockSync()` once — the 15s ping and the foreground observer (§6) |
| `.connect` | `timeline:join` (with ack) + `burst()` — both on *every* reconnect |
| Enter background | Nothing required; socket may drop, and `CACurrentMediaTime()` stops while the device sleeps |
| Return to foreground | `burst()` fires from the foreground observer, which catches the time the clock stood still; the client auto-reconnects → rejoin, and the join's `transport:state` snaps you to the live position |
| Timeline end reached locally | send `pause` (idempotent — first client wins, the rest are dropped) |
| Leaving the editor screen | `socket.emit("timeline:leave")` then `socket.disconnect()` |

## 12. Pitfalls

- **Don't cache the cookie string** — read `HTTPCookieStorage` before each connect (sliding renewal rotates the expiry, and logout invalidates it server-side immediately).
- **Numbers are `Double`** on the wire (JSON). Frames are fractional by design — only round for display.
- **Permission bitfields are strings** in REST payloads (`role.permissions`) — they're bigints; parse with `UInt64(string)` if you need them, never as JSON numbers.
- **No playhead before the first ping answers.** `clock.now()` is nil until then, and `tick` holds still rather than guessing. That is usually well under a second after connecting; if it never answers, show it rather than falling back to `Date()`.
- **Never store `at` converted to local time.** Keep the anchor as sent and read it through `clock.now()` every frame (§7).
- **Never time anything with `Date()`.** It is the wall clock and iOS steps it. Use `CACurrentMediaTime()`, and only compare server stamps (`at`, `time:ping`) with `clock.now()`.
- **Don't force WebSockets.** Behind a proxy that does not forward the upgrade (cino.no), long-polling is the only transport that connects. Every polling request carries the cookie from `extraHeaders`.
- Server restarts clear all rooms and transports. The reconnect → rejoin flow recovers everything; design the UI so a brief "reconnecting" state is unremarkable.
