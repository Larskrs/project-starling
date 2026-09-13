import { encode, type Http } from '../core/http.ts';
import { formWith, type UploadSource } from '../core/upload.ts';
import type { FileType, Folder, FolderInput, FolderListing, ImageVersion, StorageStats, StoredFile, UploadResult } from '../types.ts';

export interface UploadOptions {
  folderId?: string | null;
  /** Overrides the file name, and is required for a Blob without one. */
  name?: string;
}

export interface FileOpenOptions {
  /** For images: the stored quality closest to this, 1–100. */
  quality?: number;
  /** Bytes to fetch, inclusive: `[start, end]`, or `[start]` for the rest. */
  range?: readonly [number, number?];
  signal?: AbortSignal;
}

/** A production's storage. Reading needs VIEW; writing needs MANAGE_STORAGE. Images and audio only. */
export class StorageApi {
  readonly #http: Http;
  readonly #productionId: string;

  constructor(http: Http, productionId: string) {
    this.#http = http;
    this.#productionId = productionId;
  }

  /** Folders and files directly inside a folder, or at the top level. */
  list(folderId: string | null = null): Promise<FolderListing> {
    return this.#http.json('GET', '/storage', { query: { pid: this.#productionId, folder_id: folderId } });
  }

  /** Every file in the production, optionally of one type. */
  files(type?: FileType): Promise<StoredFile[]> {
    return this.#http.json('GET', `/production/${encode(this.#productionId)}/files`, { query: { type } });
  }

  stats(): Promise<StorageStats> {
    return this.#http.json('GET', `/production/${encode(this.#productionId)}/storage-stats`);
  }

  async createFolder({ name, parentId = null, hue = null }: FolderInput): Promise<Folder> {
    const { folder } = await this.#http.json<{ folder: Folder }>('POST', '/storage', {
      body: { production_id: this.#productionId, name, parent_id: parentId, hue },
    });
    return folder;
  }

  upload(file: UploadSource, { folderId, name }: UploadOptions = {}): Promise<UploadResult> {
    const form = formWith({ production_id: this.#productionId, folder_id: folderId ?? undefined }, file, name);
    return this.#http.json('POST', '/storage/upload', { form });
  }
}

/** Any stored file this token can see, by id. */
export class FilesApi {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  get(fileId: string): Promise<{ file: StoredFile; versions?: ImageVersion[] }> {
    return this.#http.json('GET', `/storage/${encode(fileId)}`);
  }

  async update(fileId: string, { name, folderId }: { name?: string; folderId?: string | null }): Promise<void> {
    await this.#http.json('PATCH', `/storage/${encode(fileId)}`, { body: { name, folder_id: folderId } });
  }

  rename(fileId: string, name: string): Promise<void> {
    return this.update(fileId, { name });
  }

  move(fileId: string, folderId: string | null): Promise<void> {
    return this.update(fileId, { folderId });
  }

  async remove(fileId: string): Promise<void> {
    await this.#http.json('DELETE', `/storage/${encode(fileId)}`);
  }

  /** The file's bytes as a Response, for streaming. Images are served as WebP. */
  open(fileId: string, { quality, range, signal }: FileOpenOptions = {}): Promise<Response> {
    const headers = range ? { Range: `bytes=${range[0]}-${range[1] ?? ''}` } : undefined;
    return this.#http.fetch('GET', `/storage/${encode(fileId)}/serve`, { query: { quality }, headers, signal });
  }

  async download(fileId: string, options?: FileOpenOptions): Promise<ArrayBuffer> {
    return (await this.open(fileId, options)).arrayBuffer();
  }
}

export class FoldersApi {
  readonly #http: Http;

  constructor(http: Http) {
    this.#http = http;
  }

  async update(folderId: string, patch: { name?: string; hue?: number | null }): Promise<Folder> {
    const { folder } = await this.#http.json<{ folder: Folder }>('PATCH', `/storage/folders/${encode(folderId)}`, { body: patch });
    return folder;
  }

  /** Removes the folder, its subfolders and every file in them. */
  async remove(folderId: string): Promise<{ filesRemoved: number }> {
    const { filesRemoved } = await this.#http.json<{ filesRemoved: number }>('DELETE', `/storage/folders/${encode(folderId)}`);
    return { filesRemoved };
  }
}
