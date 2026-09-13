import { encode, type Http, type SocketIdSource } from '../core/http.ts';
import { formWith, type UploadSource } from '../core/upload.ts';
import type { LiveOptions, LiveTimeline } from '../live/liveTimeline.ts';
import type { Timeline, TimelinePatch, TimelineSnapshot } from '../types.ts';
import { ClipsApi } from './clips.ts';
import { TracksApi } from './tracks.ts';

export type LiveConnector = (options?: LiveOptions) => LiveTimeline;

/** One timeline over REST. `connect()` follows it live. */
export class TimelineApi {
  readonly id: string;
  readonly tracks: TracksApi;
  readonly clips: ClipsApi;
  readonly #http: Http;
  readonly #path: string;
  readonly #connect: LiveConnector;

  constructor(http: Http, timelineId: string, connect: LiveConnector, socketId?: SocketIdSource) {
    this.id = timelineId;
    this.#http = http;
    this.#path = `/timeline/${encode(timelineId)}`;
    this.#connect = connect;
    this.tracks = new TracksApi(http, timelineId, socketId);
    this.clips = new ClipsApi(http, timelineId, socketId);
  }

  /** The whole timeline: tracks with their clips, track types, sources, and whether this token may edit. */
  get(): Promise<TimelineSnapshot> {
    return this.#http.json('GET', this.#path);
  }

  /** Needs MANAGE_TIMELINES. */
  update(patch: TimelinePatch): Promise<Timeline> {
    return this.#http.json('PATCH', this.#path, { body: patch });
  }

  /** Needs MANAGE_TIMELINES. */
  async remove(): Promise<void> {
    await this.#http.json('DELETE', this.#path);
  }

  /** Needs MANAGE_TIMELINES. */
  setImage(image: UploadSource): Promise<{ fileId: string; versions: number }> {
    return this.#http.json('POST', `${this.#path}/profile`, { form: formWith({}, image) });
  }

  connect(options?: LiveOptions): LiveTimeline {
    return this.#connect(options);
  }
}
