/**
 * Regression guard for the editor's undo/redo stack.
 *
 *     node apps/web/src/views/TimelineEditor/lib/editHistory.test.ts
 *
 * (Standalone, same convention as the other TimelineEditor tests — the repo has
 * no test runner. Exits non-zero on failure.)
 */

interface IdResolver { resolve(id: string): string; alias(from: string, to: string): void }
interface Entry { undo(ids: IdResolver): Promise<boolean>; redo(ids: IdResolver): Promise<boolean> }
export {};   // a module, so these names don't collide with the other test scripts

interface EditHistoryApi {
  push(entry: Entry): void
  undo(): Promise<boolean>
  redo(): Promise<boolean>
  undoIfLatest(entry: Entry): Promise<boolean>
  clear(): void
  ids: IdResolver
  state(): { canUndo: boolean; canRedo: boolean }
}

const mod = await import(process.argv[2] ?? './editHistory.ts');
const { createEditHistory, combineEntries } = mod as {
  createEditHistory: (opts?: { limit?: number }) => EditHistoryApi;
  combineEntries: (entries: Entry[]) => Entry;
};

let failed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what} expected ${e}, got ${a}`);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** An entry that logs `<name>:undo` / `<name>:redo` and reports `ok`. */
function entry(log: string[], name: string, ok = true): Entry {
  return {
    undo: async () => { log.push(`${name}:undo`); return ok; },
    redo: async () => { log.push(`${name}:redo`); return ok; },
  };
}

console.log('\nundo / redo');

await check('undo then redo runs each step and moves the entry across', async () => {
  const log: string[] = [];
  const h = createEditHistory();
  eq(h.state(), { canUndo: false, canRedo: false }, 'empty:');
  h.push(entry(log, 'a'));
  eq(h.state(), { canUndo: true, canRedo: false }, 'pushed:');
  eq(await h.undo(), true, 'undo result:');
  eq(h.state(), { canUndo: false, canRedo: true }, 'undone:');
  eq(await h.redo(), true, 'redo result:');
  eq(h.state(), { canUndo: true, canRedo: false }, 'redone:');
  eq(log, ['a:undo', 'a:redo']);
});

await check('undo on an empty stack does nothing', async () => {
  eq(await createEditHistory().undo(), false);
});

await check('a new edit clears the redo stack', async () => {
  const log: string[] = [];
  const h = createEditHistory();
  h.push(entry(log, 'a'));
  await h.undo();
  h.push(entry(log, 'b'));
  eq(h.state().canRedo, false);
  eq(await h.redo(), false);
});

await check('a failed step is dropped, not moved to the other stack', async () => {
  const h = createEditHistory();
  h.push(entry([], 'a', false));
  eq(await h.undo(), false);
  eq(h.state(), { canUndo: false, canRedo: false });
});

await check('a throwing step counts as a failure', async () => {
  const h = createEditHistory();
  h.push({ undo: async () => { throw new Error('boom'); }, redo: async () => true });
  eq(await h.undo(), false);
  eq(h.state(), { canUndo: false, canRedo: false });
});

await check('steps run one at a time, newest first', async () => {
  const log: string[] = [];
  const h = createEditHistory();
  h.push(entry(log, 'a'));
  h.push({
    undo: async () => { log.push('b:start'); await sleep(20); log.push('b:end'); return true; },
    redo: async () => true,
  });
  await Promise.all([h.undo(), h.undo()]);
  eq(log, ['b:start', 'b:end', 'a:undo']);
});

await check('the limit forgets the oldest entries', async () => {
  const log: string[] = [];
  const h = createEditHistory({ limit: 2 });
  h.push(entry(log, 'a'));
  h.push(entry(log, 'b'));
  h.push(entry(log, 'c'));
  await h.undo(); await h.undo(); await h.undo();
  eq(log, ['c:undo', 'b:undo']);
});

await check('undoIfLatest refuses once something newer happened', async () => {
  const log: string[] = [];
  const h = createEditHistory();
  const a = entry(log, 'a');
  const b = entry(log, 'b');
  h.push(a);
  h.push(b);
  eq(await h.undoIfLatest(a), false, 'stale:');
  eq(log, [], 'nothing ran:');
  eq(await h.undoIfLatest(b), true, 'latest:');
  eq(log, ['b:undo']);
});

console.log('\ncombineEntries');

await check('a combined step runs every part as one undo', async () => {
  const log: string[] = [];
  const h = createEditHistory();
  h.push(combineEntries([entry(log, 'a'), entry(log, 'b')]));
  eq(await h.undo(), true);
  eq(log.sort(), ['a:undo', 'b:undo']);
  eq(h.state(), { canUndo: false, canRedo: true });
});

await check('one failing part fails the combined step', async () => {
  const log: string[] = [];
  const h = createEditHistory();
  h.push(combineEntries([entry(log, 'a'), entry(log, 'b', false)]));
  eq(await h.undo(), false);
  eq(h.state(), { canUndo: false, canRedo: false });
});

await check('a single entry is passed through unchanged', () => {
  const only = entry([], 'a');
  eq(combineEntries([only]) === only, true);
});

console.log('\nids');

await check('aliases chain from any id a clip has had', () => {
  const { ids } = createEditHistory();
  ids.alias('orig', 'second');
  ids.alias('second', 'third');
  eq(ids.resolve('orig'), 'third');
  eq(ids.resolve('second'), 'third');
  eq(ids.resolve('unrelated'), 'unrelated');
});

await check('a cycle cannot hang resolve', () => {
  const { ids } = createEditHistory();
  ids.alias('a', 'b');
  ids.alias('b', 'a');
  ids.resolve('a');   // returns at all = pass
});

await check('clear forgets entries and aliases', async () => {
  const h = createEditHistory();
  h.push(entry([], 'a'));
  h.ids.alias('x', 'y');
  h.clear();
  eq(h.state(), { canUndo: false, canRedo: false });
  eq(h.ids.resolve('x'), 'x');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
