# Starling API Reference — REST & Sockets

How `apps/api` works, end to end: the HTTP server, the file-based router, the request toolkit, authentication and the permission model, every REST route, the storage subsystem, and both Socket.IO namespaces. Written for someone adding features to the API or consuming it from the web app.

- Runtime: plain Node `http` server (no framework), TypeScript ESM, built with `tsc` to `dist/`
- Data: PostgreSQL via Drizzle ORM (`@starling/db` re-exports `db` + the whole schema)
- Validation: Zod (v4 — note `z.uuid()` / `z.json()` top-level helpers are available)
- Realtime: Socket.IO attached to the same HTTP server
- Static: serves the public homepage (`apps/homepage`) for every unmatched path; uploaded files live on local disk under `storage/`. The web app is **not** served by the API — in prod Plesk hosts `apps/web/dist` directly on `app.cino.no`; in dev it runs on the Vite dev server

```
apps/api/src/
├─ index.ts            server entry: CORS, /health, homepage static, /api dispatch, error envelope
├─ router.ts           file-convention router: load, score, match
├─ lib/
│  ├─ handler.ts       ApiEvent, ApiError, auth guards, body/query/multipart readers
│  ├─ session.ts       cookie sessions (DB-backed)
│  ├─ auth.ts          password hashing/verification
│  ├─ permissions.ts   can() — permission bit check
│  ├─ production.ts    production resolution + access + permission guards (query/id scoping)
│  ├─ company.ts       company resolution + company-admin guard
│  ├─ storage.ts       disk layout, sharp image pipeline, audio writes
│  ├─ sockets.ts       Socket.IO server, shared auth middleware, chat namespace
│  └─ timelineSockets.ts  /timeline namespace: rooms, presence, relays, playhead
└─ routes/             one file per endpoint (see Routing)
```

---

## 1. Server lifecycle (`index.ts`)

One `createServer` callback handles everything, in this order:

1. **Origin policy + security headers** (`lib/security.ts`) — every response gets `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Vary: Origin`. Cross-site requests are checked against an allowlist: no `Origin` header (same-origin pages, CLI clients, and reverse proxies that strip it), **same-site origins — exact host or subdomain in either direction** (`app.cino.no` ↔ `cino.no`, the Plesk "app on a subdomain, API on the apex" layout works with zero config), localhost, or an entry in the `CORS_ORIGINS` env var (comma-separated full origins). The request's own host honours `X-Forwarded-Host` (`requestHost()`), so proxy Host rewriting doesn't break the comparison. Allowed origins get credentialed CORS headers; **disallowed origins are refused with `403` before any handler runs**. `OPTIONS` preflights short-circuit with `204`.
2. **`/health`** → `{ "status": "ok" }`.
3. **`/api/*`** — matched against the route table (below). No match → `404 { error, path }`.
4. **Anything else** — `GET`/`HEAD` requests serve the public **homepage** (`apps/homepage/dist`, a separate Vue/Vite app) through an in-memory static cache: files are read from disk once (revalidated by mtime), **pre-gzipped** when compressible (html/js/css/svg/json over 1 KB), and served with `ETag`/`304` conditional handling. Paths under `/assets/` (content-hashed filenames) get `Cache-Control: public, max-age=31536000, immutable`; extension-less paths fall back to `index.html` (SPA routing) with `no-cache` + ETag revalidation. A resolved-path containment check makes traversal structurally impossible. If the homepage isn't built, non-asset requests return `503` with a hint. Socket.IO owns `/socket` and intercepts those requests (both namespaces) before this handler ever sees them. Non-`GET` methods on unknown paths still get a JSON `404`. The web app (`apps/web/dist`) is deployed separately on `app.cino.no` (Plesk serves the dist directly), so it builds with the default vite base `/`.

Socket.IO is attached to the same server via `setupSockets(server)` (see §8), and the port comes from `PORT` (default 3000). At boot the server prints a route tree of all loaded endpoints.

### Response envelope

A route handler returns a plain value; the server serializes it:

JSON responses ≥ 2 KB are gzipped when the client sends `Accept-Encoding: gzip` (`sendJson`), which matters for the timeline bootstrap and storage listings.

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

**Production-scoped routes** (`lib/production.ts`) — resources hang off an **id-scoped path prefix** rather than the old slug chain: everything a production owns lives under `/api/production/[pid]/…`, and everything a timeline owns lives under `/api/timeline/[tlId]/…`. The two collections that create these ids stay at the top level (`/api/production/list`, `/api/timelines?pid=…`). Three preambles cover all of it:

```ts
// /api/production/[pid]/…  — pid is a path param
const { production } = await requireProductionParam(event, {
  permission: Permission.MANAGE_ROLES,   // optional
});

// /api/timeline/[tlId]/…  — resolves the timeline, then access on its production;
// the full timeline row rides along so handlers don't re-fetch it
const { production, timeline } = await requireTimelineParam(event, {
  permission: Permission.EDIT_TIMELINE,
});

// Top-level collections scoped by ?pid=…  (/api/timelines)
const { production } = await requireProductionQuery(event, {
  permission: Permission.MANAGE_TIMELINES,
});
```

All three resolve the owning production, verify access (`404` on a missing/invalid id, `422` for a missing `pid` query), optionally assert a permission, and return a `ProductionContext`. Item handlers still scope their `WHERE` by the resolved id chain (e.g. `eq(tracks.id, trackId) AND eq(tracks.timelineId, timeline.id)`) so foreign ids `404` rather than leak. `ProductionContext`:

```ts
interface ProductionContext {
  auth:         { userId, role }
  company:      { id, name, slug }
  production:   <full production row>
  privileged:   boolean        // global admin or company owner/admin — all permission checks pass
  memberRoleId: string | null  // the member's production role (null when privileged)
}
```

Lower-level pieces they compose: `requireProductionAccess(event, ref)` (accepts `{ cslug, pslug }` — used only by `GET /production/find` — or `{ productionId, companyId? }`) and `requirePermission(ctx, bit)`. `productionAccessFilter(auth)` builds a WHERE fragment for listing only accessible productions. Company routes use `requireCompanyAccess` / `requireCompanyAdmin` (`lib/company.ts`), which accept `{ slug }` or `{ companyId }`.

---

## 4. Authentication — sessions (`lib/session.ts`)

- Cookie: **`syncsw_sid`**, `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` when `NODE_ENV=production`), `Max-Age` = **24h**. Value is a 64-hex-char random id. Cookie strings are built only by `sessionCookieHeader()` / `clearSessionCookieHeader()` — never assembled inline.
- In production the cookie also carries `Domain` so the session is valid across the whole site — `cino.no`, `app.cino.no`, `api.cino.no`. Defaults to `Domain=cino.no`; override with the `COOKIE_DOMAIN` env var for other deployments. Dev (localhost) stays host-only. Requests from `app.cino.no` to the API are cross-origin but **same-site**, so `SameSite=Lax` does not block them — clients just need `credentials: 'include'` (the web app's `useApi` and direct fetches already do).
- Sessions live in the `sessions` table (`id, userId, expiresAt`); `getSession` joins `users` to return `{ userId, role, expiresAt }` and deletes expired rows on read. Reads go through a **30s in-memory `TtlCache`** (invalidated immediately by `destroySession`), so steady-state requests skip the session query. A 5-minute interval sweeps expired sessions.
- **Sliding renewal**: once a session is past half its TTL, the next authenticated request extends the DB expiry to a full 24h and re-sends the cookie (`renewSessionIfDue`, called from `getAuth`) — active users never hit the fixed cliff mid-work; idle sessions still expire on schedule. Login/logout set their own cookie afterwards and win.
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
| `1n << 8n` | `RENAME_CLIPS` | relabel clips (label-only clip PATCH) without full `EDIT_TIMELINE` |

`can(globalRole, rolePermissions, required)` implements: global admin → yes; `ADMINISTRATOR` bit → yes; else `(perms & required) !== 0n` — so `required` may be a **mask of alternatives** (any bit passes; a denial names the first permission in the mask). A denied check throws `403` with a human message from `PERMISSION_MESSAGES` and `data: { missingPermission: 'MANAGE_ROLES', role }` (`errorKey: errors.permission.missing`).

**Query cost** — an access-checked request is 2–3 queries total: one joined company⋈production resolve, then (non-admins) the company-membership check and the production-membership⋈role join **in parallel**. The member's `rolePermissions` ride along in `ProductionContext`, so `requirePermission` is pure bit math with no DB access.

---

## 6. REST route catalog

All paths are prefixed `/api`. "Access" is what the handler enforces beyond a valid session. PATCH bodies are all-optional versions of the POST bodies unless noted; PATCH/DELETE return the updated row / `{ ok: true }`.

**URL convention** — a production owns everything under `/api/production/[pid]/…`; a timeline owns everything under `/api/timeline/[tlId]/…`. The two collections that mint those ids stay at the top level and scope by a query param. A handful of leaf collections still take a query param where a bare path segment wouldn't disambiguate:

| Param | Scopes by | Used on |
| --- | --- | --- |
| `cid` | company id | `GET /production/list` (optional filter) |
| `pid` | production id | `GET/POST /timelines`, `/storage` |
| `sid` | source-set id | `GET/POST /production/[pid]/sources` |

### Auth & user

| Method + path | Access | Notes |
| --- | --- | --- |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | public / session | see §4 |
| `GET /user/me` | session | profile |
| `POST /user/profile` | session | avatar/banner upload (multipart) |

### Companies & company members

| Method + path | Access |
| --- | --- |
| `GET /companies` · `GET /companies/[slug]` | session (detail returns `canManage`) |
| `POST /companies` | global admin |
| `PATCH /companies/[slug]` · `DELETE /companies/[slug]` | company owner/admin (or global admin) |
| `POST /companies/[slug]/profile` | company owner/admin — profile/banner images |
| `GET /companies/[slug]/members` | company owner/admin |
| `POST /companies/[slug]/members` · `DELETE /companies/[slug]/members/[id]` | global admin |

### Productions

| Method + path | Access |
| --- | --- |
| `GET /production/list?cid=…` · `POST /production/list` | session (list is access-filtered; `cid` optional) |
| `GET /production/find?cslug=…&pslug=…` | production access — slug → production lookup for initial page loads; returns `{ company, production, access }` |
| `GET /production/[pid]` | production access — same payload as `find`, keyed by id |
| `PATCH /production/[pid]` · `DELETE /production/[pid]` | `ADMINISTRATOR` |
| `GET /production/[pid]/dashboard` · `GET /production/[pid]/storage-stats` | production access |
| `GET /production/[pid]/files?type=…` | `VIEW` |
| `POST /production/[pid]/profile` | production profile/banner images |

### Production members & roles

| Method + path | Access |
| --- | --- |
| `GET /production/[pid]/members` | production access |
| `POST /production/[pid]/members` · `PATCH/DELETE /production/[pid]/members/[memberId]` | `MANAGE_MEMBERS` |
| `GET /production/[pid]/roles` | production access |
| `POST /production/[pid]/roles` · `PATCH/DELETE /production/[pid]/roles/[roleId]` | `MANAGE_ROLES` — `permissions` travels as a **string** bigint |

### Source sets & sources (both under `MANAGE_TRACK_TYPES` for writes)

| Method + path | Body highlights |
| --- | --- |
| `GET/POST /production/[pid]/source-sets` | `{ name ≤128 }` |
| `PATCH/DELETE /production/[pid]/source-sets/[setId]` | rename / delete |
| `GET/POST /production/[pid]/sources?sid=…` | `{ name ≤128, shortName ≤16, hue 0–360, data? }` — `sid` resolves the set (404 if missing/foreign) |
| `PATCH/DELETE /production/[pid]/sources/[sourceId]` | scoped by production id |

### Track types

| Method + path | Body highlights |
| --- | --- |
| `GET/POST /production/[pid]/track-types` | `{ name ≤64, color?, trackMode: 'event'\|'clip' (default clip), sourceSetId?, sortOrder }` — writes need `MANAGE_TRACK_TYPES` |
| `PATCH/DELETE /production/[pid]/track-types/[typeId]` | PATCH throws `422 Nothing to update` on empty body |
| `GET /production/[pid]/track-type-presets` | file-based preset catalogue (`apps/api/src/lib/trackTypePresets.ts`): `{ id, name, description, supportsCameraSet?, settings }` |
| `POST /production/[pid]/track-types/from-preset` | `MANAGE_TRACK_TYPES` — `{ presetId, name?, sortOrder?, cameraSet?: { name ≤128, count 1–64 } }`. Creates a track type from the preset's settings; `cameraSet` (camera presets only, else 400) also creates a source set with `count` cameras (`Camera N`/`CN`), hues spread evenly from the preset hue. Returns `{ trackType, sourceSet, sources }` |

### Timelines, tracks, clips

Timelines are the one production resource kept at the top level (create/list by `?pid=`); a specific timeline and everything it owns live under `/api/timeline/[tlId]/…`.

| Method + path | Access | Body highlights |
| --- | --- | --- |
| `GET/POST /timelines?pid=…` | POST: `MANAGE_TIMELINES` | `{ name ≤128, frameRate (db enum: 23.976…60, from frameRateEnum), startFrame, endFrame > startFrame, ltcOffsetFrames }` |
| `GET /timeline/[tlId]` | access | **The editor bootstrap**: `{ timeline, tracks: [{ …track, typeName, typeColor, sourceName/ShortName/Hue, clips: [{ …clip, fileType }] }], trackTypes, sources }` |
| `PATCH/DELETE /timeline/[tlId]` | `MANAGE_TIMELINES` | PATCH bumps `updatedAt` |
| `GET/POST /timeline/[tlId]/tracks` | `EDIT_TIMELINE` (GET: access) | create track (typeId, sourceId?, name, mode, sortOrder…) — typeId verified same-production; `sortOrder` defaults to **max+1** (append). Track listings (here and in the editor bootstrap) are ordered by `sortOrder, createdAt` |
| `PATCH/DELETE /timeline/[tlId]/tracks/[trackId]` | `EDIT_TIMELINE` | e.g. `{ isMuted }`, `{ isLocked }`, `{ sortOrder }` — scoped by timeline id |
| `POST /timeline/[tlId]/tracks/reorder` | `EDIT_TIMELINE` | `{ order: [trackId…] }` — rewrites `sortOrder` to the array index. Lenient: ids outside the timeline are ignored, unlisted tracks keep their old value (concurrent add/delete safe). Returns `{ order }` (the applied ids) |
| `POST /timeline/[tlId]/clips` | `EDIT_TIMELINE` | `{ trackId, label='', position ≥0, fileId?, mediaStart?, end? (must be > mediaStart when both set), sourceId?, color?, data? }` — `trackId` verified to belong to the timeline. `data` is bounded (`lib/clipData.ts`): typed `bpm`/`beatsPerBar`, unknown keys tolerated, whole blob ≤ 2 KB serialized |
| `PATCH/DELETE /timeline/[tlId]/clips/[clipId]` | `EDIT_TIMELINE` (PATCH: label-only body passes with `RENAME_CLIPS` **or** `EDIT_TIMELINE`) | move (`position`), crop (`mediaStart`/`end`), relabel, recolor — clip verified via track→timeline |

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

One Socket.IO server rides the HTTP server at **path `/socket`**. Handshakes enforce the **same origin allowlist as HTTP** inside `allowRequest` (where the full request — including `X-Forwarded-Host` — is available); the `cors` option only reflects the already-vetted origin so browsers accept cross-subdomain polling responses. A missing `Origin` header is allowed (proxies like Plesk can strip it; same-origin pages never send it) — do **not** move the check into a `cors.origin` callback, which sees neither the request host nor a way to distinguish these cases. There are two namespaces: the **root** namespace (global chat + presence) and **`/timeline`** (editor live-sync). They share:

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
| C→S | `message:send` | `{ text, attachments? }` + ack. Text trimmed, capped at 2000 chars; attachments filtered to `{ type: 'gif', url }` with the **url allowlisted to `https://*.giphy.com`** (the provider our proxy serves — arbitrary third-party URLs would broadcast tracking pixels to every user), max 10; **rate-limited 8 messages / 10s per user**. Ack: `{ ok: true }` or `{ error }` |
| S→C | `message:new` | `{ id (uuid), text, attachments, user, sentAt (ISO) }` broadcast to everyone including sender |

### 8.2 `/timeline` namespace — editor live-sync (`lib/timelineSockets.ts`)

> Building a native client? [swiftSocket.md](swiftSocket.md) walks through this contract from an iOS SwiftUI app (cookie auth, clock sync, transport following, commands).

Design: **REST is the source of truth for persistent data.** The socket layer (a) relays already-persisted clip/track changes to other editors, (b) **owns the shared transport clock** — clients send play/pause/seek commands and the server's anchor decides how fast frames go — and (c) tracks presence. The server validates room membership and shapes, but never writes the DB for these events.

**Rooms & membership** — one room per timeline, named `tl:{timelineId}`. A socket follows one timeline at a time (joining another leaves the first).

| Direction | Event | Behavior |
| --- | --- | --- |
| C→S | `timeline:join` `{ timelineId }` + ack | `resolveTimelineAccess` check: timeline→production→company; allowed if global admin, company owner/admin, or production member (mirrors §5 layers 1–2 + membership). The member's role permission bits are resolved in the same pass and the resulting `EDIT_TIMELINE` capability is cached on the socket to gate the mutation relays below. Ack `{ ok }` or `{ error: 'Access denied' … }`. On success: join room, add to presence, emit presence to the room. |
| C→S | `timeline:leave` | leave room + presence (also on `disconnect`) |
| S→C | `timeline:presence` | `PresenceUser[]` — `{ id, name, avatarImageId, createdAt }`, deduped per user across tabs; sent to the whole room on every join/leave |
| C→S / S→C | `clip:change` | `{ type: 'upsert'\|'remove', trackId, clip? , clipId? }` — relayed verbatim to the room **except the sender** (`socket.to(room)`). **Requires `EDIT_TIMELINE` or `RENAME_CLIPS`** (cached join-time capabilities) — rename-only members must be able to relay their label PATCHes, but are restricted to `upsert` (they have no REST path to a remove); sockets with neither permission are silently dropped. `clip` is the full REST response row. Payloads over **32 KB** are dropped (relay amplification guard). |
| C→S / S→C | `track:change` | `{ type: 'upsert'\|'remove'\|'reorder', track?, trackId?, order? }` — same relay semantics, **`EDIT_TIMELINE` gate**, and size cap. `reorder` carries `order: [trackId…]` (the ids the REST reorder applied; index = sortOrder) and requires `order` to be an array |
| C→S | `transport:command` | `{ action: 'play'\|'pause'\|'seek', frame? }` — VIEW-level (any joined member drives the shared transport). `play` requires `frame` (the sender's position becomes the shared one); `seek` requires `frame` and is accepted **only while playing** (a stopped timeline is browsed privately), rate-bounded to one per 80ms per socket; `pause` is idempotent and its frame is computed **from the server clock**, never taken from the client. The timeline's `frameRate` comes from the DB at join — clients cannot drive the clock with a fake fps. |
| S→C | `transport:state` | `{ playing, frame, frameRate, userId, at }` — the room's **authoritative transport anchor**, sent to the whole room *including the sender* after every accepted command, and to joiners while playing. `frame` is the position at server time `at`; while playing the position at any server time t is `frame + (t − at)/1000 × frameRate` — **the server decides how fast frames go**. Clients map `at` through their measured clock offset and PREDICT the current frame, so a command's network delay cancels out and every client lands on the same wall-clock-aligned frame. Kept per room in `roomTransport` (anchors never go stale); cleared when the room empties; clients treat a run predicted past the timeline's end as ended. |
| S→C | `clip:active` | `{ trackId, clipId, label, sourceId, frame, at }` — emitted while the transport **plays**, whenever the clip under the playhead changes on a track (`clipId: null` = the track went silent). Computed by the **server** from its transport clock: on arm (play/seek) it loads the timeline's clip windows and walks boundary-to-boundary with timers; clip/track edits reload it; pause/empty room disarm it. Active-clip semantics mirror the editor: active from `position`, for `end − mediaStart` frames when `end` is set, else until the track's next clip. Joiners mid-playback get a snapshot of currently active clips. Lets lightweight clients (mobile) show "now playing" per track without holding the clip model. |
| C→S | `time:ping` | ack-only NTP-style probe: acks `Date.now()` (server epoch ms). The client runs a 5-sample burst on every (re)connect and keeps the lowest-RTT sample's offset (`serverNow + rtt/2 − localNow`) to place transport anchors on its own clock. |

**Transport protocol (client contract)** — implemented in `useTimelineSync.js` + `usePlayback.js`:

- Clients never stream positions. Local play/seek act optimistically (audio starts at once) and send a command; the server's echoed anchor then takes over as the time base. Seek commands are throttled at 120ms client-side (trailing send carries the burst's latest frame); play/pause send immediately and drop any queued seek.
- While playing, each client checks its position against the server anchor every 500ms and corrects any drift > 0.25 frames — corrections < 10 frames shift the audio-clock anchor (voices play on, inaudible), only bigger ones re-anchor audio.
- Stopped timelines are private: no seek commands are sent, and a stop state is ignored by clients that are already stopped (it must never yank a privately-browsing playhead).

**Presence bookkeeping** — module-level `Map<timelineId, Map<userId, { user, sockets:Set }>>`; a user leaves presence when their last socket in that room leaves. In-memory only; restart clears all rooms (clients rejoin automatically on reconnect via the `connect` handler in `useTimelineSync`).

---

## 9. Conventions & recipes

**Error keys** — `errors.<domain>.<case>` (e.g. `errors.generic.validationFailed`, `errors.permission.missing`, `errors.production.notFound`). The web client's `useApi().$fetch` surfaces `{ ok, data, error }` and can toast automatically unless called with `silent: true`.

**Bigints** — permission bitfields cross the wire as strings (`role.permissions.toString()` on the way out, `BigInt(...)` on the way in). Never `JSON.stringify` a bigint.

**Adding a REST endpoint under a production**

1. Create the file under the owning prefix: `src/routes/production/[pid]/<resource>/index.post.ts` for a production resource, or `src/routes/timeline/[tlId]/<resource>/…` for a timeline resource (path = URL, suffix = method).
2. Preamble: `requireProductionParam(event, { permission })` for `/production/[pid]/…`, `requireTimelineParam(event, { permission })` for `/timeline/[tlId]/…` (gives you `timeline` too), or `requireProductionQuery(event, …)` for a top-level `?pid=` collection.
3. Validate with `readValidatedBody(event, zodSchema)`; for PATCH build the update with `pickDefined(...)` and reject empty (`422 Nothing to update`).
4. Scope every query by the resolved parent id — `eq(table.productionId, production.id)` or `eq(table.timelineId, timeline.id)` (plus the item's own id on `[param]` routes) — so foreign ids `404` rather than leak.
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
- `requireTimelineParam` returns the full `timeline` row alongside the `ProductionContext`, so timeline-scoped handlers don't re-fetch it; `requireProductionParam` reads `[pid]`, `requireProductionQuery` reads `?pid=`.
- Handlers that stream (`serve.get.ts`) end the response themselves; the dispatcher detects `res.writableEnded` and skips the JSON envelope.
- The route scanner picks up **every** `*.{method}.ts` file under `src/routes` — don't park helper modules there.
