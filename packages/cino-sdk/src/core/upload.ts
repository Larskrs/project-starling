/** A file to upload: a Blob or File, or raw bytes with a name. */
export type UploadSource =
  | Blob
  | { data: Blob | ArrayBuffer | ArrayBufferView; name: string; type?: string };

export function toFormFile(source: UploadSource, name?: string): { blob: Blob; name: string } {
  if (source instanceof Blob) {
    const fileName = name ?? (source as Blob & { name?: string }).name;
    if (!fileName) throw new TypeError('cino-sdk: uploading a Blob needs a file name');
    return { blob: source, name: fileName };
  }

  const type = source.type ?? (source.data instanceof Blob ? source.data.type : '') ?? '';
  const blob = new Blob([source.data as BlobPart], { type: type || 'application/octet-stream' });
  return { blob, name: name ?? source.name };
}

export function formWith(fields: Record<string, string | undefined>, file?: UploadSource, fileName?: string): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(key, value);
  }
  if (file) {
    const { blob, name } = toFormFile(file, fileName);
    form.set('file', blob, name);
  }
  return form;
}
