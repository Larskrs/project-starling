import { encode, type Http, type Method, type SocketIdSource } from '../core/http.ts';
import type { TrackInput, TrackPatch, TrackRecord } from '../types.ts';

/** A timeline's tracks. Writes need EDIT_TIMELINE; a locked track refuses them with 423. */
export class TracksApi {
  readonly #http: Http;
  readonly #path: string;
  readonly #socketId: SocketIdSource | undefined;

  constructor(http: Http, timelineId: string, socketId?: SocketIdSource) {
    this.#http = http;
    this.#path = `/timeline/${encode(timelineId)}/tracks`;
    this.#socketId = socketId;
  }

  list(): Promise<TrackRecord[]> {
    return this.#http.json('GET', this.#path);
  }

  create(input: TrackInput): Promise<TrackRecord> {
    return this.#write('POST', this.#path, input);
  }

  update(trackId: string, patch: TrackPatch): Promise<TrackRecord> {
    return this.#write('PATCH', `${this.#path}/${encode(trackId)}`, patch);
  }

  async remove(trackId: string): Promise<void> {
    await this.#write('DELETE', `${this.#path}/${encode(trackId)}`);
  }

  /** Resolves to the order applied: unknown ids are dropped, missing tracks keep their place. */
  async reorder(trackIds: readonly string[]): Promise<string[]> {
    const { order } = await this.#write<{ order: string[] }>('POST', `${this.#path}/reorder`, { order: trackIds });
    return order;
  }

  #write<T>(method: Method, path: string, body?: unknown): Promise<T> {
    return this.#http.json<T>(method, path, { body, socketId: this.#socketId?.() });
  }
}
