/**
 * The clock every live timestamp is read from: transport anchors, clock sync
 * stamps, and the `time:ping` reply clients measure their offset against.
 *
 * Monotonic, not `Date.now()`. Clients compute positions as
 * `frame + (serverNow − at) × fps` against an offset they measured earlier, so
 * the server's clock must not move under them. The wall clock does: NTP steps
 * it, a VM migration steps it, an operator sets it — and every client's offset
 * is then wrong by the size of the step until it next measures, which is every
 * playhead in every room off by the same amount at once.
 *
 * Anchored to `timeOrigin`, so readings still look like epoch milliseconds and
 * stay close to the wall clock. They drift from it over uptime and re-align (a
 * small jump) when the process restarts — which clients catch, because a
 * restart is also a reconnect, and a reconnect re-measures.
 */
const origin = performance.timeOrigin;

export function serverNow(): number {
  return origin + performance.now();
}
