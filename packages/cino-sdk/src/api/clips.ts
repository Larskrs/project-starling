import { encode, type Http, type Method, type SocketIdSource } from '../core/http.ts';
import type { ClipInput, ClipPatch, ClipRecord } from '../types.ts';

/** A timeline's clips. Writes need EDIT_TIMELINE, except relabelling, which RENAME_CLIPS allows. */
export class ClipsApi {
  readonly #http: Http;
  readonly #path: string;
  readonly #socketId: SocketIdSource | undefined;

  constructor(http: Http, timelineId: string, socketId?: SocketIdSource) {
    this.#http = http;
    this.#path = `/timeline/${encode(timelineId)}/clips`;
    this.#socketId = socketId;
  }

  create(input: ClipInput): Promise<ClipRecord> {
    return this.#write('POST', this.#path, input);
  }

  update(clipId: string, patch: ClipPatch): Promise<ClipRecord> {
    return this.#write('PATCH', `${this.#path}/${encode(clipId)}`, patch);
  }

  rename(clipId: string, label: string): Promise<ClipRecord> {
    return this.update(clipId, { label });
  }

  move(clipId: string, position: number): Promise<ClipRecord> {
    return this.update(clipId, { position: Math.round(position) });
  }

  async remove(clipId: string): Promise<void> {
    await this.#write('DELETE', `${this.#path}/${encode(clipId)}`);
  }

  #write<T>(method: Method, path: string, body?: unknown): Promise<T> {
    return this.#http.json<T>(method, path, { body, socketId: this.#socketId?.() });
  }
}
