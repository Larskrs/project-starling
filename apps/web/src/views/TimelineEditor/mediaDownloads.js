/**
 * Download registry for the timeline's media files.
 *
 * Every byte the editor pulls from `/api/storage/:id/serve` — audio the player
 * decodes, images clips paint themselves with — goes through here, so there is
 * exactly ONE place that knows what is in flight and how far along it is. Clips
 * read it to show their own loading state; the download island reads it to show
 * the queue.
 *
 * Deliberately free of Vue imports: the audio engine imports this module, and
 * the engine's standalone regression test (`useAudioEngine.test.mjs`) runs it in
 * bare node with no bundler to resolve `vue`. The reactive bindings live next
 * door in `useMediaDownloads.js`, which subscribes to the notifications below.
 *
 * Progress comes from streaming the response body — the serve route sets
 * `Content-Length`, so `loaded / total` is a real fraction rather than a guess.
 * Environments without a readable body (the test's fake fetch) fall back to one
 * buffered read and report indeterminate progress instead of failing.
 */

/** @typedef {'downloading'|'decoding'|'ready'|'error'} DownloadStatus */

const _files    = new Map()   // fileId → live entry (mutated in place)
const _meta     = new Map()   // fileId → { name, kind } known before a download starts
const _objectUrls = new Map() // cacheKey → Promise<string> (blob: URLs for images)
const _listeners = new Set()

// Chunk callbacks fire far faster than a UI needs. Notifications coalesce on a
// timer so a burst of reads costs one render; terminal changes (done, failed,
// stage flips) push immediately so the queue never looks stuck.
const NOTIFY_MS = 90
let _notifyTimer = null

function _notify(immediate = false) {
  if (!_listeners.size) return          // nothing observing → never arm a timer
  if (immediate) {
    if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null }
    for (const fn of _listeners) fn()
    return
  }
  if (_notifyTimer) return
  _notifyTimer = setTimeout(() => {
    _notifyTimer = null
    for (const fn of _listeners) fn()
  }, NOTIFY_MS)
}

function _ensure(fileId, meta) {
  let entry = _files.get(fileId)
  if (!entry) {
    entry = {
      fileId,
      name:       '',
      kind:       'file',
      status:     'downloading',
      loaded:     0,
      total:      0,
      mimeType:   '',
      error:      null,
      startedAt:  Date.now(),
      finishedAt: null,
    }
    _files.set(fileId, entry)
  }
  const known = { ..._meta.get(fileId), ...meta }
  if (known.name) entry.name = known.name
  if (known.kind) entry.kind = known.kind
  return entry
}

/**
 * Subscribe to registry changes. Returns an unsubscribe function.
 * Listeners get no arguments — read the state back with `downloadEntries()`.
 */
export function subscribeDownloads(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

/**
 * Snapshot of the registry, oldest first.
 *
 * Entries are CLONED on the way out. The live objects are mutated in place, and
 * a consumer holding the same identity across two snapshots would see Vue skip
 * the update (a computed that returns an unchanged reference triggers nothing),
 * so progress would never repaint. Copies are a handful of small objects.
 */
export function downloadEntries() {
  const out = []
  for (const entry of _files.values()) out.push({ ...entry })
  return out
}

/**
 * Names a file BEFORE anything asks for it, without enqueueing a download —
 * so a file the playback scheduler pulls in on its own still shows up in the
 * queue as "Intro music" rather than an opaque id.
 */
export function describeDownload(fileId, { name, kind } = {}) {
  if (!fileId) return
  const prev = _meta.get(fileId) ?? {}
  _meta.set(fileId, { name: name || prev.name, kind: kind || prev.kind })
  const entry = _files.get(fileId)
  if (!entry) return
  if (name && !entry.name) { entry.name = name; _notify() }
}

/** The live progress of one file, or null when it was never requested. */
export function downloadEntry(fileId) {
  const entry = _files.get(fileId)
  return entry ? { ...entry } : null
}

/** Moves a file to a later stage of the same request (e.g. bytes in → decoding). */
export function markDownloadStage(fileId, status) {
  const entry = _files.get(fileId)
  if (!entry || entry.status === 'ready' || entry.status === 'error') return
  entry.status = status
  _notify(true)
}

export function markDownloadDone(fileId) {
  const entry = _files.get(fileId)
  if (!entry) return
  entry.status     = 'ready'
  entry.error      = null
  entry.finishedAt = Date.now()
  if (entry.total) entry.loaded = entry.total
  _notify(true)
}

export function markDownloadFailed(fileId, message) {
  const entry = _files.get(fileId)
  if (!entry) return
  entry.status     = 'error'
  entry.error      = message || 'Download failed'
  entry.finishedAt = Date.now()
  _notify(true)
}

/** Drops a finished or failed entry from the queue (the island's dismiss). */
export function dismissDownload(fileId) {
  const entry = _files.get(fileId)
  if (!entry || entry.status === 'downloading' || entry.status === 'decoding') return
  _files.delete(fileId)
  _notify(true)
}

/** Drops every entry that is no longer in flight. */
export function dismissFinishedDownloads() {
  let changed = false
  for (const [fileId, entry] of _files) {
    if (entry.status === 'ready' || entry.status === 'error') { _files.delete(fileId); changed = true }
  }
  if (changed) _notify(true)
}

/**
 * Fetches a file, reporting progress into the registry, and resolves with its
 * bytes. The entry is left in `downloading` — the caller decides when the file
 * is actually usable (audio still has to decode) and calls `markDownloadDone`.
 * Failures mark the entry and re-throw, so callers keep their own error paths.
 */
export async function fetchTracked(fileId, url, meta = {}) {
  const entry = _ensure(fileId, meta)
  entry.status     = 'downloading'
  entry.loaded     = 0
  entry.total      = 0
  entry.error      = null
  entry.startedAt  = Date.now()
  entry.finishedAt = null
  _notify(true)

  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    entry.total    = Number(res.headers?.get?.('content-length')) || 0
    entry.mimeType = res.headers?.get?.('content-type') || ''

    const reader = res.body?.getReader?.()
    if (!reader) {
      // No streaming body available — one buffered read, indeterminate progress.
      const buffer = await res.arrayBuffer()
      entry.loaded = entry.total = buffer?.byteLength || entry.total
      _notify(true)
      return buffer
    }

    const chunks = []
    let loaded   = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      entry.loaded = loaded
      // A missing or short Content-Length must never produce >100%.
      if (loaded > entry.total) entry.total = loaded
      _notify()
    }

    const bytes = new Uint8Array(loaded)
    let at = 0
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength }
    entry.total = loaded
    _notify(true)
    return bytes.buffer
  } catch (err) {
    markDownloadFailed(fileId, err?.message)
    throw err
  }
}

/**
 * Returns (and caches) a `blob:` URL for a stored file — how image clips get a
 * src that also reports progress. Fetching the bytes ourselves is what buys the
 * progress bar; `<img src="/api/…">` would download the same file invisibly.
 */
export function getMediaObjectUrl(fileId, { quality = null, name = '', kind = 'image' } = {}) {
  const key = quality == null ? fileId : `${fileId}@${quality}`
  if (!_objectUrls.has(key)) {
    const url = `/api/storage/${fileId}/serve${quality == null ? '' : `?quality=${quality}`}`
    const promise = fetchTracked(fileId, url, { name, kind })
      .then(buffer => {
        const entry = _files.get(fileId)
        const blob  = new Blob([buffer], entry?.mimeType ? { type: entry.mimeType } : undefined)
        markDownloadDone(fileId)
        return URL.createObjectURL(blob)
      })
      .catch(err => { _objectUrls.delete(key); throw err })
    _objectUrls.set(key, promise)
  }
  return _objectUrls.get(key)
}

/**
 * Forgets everything and releases the object URLs. Called when the editor
 * unmounts, alongside the audio and waveform caches it is paired with — those
 * hold the decoded results of these same downloads.
 */
export function resetDownloads() {
  for (const promise of _objectUrls.values()) {
    promise.then(url => URL.revokeObjectURL(url)).catch(() => {})
  }
  _objectUrls.clear()
  _files.clear()
  _meta.clear()
  _notify(true)
}

/** Compact byte size for the download island ("4.2 MB"). */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}
