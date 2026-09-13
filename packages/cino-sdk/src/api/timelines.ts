import type { Http } from '../core/http.ts';
import type { Timeline, TimelineInput } from '../types.ts';

/** The timelines in a production. Work with one through `cino.timeline(id)`. */
export class TimelinesApi {
  readonly #http: Http;
  readonly #productionId: string;

  constructor(http: Http, productionId: string) {
    this.#http = http;
    this.#productionId = productionId;
  }

  list(): Promise<Timeline[]> {
    return this.#http.json('GET', '/timelines', { query: { pid: this.#productionId } });
  }

  /** Needs MANAGE_TIMELINES. */
  create(input: TimelineInput): Promise<Timeline> {
    return this.#http.json('POST', '/timelines', { query: { pid: this.#productionId }, body: input });
  }

  /** A timeline by name, ignoring case and surrounding spaces. */
  async find(name: string): Promise<Timeline | null> {
    const wanted = name.trim().toLowerCase();
    return (await this.list()).find(timeline => timeline.name.trim().toLowerCase() === wanted) ?? null;
  }
}
