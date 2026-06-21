import { ref } from 'vue'

/**
 * @param {object} opts
 * @param {string | (() => string) | import('vue').Ref<string>}  opts.companyId
 * @param {string | (() => string) | import('vue').Ref<string>}  opts.folderId
 * @param {(file: object, versions: object[]) => void}           [opts.onUploaded]
 * @param {(message: string) => void}                            [opts.onError]
 */
export function useUpload({ companyId, folderId, onUploaded, onError } = {}) {
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
    body.append('company_id', get(companyId))
    const fid = get(folderId)
    if (fid) body.append('folder_id', fid)
    body.append('file', file)

    try {
      const res  = await fetch('/api/storage/upload', { method: 'POST', credentials: 'include', body })
      const data = await res.json()

      if (!res.ok) {
        entry.status = 'error'
        onError?.(data.error ?? `Failed to upload ${file.name}`)
      } else {
        entry.status = 'done'
        onUploaded?.(data.file, data.versions ?? [])
      }
    } catch {
      entry.status = 'error'
      onError?.(`Network error uploading ${file.name}`)
    } finally {
      queue.value = [...queue.value]
      setTimeout(() => { queue.value = queue.value.filter(u => u.id !== entry.id) }, 3000)
    }
  }

  return { queue, uploadFiles }
}
