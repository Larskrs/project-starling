import { encode, type Http } from '../core/http.ts';
import type { Source, SourceInput, SourcePatch, SourceSet, SourceSetInput } from '../types.ts';

/** A production's source sets, e.g. its cameras. Writes need MANAGE_TRACK_TYPES. */
export class SourceSetsApi {
  readonly #http: Http;
  readonly #path: string;

  constructor(http: Http, productionId: string) {
    this.#http = http;
    this.#path = `/production/${encode(productionId)}`;
  }

  list(): Promise<SourceSet[]> {
    return this.#http.json('GET', `${this.#path}/source-sets`);
  }

  create(input: SourceSetInput): Promise<SourceSet> {
    return this.#http.json('POST', `${this.#path}/source-sets`, { body: input });
  }

  update(setId: string, patch: Partial<SourceSetInput>): Promise<SourceSet> {
    return this.#http.json('PATCH', `${this.#path}/source-sets/${encode(setId)}`, { body: patch });
  }

  async remove(setId: string): Promise<void> {
    await this.#http.json('DELETE', `${this.#path}/source-sets/${encode(setId)}`);
  }

  /** The sources in one set. */
  sources(setId: string): SourcesApi {
    return new SourcesApi(this.#http, this.#path, setId);
  }
}

export class SourcesApi {
  readonly setId: string;
  readonly #http: Http;
  readonly #path: string;

  constructor(http: Http, productionPath: string, setId: string) {
    this.setId = setId;
    this.#http = http;
    this.#path = `${productionPath}/sources`;
  }

  list(): Promise<Source[]> {
    return this.#http.json('GET', this.#path, { query: { sid: this.setId } });
  }

  create(input: SourceInput): Promise<Source> {
    return this.#http.json('POST', this.#path, { query: { sid: this.setId }, body: input });
  }

  update(sourceId: string, patch: SourcePatch): Promise<Source> {
    return this.#http.json('PATCH', `${this.#path}/${encode(sourceId)}`, { body: patch });
  }

  async remove(sourceId: string): Promise<void> {
    await this.#http.json('DELETE', `${this.#path}/${encode(sourceId)}`);
  }
}
