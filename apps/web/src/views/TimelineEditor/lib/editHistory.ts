/**
 * Undo/redo for the timeline editor.
 *
 * Every entry is a pair of async steps that talk to the API — the server is the
 * source of truth and live sync relays each step to peers like any other edit.
 * A step reports whether it landed; one that fails (the clip was deleted by a
 * peer, the track got locked) is DROPPED rather than moved to the other stack,
 * because the state it describes no longer exists and retrying it would only
 * fail again.
 *
 * Re-creating a deleted clip gives it a NEW id, which would orphan every older
 * entry that still names the old one. Steps therefore never use a clip id
 * directly: they pass it through `ids.resolve`, and a re-create registers
 * `ids.alias(oldId, newId)`. Aliases chain, so a clip deleted and restored many
 * times still resolves from any id it has ever had.
 *
 * Steps run strictly one at a time. Hammering Ctrl+Z fires a burst of requests;
 * serialising them keeps the second undo from racing the first one's response.
 *
 * Deliberately free of Vue so it can be tested in bare node.
 */

export interface IdResolver {
  /** The live id for any id the clip has ever had. */
  resolve(id: string): string
  /** Record that `from` now lives on as `to`. */
  alias(from: string, to: string): void
}

export interface HistoryEntry {
  undo(ids: IdResolver): Promise<boolean>
  redo(ids: IdResolver): Promise<boolean>
}

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
}

export interface EditHistoryOptions {
  /** Oldest entries are forgotten beyond this many. */
  limit?: number
  onChange?: (state: HistoryState) => void
}

export function createEditHistory({ limit = 100, onChange }: EditHistoryOptions = {}) {
  const done: HistoryEntry[]   = []
  const undone: HistoryEntry[] = []
  const aliases = new Map<string, string>()
  let queue: Promise<unknown> = Promise.resolve()

  const ids: IdResolver = {
    resolve(id) {
      let current = id
      const seen = new Set<string>()
      while (aliases.has(current) && !seen.has(current)) {
        seen.add(current)
        current = aliases.get(current)!
      }
      return current
    },
    alias(from, to) {
      if (from !== to) aliases.set(from, to)
    },
  }

  const state = (): HistoryState => ({ canUndo: done.length > 0, canRedo: undone.length > 0 })
  const notify = (): void => onChange?.(state())

  /** Record an edit that has already been applied. Clears the redo stack. */
  function push(entry: HistoryEntry): void {
    done.push(entry)
    if (done.length > limit) done.shift()
    undone.length = 0
    notify()
  }

  function step(from: HistoryEntry[], to: HistoryEntry[], action: 'undo' | 'redo'): Promise<boolean> {
    const run = queue.then(async () => {
      const entry = from.pop()
      if (!entry) return false
      notify()
      let ok = false
      try { ok = await entry[action](ids) } catch { ok = false }
      if (ok) { to.push(entry); notify() }
      return ok
    })
    queue = run.catch(() => {})
    return run
  }

  const undo = (): Promise<boolean> => step(done, undone, 'undo')
  const redo = (): Promise<boolean> => step(undone, done, 'redo')

  /**
   * Undo `entry` only while it is still the latest edit. For an "Undo" button
   * on a toast: once something newer happened, pressing it must not quietly
   * revert that newer edit instead.
   */
  function undoIfLatest(entry: HistoryEntry): Promise<boolean> {
    return done[done.length - 1] === entry ? undo() : Promise.resolve(false)
  }

  function clear(): void {
    done.length = 0
    undone.length = 0
    aliases.clear()
    notify()
  }

  return { push, undo, redo, undoIfLatest, clear, ids, state }
}

export type EditHistory = ReturnType<typeof createEditHistory>

/**
 * Several edits made as one gesture (moving or deleting a multi-clip selection)
 * as a single undo step. Parts run in parallel; the step counts as landed only
 * if every part did — a partial one is dropped like any failed step, since
 * redoing the parts that worked would no longer match what was undone.
 */
export function combineEntries(entries: HistoryEntry[]): HistoryEntry {
  if (entries.length === 1) return entries[0]!
  return {
    undo: async (ids) => (await Promise.all(entries.map(e => e.undo(ids)))).every(Boolean),
    redo: async (ids) => (await Promise.all(entries.map(e => e.redo(ids)))).every(Boolean),
  }
}
