import { io as socketIo } from 'socket.io-client';
import { ProductionApi } from './api/production.ts';
import { FilesApi, FoldersApi } from './api/storage.ts';
import { TimelineApi } from './api/timeline.ts';
import { Http, normaliseUrl } from './core/http.ts';
import { createLiveTimeline, type LiveOptions, type LiveTimeline, type SocketFactory } from './live/liveTimeline.ts';

export interface CinoOptions {
  /** The Cino server, e.g. `https://cino.no`. */
  url: string;
  /** An API token, from the production's settings under Integrations. */
  token: string;
  /** Replaces the global fetch. */
  fetch?: typeof fetch;
  /** Give up on a request whose response has not started after this many ms. 0 waits forever. Default 30 000. */
  timeoutMs?: number;
  /** Replaces socket.io-client's `io`. */
  io?: SocketFactory;
}

/**
 * The Cino API, with one token.
 *
 * ```ts
 * const cino = new Cino({ url: 'https://cino.no', token });
 * const live = cino.connect(timelineId);
 * live.onTrack('Cameras', ({ clip }) => mixer.cut(live.source(clip?.sourceId)?.shortName));
 * ```
 */
export class Cino {
  readonly url: string;
  /** Stored files by id. */
  readonly files: FilesApi;
  readonly folders: FoldersApi;
  readonly #http: Http;
  readonly #io: SocketFactory;

  constructor({ url, token, fetch, timeoutMs, io }: CinoOptions) {
    if (!token) throw new TypeError('cino-sdk: a token is required');
    this.url = normaliseUrl(url);
    this.#http = new Http({ baseUrl: this.url, token, fetch, timeoutMs });
    this.#io = io ?? socketIo;
    this.files = new FilesApi(this.#http);
    this.folders = new FoldersApi(this.#http);
  }

  /** The token's expiry, known after the first response. */
  get tokenExpiresAt(): Date | null {
    return this.#http.tokenExpiresAt;
  }

  onTokenExpiry(listener: (expiresAt: Date) => void): () => void {
    return this.#http.onTokenExpiry(listener);
  }

  production(productionId: string): ProductionApi {
    return new ProductionApi(this.#http, productionId);
  }

  timeline(timelineId: string): TimelineApi {
    return new TimelineApi(this.#http, timelineId, options => this.connect(timelineId, options));
  }

  /** Follow a timeline live: tracks, clips, the transport and the server clock. */
  connect(timelineId: string, options?: LiveOptions): LiveTimeline {
    return createLiveTimeline({ http: this.#http, io: this.#io, timelineId, options });
  }
}
