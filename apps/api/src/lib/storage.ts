import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
export const STORAGE_ROOT = join(here, '..', '..', '..', '..', 'storage');

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);

export const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac',
  'audio/aac', 'audio/mp4', 'audio/x-m4a',
]);

export function isImage(mimeType: string) { return ALLOWED_IMAGE_TYPES.has(mimeType); }
export function isAudio(mimeType: string) { return ALLOWED_AUDIO_TYPES.has(mimeType); }

// storage/c/{companyId}/images/{fileId}@{quality}.webp
export function imagePhysicalPath(companyId: string, fileId: string, quality: number): string {
  return join(STORAGE_ROOT, 'c', companyId, 'images', `${fileId}@${quality}.webp`);
}

// storage/c/{companyId}/audio/{fileId}{ext}
export function audioPhysicalPath(companyId: string, fileId: string, ext: string): string {
  return join(STORAGE_ROOT, 'c', companyId, 'audio', `${fileId}${ext}`);
}

/** How many quality versions to generate based on raw file size. */
function versionCount(sizeBytes: number): number {
  if (sizeBytes < 100 * 1024)       return 1; // <100 KB
  if (sizeBytes < 500 * 1024)       return 2; // 100–500 KB
  if (sizeBytes < 2 * 1024 * 1024)  return 3; // 500 KB–2 MB
  return 4;                                     // >2 MB
}

/**
 * Divide (0, 67] evenly into n quality levels, highest first.
 * n=1 → [67]   n=2 → [67,33]   n=3 → [67,45,22]   n=4 → [67,50,33,17]
 */
function qualityLevels(n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(((n - i) / n) * 67));
}

export interface ImageVersion {
  quality:      number;
  physicalPath: string;
  size:         number;
}

/** Process an image buffer into N versions, each with reduced JPEG quality AND pixel dimensions.
 *  Each version is also capped at (quality / 100) MB — e.g. @75 ≤ 0.75 MB, @67 ≤ 0.67 MB.
 *  If the initial render exceeds the cap, dimensions are iteratively reduced until it fits.
 */
export async function processImage(
  data:      Buffer,
  companyId: string,
  fileId:    string,
): Promise<ImageVersion[]> {
  const n       = versionCount(data.length);
  const levels  = qualityLevels(n);
  const versions: ImageVersion[] = [];

  const meta       = await sharp(data).metadata();
  const origWidth  = meta.width  ?? 1920;
  const origHeight = meta.height ?? 1080;

  // Clamp longest edge to 1920, preserving aspect ratio
  const maxDim  = 1920;
  const longest = Math.max(origWidth, origHeight);
  const ratio   = longest > maxDim ? maxDim / longest : 1;
  const baseWidth  = Math.round(origWidth  * ratio);
  const baseHeight = Math.round(origHeight * ratio);

  for (const quality of levels) {
    const scale    = quality / 100;
    const maxBytes = Math.round(scale * 1024 * 1024); // quality% of 1 MB

    let w   = Math.max(1, Math.round(baseWidth  * scale));
    let h   = Math.max(1, Math.round(baseHeight * scale));
    let out = await sharp(data).resize(w, h, { fit: 'fill' }).webp({ quality }).toBuffer();

    // Shrink dimensions by 15% per iteration until the output fits within the cap
    while (out.length > maxBytes && w > 64) {
      w   = Math.max(64, Math.round(w * 0.85));
      h   = Math.max(64, Math.round(h * 0.85));
      out = await sharp(data).resize(w, h, { fit: 'fill' }).webp({ quality }).toBuffer();
    }

    const physicalPath = imagePhysicalPath(companyId, fileId, quality);
    await mkdir(dirname(physicalPath), { recursive: true });
    await writeFile(physicalPath, out);
    versions.push({ quality, physicalPath, size: out.length });
  }

  return versions;
}

/** Write an audio file to disk as-is and return its physical path. */
export async function writeAudio(
  data:      Buffer,
  companyId: string,
  fileId:    string,
  mimeType:  string,
): Promise<string> {
  const extMap: Record<string, string> = {
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav',
    'audio/ogg': '.ogg', 'audio/flac': '.flac', 'audio/aac': '.aac',
    'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
  };
  const ext          = extMap[mimeType] ?? extname(mimeType).replace('/', '.') ?? '.bin';
  const physicalPath = audioPhysicalPath(companyId, fileId, ext);

  await mkdir(dirname(physicalPath), { recursive: true });
  await writeFile(physicalPath, data);

  return physicalPath;
}

/** Remove a file from disk, ignoring not-found errors. */
export async function removeFile(physicalPath: string): Promise<void> {
  await unlink(physicalPath).catch((e) => { if (e?.code !== 'ENOENT') throw e; });
}
