import { encode, type Http } from '../core/http.ts';
import type { PresetInput, PresetResult, TrackType, TrackTypeInput, TrackTypePatch, TrackTypePreset } from '../types.ts';

/** A production's track types. Writes need MANAGE_TRACK_TYPES. */
export class TrackTypesApi {
  readonly #http: Http;
  readonly #path: string;

  constructor(http: Http, productionId: string) {
    this.#http = http;
    this.#path = `/production/${encode(productionId)}`;
  }

  list(): Promise<TrackType[]> {
    return this.#http.json('GET', `${this.#path}/track-types`);
  }

  create(input: TrackTypeInput): Promise<TrackType> {
    return this.#http.json('POST', `${this.#path}/track-types`, { body: input });
  }

  update(typeId: string, patch: TrackTypePatch): Promise<TrackType> {
    return this.#http.json('PATCH', `${this.#path}/track-types/${encode(typeId)}`, { body: patch });
  }

  async remove(typeId: string): Promise<void> {
    await this.#http.json('DELETE', `${this.#path}/track-types/${encode(typeId)}`);
  }

  /** Ready-made track types: camera, script, music, … */
  presets(): Promise<TrackTypePreset[]> {
    return this.#http.json('GET', `${this.#path}/track-type-presets`);
  }

  fromPreset(input: PresetInput): Promise<PresetResult> {
    return this.#http.json('POST', `${this.#path}/track-types/from-preset`, { body: input });
  }
}
