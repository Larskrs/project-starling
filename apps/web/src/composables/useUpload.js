import { ref } from 'vue'
import { useApi } from './useApi.js'

/**
 * @param {object} opts
 * @param {string | (() => string) | import('vue').Ref<string>}  opts.productionId
 * @param {string | (() => string) | import('vue').Ref<string>}  opts.folderId
 * @param {(file: object, versions: object[]) => void}           [opts.onUploaded]
 * @param {(message: string) => void}                            [opts.onError]
 */
export function useUpload({ productionId, folderId, onUploaded, onError } = {}) {
  const { $fetch } = useApi()
  const queue = ref([])
  let nextId  = 0

  function get(val) {
    if (typeof val === 'function') return val()
    return val?.value !== undefined ? val.value : val
  }

  async function uploadFiles(files) {
    await Promise.all([...files].map(uploadOne))
  }

  async function uploadOne(file) {
    const entry = { id: nextId++, name: file.name, status: 'uploading' }
    queue.value = [...queue.value, entry]

    const body = new FormData()
    body.append('production_id', get(productionId))
    const fid = get(folderId)
    if (fid) body.append('folder_id', fid)
    body.append('file', file)

    const { ok, data, error } = await $fetch('/api/storage/upload', { method: 'POST', body })
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
