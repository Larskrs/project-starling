import { useApi, type FetchResult } from '../../composables/useApi'
import {
  FILE, FOLDER,
  type FileNode, type FolderNode, type StorageFile, type StorageFolder, type StorageNode,
} from '../../types/storage'

/**
 * Every /api/storage call the browser makes, in one place.
 *
 * Files and folders are addressed by different routes but are the same thing
 * to the UI — a node you can rename, move or delete. Rows carry `kind` so one
 * set of actions covers both; `nodeUrl` is the only place that cares which.
 */

export { FILE, FOLDER }
export type { FileNode, FolderNode, StorageNode }

/** Tag a row so the shared actions know which route to hit. */
export const asFile   = (row: StorageFile): FileNode     => ({ ...row, kind: FILE })
export const asFolder = (row: StorageFolder): FolderNode => ({ ...row, kind: FOLDER })

export const nodeUrl = (node: StorageNode): string =>
  node.kind === FOLDER ? `/api/storage/folders/${node.id}` : `/api/storage/${node.id}`

/** Serving URL for a stored file; `quality` picks an image version. */
export function fileUrl(id: string, quality: number | null = null): string {
  return quality == null ? `/api/storage/${id}/serve` : `/api/storage/${id}/serve?quality=${quality}`
}

/** Smallest image version — the one to draw in a tile. Null for non-images. */
export function thumbnailUrl(file: StorageFile | null | undefined): string | null {
  if (file?.type !== 'image' || !file.versions?.length) return null
  const smallest = [...file.versions].sort((a, b) => a.quality - b.quality)[0]
  return fileUrl(file.id, smallest.quality)
}

interface ListResponse {
  folders: StorageFolder[]
  files: StorageFile[]
}

export interface ListResult {
  ok: boolean
  folders: FolderNode[]
  files: FileNode[]
}

export function useStorageApi() {
  const { $fetch } = useApi()

  /** Contents of a folder — a null folderId is the production root. */
  async function list(productionId: string, folderId: string | null = null): Promise<ListResult> {
    const params = new URLSearchParams({ pid: productionId })
    if (folderId) params.set('folder_id', folderId)
    const { ok, data } = await $fetch<ListResponse>(`/api/storage?${params}`, { silent: true })
    if (!ok) return { ok: false, folders: [], files: [] }
    return {
      ok:      true,
      folders: (data.folders ?? []).map(asFolder),
      files:   (data.files   ?? []).map(asFile),
    }
  }

  const createFolder = (
    productionId: string,
    name: string,
    parentId: string | null = null,
  ): Promise<FetchResult<StorageFolder>> =>
    $fetch<StorageFolder>('/api/storage', {
      method: 'POST',
      json:   { production_id: productionId, name, parent_id: parentId },
      silent: true,
    })

  const rename = (node: StorageNode, name: string): Promise<FetchResult<unknown>> =>
    $fetch(nodeUrl(node), { method: 'PATCH', json: { name }, silent: true })

  const remove = (node: StorageNode): Promise<FetchResult<unknown>> =>
    $fetch(nodeUrl(node), { method: 'DELETE' })

  /** Files only — folders are re-parented through their own route, which the UI doesn't offer. */
  const move = (file: FileNode, folderId: string | null): Promise<FetchResult<unknown>> =>
    $fetch(`/api/storage/${file.id}`, { method: 'PATCH', json: { folder_id: folderId } })

  const setHue = (folder: FolderNode, hue: number | null): Promise<FetchResult<unknown>> =>
    $fetch(`/api/storage/folders/${folder.id}`, { method: 'PATCH', json: { hue } })

  return { list, createFolder, rename, remove, move, setHue }
}
