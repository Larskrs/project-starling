/**
 * Shapes returned by /api/storage.
 *
 * Hand-written rather than derived from the Drizzle schema: the API doesn't
 * hand back raw rows. It selects a subset of columns, attaches recursive
 * `fileCount`/`folderCount` to folders, and folds image versions onto files —
 * so the row type and the response type genuinely differ.
 */

export type StorageFileType = 'image' | 'audio' | 'other'

export interface ImageVersion {
  id: string
  fileId: string
  /** Long-edge pixel budget; the smallest is the thumbnail. */
  quality: number
  size: number
  createdAt: string
}

export interface StorageFile {
  id: string
  productionId: string | null
  folderId: string | null
  name: string
  mimeType: string
  size: number
  type: StorageFileType
  createdAt: string
  /** Present for images only. */
  versions?: ImageVersion[]
}

export interface StorageFolder {
  id: string
  productionId: string
  parentId: string | null
  name: string
  /** oklch hue for the folder tint; null is the untinted default. */
  hue: number | null
  createdAt: string
  /** Recursive counts, computed by the API over the whole subtree. */
  fileCount: number
  folderCount: number
}

/** Discriminator the UI adds so one set of actions can address both. */
export const FILE = 'file'
export const FOLDER = 'folder'

export type NodeKind = typeof FILE | typeof FOLDER

export type FileNode = StorageFile & { kind: typeof FILE }
export type FolderNode = StorageFolder & { kind: typeof FOLDER }
export type StorageNode = FileNode | FolderNode

/** A step in the path to the current folder. */
export interface Crumb {
  id: string
  name: string
}
