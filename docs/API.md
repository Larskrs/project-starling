# Starling API Reference — REST & Sockets

How `apps/api` works, end to end: the HTTP server, the file-based router, the request toolkit, authentication and the permission model, every REST route, the storage subsystem, and both Socket.IO namespaces. Written for someone adding features to the API or consuming it from the web app.

- Runtime: plain Node `http` server (no framework), TypeScript ESM, built with `tsc` to `dist/`
- Data: PostgreSQL via Drizzle ORM (`@starling/db` re-exports `db` + the whole schema)
- Validation: Zod (v4 — note `z.uuid()` / `z.json()` top-level helpers are available)
- Realtime: Socket.IO attached to the same HTTP server
- Static: serves the built web app under `/app`; uploaded files live on local disk under `storage/`

```
apps/api/src/
├─ index.ts            server entry: CORS, /health, /app static, /api dispatch, error envelope
├─ router.ts           file-convention router: load, score, match
├─ lib/
│  ├─ handler.ts       ApiEvent, ApiError, auth guards, body/query/multipart readers
│  ├─ session.ts       cookie sessions (DB-backed)
│  ├─ auth.ts          password hashing/verification
│  ├─ permissions.ts   can() — permission bit check
│  ├─ production.ts    company/production resolution + access + permission guards
│  ├─ storage.ts       disk layout, sharp image pipeline, audio writes
│  ├─ sockets.ts       Socket.IO server, shared auth middleware, chat namespace
│  └─ timelineSockets.ts  /timeline namespace: rooms, presence, relays, playhead
└─ routes/             one file per endpoint (see Routing)
```

---

## 1. Server lifecycle (`index.ts`)

One `createServer` callback handles everything, in this order:

1. **Origin policy + security headers** (`lib/security.ts`) — every response gets `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Vary: Origin`. Cross-site requests are checked against an allowlist: no `Origin` header (same-origin/CLI), an origin whose host equals the request's `Host`, localhost, or an entry in the `CORS_ORIGINS` env var (comma-separated full origins). Allowed origins get credentialed CORS headers; **disallowed origins are refused with `403` before any handler runs** (origins are never reflected blindly alongside `Allow-Credentials`). `OPTIONS` preflights short-circuit with `204`.
2. **`/health`** → `{ "status": "ok" }`.
3. **`/app` and `/app/*`** — static hosting of the built web app (`apps/web/dist`). Paths with a file extension are served as assets (`/assets/*` get `Cache-Control: public, max-age=31536000, immutable`); everything else falls back to `index.html` (SPA routing) with `no-cache`. If the web app isn't built, non-asset requests return `503` with a hint.
4. **`/api/*`** — matched against the route table (below). No match → `404 { error, path }`.
5. Anything else → `404`.

Socket.IO is attached to the same server via `setupSockets(server)` (see §8), and the port comes from `PORT` (default 3000). At boot the server prints a route tree of all loaded endpoints.

### Response envelope

A route handler returns a plain value; the server serializes it:

| Handler outcome | Response |
| --- | --- |
| returns object/array | `200` JSON (or the status the handler set on `res` if ≠200) |
| returns `undefined`/`null` | `204` no content |
| wrote to `res` itself and ended it (e.g. file streaming) | passed through untouched |
| throws `ApiError` | its status + `{ error, errorKey?, data? }` |
| throws anything else | `500 { error: "Internal Server Error", errorKey: "errors.generic.systemError" }` (logged) |

`errorKey` is an i18n key the web app resolves (e.g. `errors.company.notFound`); `data` carries structured extras (validation details, `missingPermission`, …).

---

## 2. Routing (`router.ts`)

Nuxt/Nitro-style file conventions under `src/routes`. The filename encodes the method; the directory path encodes the URL:

| File | Route |
| --- | --- |
| `users/index.get.ts` | `GET /api/users` |
| `users/create.post.ts` | `POST /api/users/create` |
| `users/[id].get.ts` | `GET /api/users/:id` |
| `files/[...path].get.ts` | `GET /api/files/*` (catch-all) |

- Methods: `get post put patch delete head options`, case-insensitive, `.ts/.js/.mjs`.
- `[name]` → route param, available as `event.params.name` / `getRouterParam(event, 'name')`.
- `[...name]` → catch-all (joins remaining segments).
- Routes are **scored and sorted once at load**: static segments beat params beat catch-alls, so `/api/storage/upload` wins over `/api/storage/[id]`.
- Each route file **default-exports** `defineEventHandler(async (event) => …)` and may export `meta = defineApiMeta({...})` (summary/tags/schemas — used for documentation, not enforced at runtime).

`matchRoute` strips the `/api` prefix, splits segments, and returns the first (highest-scored) route whose segments match, plus the extracted params.

---

## 3. Request toolkit (`lib/handler.ts`)

`ApiEvent` is the only context object: `{ req, res, method, url: URL, params }`.

**Errors** — `throw createError({ statusCode, message, data?, errorKey? })` (or `new ApiError(...)`). Never write error JSON manually.

**Auth guards** (cookie-session based, see §4):

| Helper | Behavior |
| --- | --- |
| `getAuth(event)` | `{ userId, role } \| null` |
| `requireAuth(event)` | same or throws `401` (`errors.generic.authRequired`) |
| `requireAdmin(event)` | requires global `role === 'admin'` or throws `403` |

**Body / query**:

- `readRawBody(event, maxBytes)` — buffers the body up to a cap; beyond it the client gets `413` (`errors.generic.payloadTooLarge`) and the connection closes. **All body readers go through this** — JSON bodies cap at 1 MB, multipart defaults to 64 MB (the storage upload route raises its own cap to 200 MB).
- `readBody(event)` — raw JSON (`400 errors.generic.invalidBody` on parse failure, `undefined` on empty body).
- `readValidatedBody(event, zodSchema)` — parse + validate; failure → `422` with `data` = Zod `flatten()` and `errorKey: errors.generic.validationFailed`.
- `getQuery` / `getValidatedQuery(event, schema)` — query-string equivalents (`422` on failure).
- `pickDefined(obj)` — drops `undefined` keys; the standard way to turn an all-optional PATCH body into a Drizzle `set()` object.
- `readMultipart(event, { maxBytes? })` — dependency-free `multipart/form-data` parser → `{ fields: Record<string,string>, files: Record<string,{ filename, mimeType, data: Buffer }> }`.

**Cross-cutting utilities** — `lib/rateLimit.ts` (`createRateLimiter({ windowMs, max }).check(key)`, sliding window, in-memory), `lib/cache.ts` (`TtlCache` with size cap), `lib/security.ts` (`isOriginAllowed`, `applyCors`, `applySecurityHeaders`, `getClientIp`).

**Production-scoped routes** (`lib/production.ts`) — the standard preamble for anything under `/company/[cslug]/production/[pslug]/…`:

```ts
const { production, params } = await requireProductionRoute(event, {
  permission: Permission.MANAGE_TIMELINES,   // optional — omit for read-only VIEW-by-membership
  params:     ['tlId'],                      // extra router params, validated non-empty (400)
});
```

`requireProductionRoute` extracts `cslug`/`pslug` (+ named extras), resolves company + production (`404` with `errors.company.notFound` / `errors.production.notFound`), verifies access, optionally asserts a permission, and returns `ProductionContext & { params }`:

```ts
interface ProductionContext {
  auth:         { userId, role }
  company:      { id, name, slug }
  production:   <full production row>
  privileged:   boolean        // global admin or company owner/admin — all permission checks pass
  memberRoleId: string | null  // the member's production role (null when privileged)
}
```

Lower-level pieces it composes: `requireProductionAccess(event, ref)` (accepts `{ cslug, pslug }` or `{ productionId, companyId? }` — the latter is used by storage routes) and `requirePermission(ctx, bit)`. `productionAccessFilter(auth)` builds a WHERE fragment for listing only accessible productions.

---

## 4. Authentication — sessions (`lib/session.ts`)

- Cookie: **`syncsw_sid`**, `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` when `NODE_ENV=production`), `Max-Age` = **24h**. Value is a 64-hex-char random id. Cookie strings are built only by `sessionCookieHeader()` / `clearSessionCookieHeader()` — never assembled inline.
- Sessions live in the `sessions` table (`id, userId, expiresAt`); `getSession` joins `users` to return `{ userId, role }` and deletes expired rows on read. Reads go through a **30s in-memory `TtlCache`** (invalidated immediately by `destroySession`), so steady-state requests skip the session query. A 5-minute interval sweeps expired sessions.
- The same cookie authenticates **both REST and sockets** (socket middleware reads `handshake.headers.cookie`).

Endpoints:

| Route | Behavior |
| --- | --- |
| `POST /api/auth/register` | create user, hash password (scrypt, `lib/auth.ts`); rate-limited **5 / 10 min per IP** |
| `POST /api/auth/login` | rate-limited **10 / min per IP+email** (429 `errors.generic.rateLimited`); timing-equalized — a missing user still costs one scrypt verify against a dummy hash, so response time doesn't leak account existence; `401` on mismatch; sets cookie, returns `{ user }` |
| `POST /api/auth/logout` | destroy session from cookie, clear cookie |
| `GET /api/auth/me`, `GET /api/user/me` | current user info |

---

## 5. Authorization model

Three layers, checked in this order (any earlier layer short-circuits to "allowed"):

1. **Global role** — `users.role: 'admin' | 'user'`. Global admins pass everything.
2. **Company membership** — `companyMembers.role: 'owner' | 'admin' | member`. Owners/admins of the production's company are `privileged` (all production permission checks pass).
3. **Production role bitmask** — production members hold a `productionRoles` row whose `permissions` is a **bigint bitfield** (stored/transported as string, since JSON can't carry bigints).

Permission bits (`@starling/auth/permissions` — bit positions are frozen forever; add new ones by taking the next shift, never renumber):

| Bit | Name | Grants |
| --- | --- | --- |
| `1n << 0n` | `VIEW` | view the production (files, storage reads) |
| `1n << 1n` | `EDIT_TIMELINE` | tracks + clips CRUD |
| `1n << 2n` | `MANAGE_STORAGE` | upload / modify / delete files & folders |
| `1n << 3n` | `MANAGE_MEMBERS` | production membership CRUD |
| `1n << 4n` | `MANAGE_ROLES` | production roles CRUD |
| `1n << 5n` | `ADMINISTRATOR` | production-level superuser (passes any check; also guards production PATCH/DELETE) |
| `1n << 6n` | `MANAGE_TRACK_TYPES` | track types **and source sets/sources** CRUD |
| `1n << 7n` | `MANAGE_TIMELINES` | timelines CRUD |

`can(globalRole, rolePermissions, required)` implements: global admin → yes; `ADMINISTRATOR` bit → yes; else `(perms & required) !== 0n`. A denied check throws `403` with a human message from `PERMISSION_MESSAGES` and `data: { missingPermission: 'MANAGE_ROLES', role }` (`errorKey: errors.permission.missing`).

**Query cost** — an access-checked request is 2–3 queries total: one joined company⋈production resolve, then (non-admins) the company-membership check and the production-membership⋈role join **in parallel**. The member's `rolePermissions` ride along in `ProductionContext`, so `requirePermission` is pure bit math with no DB access.

---

## 6. REST route catalog

All paths are prefixed `/api`. "Access" is what the handler enforces beyond a valid session. PATCH bodies are all-optional versions of the POST bodies unless noted; PATCH/DELETE return the updated row / `{ ok: true }`, and mutations scope every WHERE by the resolved production id (so cross-production ids 404).

### Auth & user

| Method + path | Access | Notes |
| --- | --- | --- |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | public / session | see §4 |
| `GET /user/me` | session | profile |
| `POST /user/profile` | session | avatar/banner upload (multipart) |

### Companies & company members

| Method + path | Access |
| --- | --- |
| `GET /company` · `GET /company/[slug]` | session (listing filtered by access) |
| `POST /company` · `PATCH /company/[slug]` · `DELETE /company/[slug]` | global admin |
| `POST /company/[cslug]/profile` | company profile/banner images |
| `GET /company/[cslug]/members` | session |
| `POST /company/[cslug]/members` · `DELETE /company/[cslug]/members/[id]` | global admin |

### Productions

| Method + path | Access |
| --- | --- |
| `GET /production` · `POST /production` | session (list is access-filtered) |
| `GET /company/[cslug]/production/[pslug]` | production access |
| `PATCH` / `DELETE` same path | `ADMINISTRATOR` |
| `GET …/dashboard` · `GET …/storage-stats` | production access |
| `GET …/files` | `VIEW` |
| `POST …/profile` | production profile/banner images |

### Production members & roles

| Method + path | Access |
| --- | --- |
| `GET …/members` | production access |
| `POST …/members` · `PATCH/DELETE …/members/[memberId]` | `MANAGE_MEMBERS` |
| `GET …/roles` | production access |
| `POST …/roles` · `PATCH/DELETE …/roles/[roleId]` | `MANAGE_ROLES` — `permissions` travels as a **string** bigint |

### Source sets & sources (both under `MANAGE_TRACK_TYPES` for writes)

| Method + path | Body highlights |
| --- | --- |
| `GET/POST …/source-sets` | `{ name ≤128 }` |
| `PATCH/DELETE …/source-sets/[setId]` | rename / delete |
| `GET/POST …/source-sets/[setId]/sources` | `{ name ≤128, shortName ≤16, hue 0–360, data? }` — POST verifies the set belongs to the production |
| `PATCH/DELETE …/source-sets/[setId]/sources/[sourceId]` | WHERE includes set + production id |

### Track types

| Method + path | Body highlights |
| --- | --- |
| `GET/POST …/track-types` | `{ name ≤64, color?, trackMode: 'event'\|'clip' (default clip), sourceSetId?, sortOrder }` — writes need `MANAGE_TRACK_TYPES` |
| `PATCH/DELETE …/track-types/[typeId]` | PATCH throws `422 Nothing to update` on empty body |

### Timelines, tracks, clips

| Method + path | Access | Body highlights |
| --- | --- | --- |
| `GET/POST …/timelines` | POST: `MANAGE_TIMELINES` | `{ name ≤128, frameRate (db enum: 23.976…60, from frameRateEnum), startFrame, endFrame > startFrame, ltcOffsetFrames }` |
| `GET …/timelines/[tlId]` | access | **The editor bootstrap**: `{ timeline, tracks: [{ …track, typeName, typeColor, sourceName/ShortName/Hue, clips: [{ …clip, fileType }] }], trackTypes, sources }` |
| `PATCH/DELETE …/timelines/[tlId]` | `MANAGE_TIMELINES` | PATCH bumps `updatedAt` |
| `POST …/timelines/[tlId]/tracks` | `EDIT_TIMELINE` | create track (typeId, sourceId?, name, mode, sortOrder…) |
| `PATCH/DELETE …/tracks/[trackId]` | `EDIT_TIMELINE` | e.g. `{ isMuted }`, `{ isLocked }` |
| `POST …/tracks/[trackId]/clips` | `EDIT_TIMELINE` | `{ label='', position ≥0, fileId?, mediaStart?, end? (must be > mediaStart when both set), sourceId?, color?, data? }` — verifies timeline→production and track→timeline chains |
| `PATCH/DELETE …/clips/[clipId]` | `EDIT_TIMELINE` | move (`position`), crop (`mediaStart`/`end`), relabel, recolor |

### Storage (production-scoped via `{ productionId }` ref; see §7)

| Method + path | Access |
| --- | --- |
| `GET /storage?pid=…&folder_id=…` (listing: folders + files at one level), `GET /storage/[id]` | `VIEW` |
| `POST /storage` (folder create: `{ production_id, name ≤200, parent_id?, hue? 0–360 }`, parent validated same-production), `PATCH/DELETE /storage/folders/[id]`, `PATCH/DELETE /storage/[id]` | `MANAGE_STORAGE` |
| `POST /storage/upload` | `MANAGE_STORAGE` — multipart `file` + `production_id` (+ `folder_id`, validated to belong to the same production) |
| `GET /storage/[id]/serve` | `VIEW` (or just session for non-production files) — see §7 |

### Chat helpers

| Method + path | Notes |
| --- | --- |
| `GET /chat/gifs/search` · `GET /chat/gifs/trending` | GIF provider proxy for chat attachments |

---

## 7. Storage subsystem (`lib/storage.ts`)

Files live on disk under the repo-level `storage/` directory; the DB (`storageFiles`, `storageFolders`, `storageImageVersions`) is the source of truth for metadata.

**Disk layout**

```
storage/c/{companyId}/p/{productionId}/images/{fileId}@{quality}.webp
storage/c/{companyId}/p/{productionId}/audio/{fileId}{ext}
storage/c/{companyId}/profile/{slot}/{fileId}@{quality}.webp            (company profile/banner)
storage/c/{companyId}/p/{productionId}/profile/{slot}/{fileId}@…       (production profile/banner)
```

**Upload flow** (`POST /storage/upload`): multipart parse → mime allow-list (`image/jpeg|png|webp|gif|avif`, `audio/mpeg|wav|ogg|flac|aac|mp4|x-m4a`; anything else `415`) → insert `storageFiles` row → write payload:

- **Images** go through sharp: re-encoded to **WebP at several quality tiers** (the number of tiers scales with input size), each written as `{fileId}@{quality}.webp` and recorded in `storageImageVersions`.
- **Audio** is written once, unmodified, keeping its extension.

**Serving** (`GET /storage/[id]/serve`):

- Images: optional `?quality=1..100` picks the stored version with the **nearest** quality; `Content-Type: image/webp`.
- All files: `Accept-Ranges: bytes` with full RFC-7233 handling — `Range: bytes=a-b` → `206` + `Content-Range` (invalid → `416`). This is what lets `<audio>`/decoders seek. `Cache-Control: private, max-age=3600`.
- The web app relies on this for `Image`/`Avatar` (`?quality=`) and the timeline editor's audio decoding (full-body fetch).

---

## 8. Sockets — engine & authentication (`lib/sockets.ts`)

One Socket.IO server rides the HTTP server at **path `/socket`**. Handshakes enforce the **same origin allowlist as HTTP** (`isOriginAllowed` via both `allowRequest` and the CORS callback) — disallowed sites can't open a credentialed socket. There are two namespaces: the **root** namespace (global chat + presence) and **`/timeline`** (editor live-sync). They share:

```ts
export async function socketAuth(socket, next)
```

which resolves the `syncsw_sid` cookie → session → user row and stores `socket.data.user = { id, name, avatarImageId, createdAt, role }`. No/invalid session → connection is rejected (`Authentication required`), so every connected socket is a known user. **Note:** `sockets.ts` and `timelineSockets.ts` import each other (shared middleware/types) — a deliberate, runtime-safe circular ESM import; bindings are only referenced at call time.

Client side, the web app connects with `io({ path: '/socket', withCredentials: true })` (chat, `useSocket.js`) and `io('/timeline', { path: '/socket', withCredentials: true })` (editor, `useTimelineSync.js`).

### 8.1 Root namespace — global chat & presence

In-memory state (lost on restart): a rolling history of the last **100** messages, and an online map `userId → Set<socketId>` (multi-tab safe — a user is "online" until their last socket disconnects).

| Direction | Event | Payload |
| --- | --- | --- |
| S→C on connect | `history` | last ≤100 `ChatMessage`s |
| S→C on connect | `online` | `OnlineUser[]` (`{ id, name }` — role is deliberately stripped) |
| S→C | `user:joined` / `user:left` | fired on a user's first socket / last disconnect |
| C→S | `message:send` | `{ text, attachments? }` + ack. Text trimmed, capped at 2000 chars; attachments filtered to `{ type: 'gif', url }`, max 10; **rate-limited 8 messages / 10s per user**. Ack: `{ ok: true }` or `{ error }` |
| S→C | `message:new` | `{ id (uuid), text, attachments, user, sentAt (ISO) }` broadcast to everyone including sender |

### 8.2 `/timeline` namespace — editor live-sync (`lib/timelineSockets.ts`)

Design: **REST is the source of truth for persistent data.** The socket layer only (a) relays already-persisted clip/track changes to other editors, (b) synchronizes the ephemeral transport (playhead), and (c) tracks presence. The server validates room membership and shapes, but never writes the DB for these events.

**Rooms & membership** — one room per timeline, named `tl:{timelineId}`. A socket follows one timeline at a time (joining another leaves the first).

| Direction | Event | Behavior |
| --- | --- | --- |
| C→S | `timeline:join` `{ timelineId }` + ack | `canAccessTimeline` check: timeline→production→company; allowed if global admin, company owner/admin, or production member (mirrors §5 layers 1–2 + membership; per-permission bits are *not* rechecked here — REST enforces those on the actual writes). Ack `{ ok }` or `{ error: 'Access denied' … }`. On success: join room, add to presence, emit presence to the room. |
| C→S | `timeline:leave` | leave room + presence (also on `disconnect`) |
| S→C | `timeline:presence` | `PresenceUser[]` — `{ id, name, avatarImageId, createdAt }`, deduped per user across tabs; sent to the whole room on every join/leave |
| C→S / S→C | `clip:change` | `{ type: 'upsert'\|'remove', trackId, clip? , clipId? }` — relayed verbatim to the room **except the sender** (`socket.to(room)`). `clip` is the full REST response row. Payloads over **32 KB** are dropped (relay amplification guard). |
| C→S / S→C | `track:change` | `{ type: 'upsert'\|'remove', track?, trackId? }` — same relay semantics and size cap |
| C→S | `playhead:update` | `{ frame: number, isPlaying: boolean }` — validated finite; **rate-limited server-side to one relay per 80ms per socket** (excess silently dropped) |
| S→C | `playhead:sync` | `{ frame, isPlaying, userId }` — the relay of the above, to everyone else in the room |

**Playhead protocol (client contract)** — implemented in `useTimelineSync.js` + `usePlayback.js`:

- Any local transport action (play, pause, seek, scrub) broadcasts; **last writer wins** across the room.
- Client-side the sends are trailing-throttled at 120ms (scrub floods collapse), with an `immediate` bypass for play/pause edges; while playing, the playing client re-broadcasts once per second as a drift heartbeat.
- Receivers apply remote state with `broadcast: false` (no echo loops), start/stop local playback to match, and only snap position when drift exceeds half a second (`fps/2` frames), restarting audio at the corrected offset.

**Presence bookkeeping** — module-level `Map<timelineId, Map<userId, { user, sockets:Set }>>`; a user leaves presence when their last socket in that room leaves. In-memory only; restart clears all rooms (clients rejoin automatically on reconnect via the `connect` handler in `useTimelineSync`).

---

## 9. Conventions & recipes

**Error keys** — `errors.<domain>.<case>` (e.g. `errors.generic.validationFailed`, `errors.permission.missing`, `errors.production.notFound`). The web client's `useApi().$fetch` surfaces `{ ok, data, error }` and can toast automatically unless called with `silent: true`.

**Bigints** — permission bitfields cross the wire as strings (`role.permissions.toString()` on the way out, `BigInt(...)` on the way in). Never `JSON.stringify` a bigint.

**Adding a REST endpoint under a production**

1. Create `src/routes/company/[cslug]/production/[pslug]/<resource>/index.post.ts` (path = URL, suffix = method).
2. Preamble: `const { production, params } = await requireProductionRoute(event, { permission: Permission.X, params: [...] })`.
3. Validate with `readValidatedBody(event, zodSchema)`; for PATCH build the update with `pickDefined(...)` and reject empty (`422 Nothing to update`).
4. Scope every query with `eq(table.productionId, production.id)` (and parent-chain ids for nested resources) so foreign ids 404 rather than leak.
5. Return the row (`.returning()`); throw `createError` for all failures.
6. If the resource is shown live in the editor, have the client broadcast the persisted result over the matching socket relay.

**Adding a socket event to `/timeline`**

1. Add the payload type + event name to `ServerToClientEvents` / `ClientToServerEvents` in `timelineSockets.ts`.
2. Register the handler inside the namespace `connection` callback; read the room from `socket.data.timelineId`, validate the payload shape, and relay with `socket.to(roomName(id)).emit(...)` (excludes sender) or `nsp.to(...)` (includes sender).
3. Keep it a relay — persist through REST first; consider a per-socket rate guard for high-frequency events (see `playhead:update`).
4. Mirror the event in `useTimelineSync.js` (send helper + `socket.on` → callback option).

**Gotchas worth knowing**

- The `sessions` cleanup interval, session read cache, rate limiters, and chat history are per-process state — multi-instance deployment would need sticky sessions for Socket.IO and shared stores for history/presence/limits.
- Deploying the web app on a different origin than the API requires listing it in `CORS_ORIGINS` (comma-separated full origins) or requests will be rejected with 403.
- `requireProductionRoute` returns `params` values as non-empty strings but TypeScript can't see which keys exist — the codebase uses `params.tlId!` after requesting `params: ['tlId']`.
- Handlers that stream (`serve.get.ts`) end the response themselves; the dispatcher detects `res.writableEnded` and skips the JSON envelope.
- The route scanner picks up **every** `*.{method}.ts` file under `src/routes` — don't park helper modules there.
