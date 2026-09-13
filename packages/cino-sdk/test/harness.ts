// Timers inside the SDK are unref'd, and fakes hold nothing open, so keep the process alive until finish().
const keepAlive = setInterval(() => {}, 1000);
let failed = 0;

export function section(name: string): void {
  console.log(`\n${name}`);
}

export async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(err as Error).stack ?? (err as Error).message}`);
  }
}

export function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}

export function near(actual: number | null | undefined, expected: number, tolerance: number, what = ''): void {
  if (actual == null || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${what} expected ≈${expected}, got ${String(actual)}`);
  }
}

export function ok(value: unknown, what: string): void {
  if (!value) throw new Error(`${what} expected truthy, got ${String(value)}`);
}

export async function rejects(promise: Promise<unknown>, what: string): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error(`${what} expected a rejection`);
}

export async function until(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

export function finish(): never {
  clearInterval(keepAlive);
  console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
  process.exit(failed ? 1 : 0);
}
