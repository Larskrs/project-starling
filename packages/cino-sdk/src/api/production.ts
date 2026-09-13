import { encode, type Http } from '../core/http.ts';
import { formWith, type UploadSource } from '../core/upload.ts';
import type { Dashboard, ImageSlot, Member, ProductionInfo, Role } from '../types.ts';
import { SourceSetsApi } from './sources.ts';
import { StorageApi } from './storage.ts';
import { TimelinesApi } from './timelines.ts';
import { TrackTypesApi } from './trackTypes.ts';

/** Everything scoped to one production. A token reaches only the production it was issued for. */
export class ProductionApi {
  readonly id: string;
  readonly timelines: TimelinesApi;
  readonly trackTypes: TrackTypesApi;
  readonly sourceSets: SourceSetsApi;
  readonly storage: StorageApi;
  readonly #http: Http;
  readonly #path: string;

  constructor(http: Http, productionId: string) {
    this.id = productionId;
    this.#http = http;
    this.#path = `/production/${encode(productionId)}`;
    this.timelines = new TimelinesApi(http, productionId);
    this.trackTypes = new TrackTypesApi(http, productionId);
    this.sourceSets = new SourceSetsApi(http, productionId);
    this.storage = new StorageApi(http, productionId);
  }

  get(): Promise<ProductionInfo> {
    return this.#http.json('GET', this.#path);
  }

  /** Counts, recent files, recent members and recently edited timelines. */
  dashboard(): Promise<Dashboard> {
    return this.#http.json('GET', `${this.#path}/dashboard`);
  }

  members(): Promise<Member[]> {
    return this.#http.json('GET', `${this.#path}/members`);
  }

  roles(): Promise<Role[]> {
    return this.#http.json('GET', `${this.#path}/roles`);
  }

  setImage(slot: ImageSlot, image: UploadSource): Promise<{ fileId: string; slot: ImageSlot; versions: number }> {
    return this.#http.json('POST', `${this.#path}/profile`, { form: formWith({ slot }, image) });
  }
}
