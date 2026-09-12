import { SOCKET_ID_HEADER } from '@starling/realtime'

/**
 * The current live socket's id, shared with every REST mutation.
 *
 * The server relays a write to the room the instant it persists it, which means
 * it has to know who NOT to send it back to. On a socket-initiated relay that
 * is implicit; over HTTP the request carries no socket identity, so the client
 * supplies it in a header and the server excludes that socket from the fan-out.
 *
 * Module-level rather than passed around: `useApi` is used from dozens of call
 * sites that have no idea a socket exists, and threading an id through all of
 * them to serve one header would be worse than a single well-named global.
 *
 * Unset is the correct state most of the time — outside the editor there is no
 * socket, and the header is simply omitted. The server treats its absence as
 * "echo to everyone", which is idempotent.
 */
let socketId: string | null = null

export function setLiveSocketId(id: string | null): void {
  socketId = id
}

export function liveSocketHeaders(): Record<string, string> {
  return socketId ? { [SOCKET_ID_HEADER]: socketId } : {}
}
