import { ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useApi } from './useApi'
import type { ImageVersion, StorageFile } from '../types/storage'

export type UploadStatus = 'uploading' | 'done' | 'error'

export interface UploadEntry {
  id: number
  name: string
  status: UploadStatus
}

interface UploadResponse {
  file: StorageFile
  versions?: ImageVersion[]
}

export interface UploadOptions {
  productionId: MaybeRefOrGetter<string>
  folderId?: MaybeRefOrGetter<string | null>
  onUploaded?: (file: StorageFile, versions: ImageVersion[]) => void
  onError?: (message: string) => void
}

/**
 * Uploads with a visible queue. Entries linger for three seconds after they
 * finish so the outcome is readable, then drop themselves.
 */
export function useUpload({ productionId, folderId, onUploaded, onError }: UploadOptions) {
  const { $fetch } = useApi()
  const queue = ref<UploadEntry[]>([])
  let nextId  = 0

  async function uploadFiles(files: Iterable<File>): Promise<void> {
    await Promise.all([...files].map(uploadOne))
  }

  async function uploadOne(file: File): Promise<void> {
    const entry: UploadEntry = { id: nextId++, name: file.name, status: 'uploading' }
    queue.value = [...queue.value, entry]

    const body = new FormData()
    body.append('production_id', toValue(productionId))
    const fid = folderId === undefined ? null : toValue(folderId)
    if (fid) body.append('folder_id', fid)
    body.append('file', file)

    const { ok, data, error } = await $fetch<UploadResponse>('/api/storage/upload', { method: 'POST', body })
    if (!ok) {
      entry.status = 'error'
      onError?.(error ?? `Failed to upload ${file.name}`)
    } else {
      entry.status = 'done'
      onUploaded?.(data.file, data.versions ?? [])
    }
    queue.value = [...queue.value]
    setTimeout(() => { queue.value = queue.value.filter(u => u.id !== entry.id) }, 3000)
  }

  return { queue, uploadFiles }
}

export type Upload = ReturnType<typeof useUpload>
