/**
 * Regression guard for the media download registry.
 *
 *     node apps/web/src/views/TimelineEditor/mediaDownloads.test.ts
 *
 * (Standalone, same convention as useAudioEngine.test.ts — the repo has no
 * test runner, and this module is deliberately Vue-free so it runs in bare
 * node. Exits non-zero on failure. Pass an alternative module path as argv[2].)
 *
 * The behaviour worth pinning down is the TTL prune. Without it the registry is
 * a session-long log rather than a queue: the playback scheduler pulls in each
 * new file as the playhead reaches it, so on a busy timeline something is
 * nearly always in flight, the download island would never fall idle, and the
 * list would climb into the hundreds. Failures are exempt — an unplayable clip
 * has to stay until someone acknowledges it.
 */

const CHUNKS = [new Uint8Array(400), new Uint8Array(600)]

// Streaming fetch with a Content-Length, so progress is a real fraction.
globalThis.fetch = (async () => ({
  ok: true,
  headers: { get: (h: string) => (h === 'content-length' ? '1000' : 'audio/wav') },
  body: {
    getReader() {
      let i = 0
      return { read: async () => (i < CHUNKS.length ? { done: false, value: CHUNKS[i++] } : { done: true }) }
    },
  },
// The stub only implements what fetchTracked touches; the cast keeps the
// global's real signature without hand-writing a whole Response.
})) as unknown as typeof fetch

const registry = await import(
  process.argv[2] ?? './mediaDownloads.ts'
)

let allOk = true
function check(label: string, condition: unknown, detail = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) allOk = false
}

let notifications = 0
registry.subscribeDownloads(() => { notifications++ })

// ── 1. A transfer reports its bytes and stays "downloading" until told ────────
registry.describeDownload('f1', { name: 'Intro music', kind: 'audio' })
const bytes = await registry.fetchTracked('f1', '/serve/f1', { kind: 'audio' })
const fetched = registry.downloadEntry('f1')

check('chunks assemble into one buffer', bytes.byteLength === 1000, `${bytes.byteLength} B`)
check('progress and metadata recorded',
  fetched.loaded === 1000 && fetched.total === 1000 && fetched.name === 'Intro music')
// The caller owns completion: audio still has to decode after the last byte.
check('still in flight until the caller completes it', fetched.status === 'downloading')

registry.markDownloadStage('f1', 'decoding')
check('decode stage applies', registry.downloadEntry('f1').status === 'decoding')

registry.markDownloadDone('f1')
check('ready once completed', registry.downloadEntry('f1').status === 'ready')
check('completed entry lingers so the bar can land on 100%', registry.downloadEntries().length === 1)

// ── 2. A failure is recorded ─────────────────────────────────────────────────
await registry.fetchTracked('f2', '/serve/f2', { kind: 'audio' })
registry.markDownloadFailed('f2', 'boom')
check('failure recorded', registry.downloadEntry('f2').status === 'error')

// ── 3. The TTL prune: completed entries age out, failures don't ──────────────
console.log('\nwaiting out READY_TTL…')
await new Promise(r => setTimeout(r, 4600))

check('completed entry is pruned', registry.downloadEntry('f1') === null)
check('failed entry survives the prune', registry.downloadEntry('f2')?.status === 'error')
check('queue holds only the failure', registry.downloadEntries().length === 1)
check('subscribers were notified throughout', notifications > 0, `${notifications} notifications`)

registry.dismissDownload('f2')
check('a failure can be dismissed by hand', registry.downloadEntries().length === 0)

registry.resetDownloads()
console.log(allOk ? '\nAll checks passed.' : '\nFAILURES above.')
process.exit(allOk ? 0 : 1)

// Top-level await + isolated scope: this makes the script a module rather
// than a global script sharing names with its siblings.
export {}
