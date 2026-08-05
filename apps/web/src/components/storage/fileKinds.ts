import type { StorageFile, StorageFileType } from '../../types/storage'

/** How each storage type shows up: the icon that stands in for a missing thumbnail. */
const ICONS: Partial<Record<StorageFileType, string>> = {
  image: 'mdi:image-outline',
  audio: 'mdi:music-note',
}

export const fileIcon = (file: Pick<StorageFile, 'type'> | null | undefined): string =>
  (file ? ICONS[file.type] : undefined) ?? 'mdi:file-outline'

export interface FolderHue {
  /** i18n key suffix under `storage.hues`. */
  key: string
  hue: number | null
}

/** Hues offered for folder tinting. `null` is the untinted default. */
export const FOLDER_HUES: FolderHue[] = [
  { key: 'default', hue: null },
  { key: 'red',     hue: 20   },
  { key: 'orange',  hue: 55   },
  { key: 'yellow',  hue: 90   },
  { key: 'green',   hue: 135  },
  { key: 'teal',    hue: 185  },
  { key: 'blue',    hue: 240  },
  { key: 'purple',  hue: 285  },
  { key: 'pink',    hue: 330  },
]
