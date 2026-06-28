import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { eq, inArray } from 'drizzle-orm';
import { db, productions, storageFolders, storageFiles, storageImageVersions } from '@starling/db';

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

// storage/c/{companyId}/p/{productionId}/images/{fileId}@{quality}.webp
export function imagePhysicalPath(companyId: string, productionId: string, fileId: string, quality: number): string {
  return join(STORAGE_ROOT, 'c', companyId, 'p', productionId, 'images', `${fileId}@${quality}.webp`);
}

// storage/c/{companyId}/p/{productionId}/audio/{fileId}{ext}
export function audioPhysicalPath(companyId: string, productionId: string, fileId: string, ext: string): string {
  return join(STORAGE_ROOT, 'c', companyId, 'p', productionId, 'audio', `${fileId}${ext}`);
}

// storage/c/{companyId}/profile/{slot}/{fileId}@{quality}.webp
export function companyProfileImagePath(companyId: string, slot: 'profile' | 'banner', fileId: string, quality: number): string {
  return join(STORAGE_ROOT, 'c', companyId, 'profile', slot, `${fileId}@${quality}.webp`);
}

// storage/c/{companyId}/p/{productionId}/profile/{slot}/{fileId}@{quality}.webp
export function productionProfileImagePath(companyId: string, productionId: string, slot: 'profile' | 'banner', fileId: string, quality: number): string {
  return join(STORAGE_ROOT, 'c', companyId, 'p', productionId, 'profile', slot, `${fileId}@${quality}.webp`);
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

/**
 * Process an image buffer into N quality/dimension versions.
 * `getPath(quality)` returns the physical path for each version — callers
 * supply this so the same processor works for production media and profile images.
 */
export async function processImage(
  data:    Buffer,
  getPath: (quality: number) => string,
): Promise<ImageVersion[]> {
  const n       = versionCount(data.length);
  const levels  = qualityLevels(n);
  const versions: ImageVersion[] = [];

  const meta       = await sharp(data).metadata();
  const origWidth  = meta.width  ?? 1920;
  const origHeight = meta.height ?? 1080;

  const maxDim  = 1920;
  const longest = Math.max(origWidth, origHeight);
  const ratio   = longest > maxDim ? maxDim / longest : 1;
  const baseWidth  = Math.round(origWidth  * ratio);
  const baseHeight = Math.round(origHeight * ratio);

  for (const quality of levels) {
    const scale    = quality / 100;
    const maxBytes = Math.round(scale * 1024 * 1024);

    let w   = Math.max(1, Math.round(baseWidth  * scale));
    let h   = Math.max(1, Math.round(baseHeight * scale));
    let out = await sharp(data).resize(w, h, { fit: 'fill' }).webp({ quality }).toBuffer();

    while (out.length > maxBytes && w > 64) {
      w   = Math.max(64, Math.round(w * 0.85));
      h   = Math.max(64, Math.round(h * 0.85));
      out = await sharp(data).resize(w, h, { fit: 'fill' }).webp({ quality }).toBuffer();
    }

    const physicalPath = getPath(quality);
    await mkdir(dirname(physicalPath), { recursive: true });
    await writeFile(physicalPath, out);
    versions.push({ quality, physicalPath, size: out.length });
  }

  return versions;
}

/** Write an audio file to disk as-is and return its physical path. */
export async function writeAudio(
  data:         Buffer,
  companyId:    string,
  productionId: string,
  fileId:       string,
  mimeType:     string,
): Promise<string> {
  const extMap: Record<string, string> = {
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav',
    'audio/ogg': '.ogg', 'audio/flac': '.flac', 'audio/aac': '.aac',
    'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
  };
  const ext          = extMap[mimeType] ?? extname(mimeType).replace('/', '.') ?? '.bin';
  const physicalPath = audioPhysicalPath(companyId, productionId, fileId, ext);

  await mkdir(dirname(physicalPath), { recursive: true });
  await writeFile(physicalPath, data);

  return physicalPath;
}

// storage/u/{userId}/{slot}/{fileId}@{quality}.webp
export function userProfileImagePath(userId: string, slot: string, fileId: string, quality: number): string {
  return join(STORAGE_ROOT, 'u', userId, slot, `${fileId}@${quality}.webp`);
}

export async function writeUserProfileImage(
  data:   Buffer,
  userId: string,
  slot:   string,
  fileId: string,
): Promise<ImageVersion[]> {
  return processImage(data, (q) => userProfileImagePath(userId, slot, fileId, q));
}

/**
 * Write a profile or banner image for a company or production.
 * Pass `productionId: null` for company-level images.
 */
export async function writeProfileImage(
  data:         Buffer,
  companyId:    string,
  productionId: string | null,
  slot:         'profile' | 'banner',
  fileId:       string,
): Promise<ImageVersion[]> {
  const getPath = productionId
    ? (q: number) => productionProfileImagePath(companyId, productionId, slot, fileId, q)
    : (q: number) => companyProfileImagePath(companyId, slot, fileId, q);

  return processImage(data, getPath);
}

/** Remove a file from disk, ignoring not-found errors. */
export async function removeFile(physicalPath: string): Promise<void> {
  await unlink(physicalPath).catch((e) => { if (e?.code !== 'ENOENT') throw e; });
}

export async function collectFolderIds(rootId: string): Promise<string[]> {
  const ids = [rootId];
  const children = await db
    .select({ id: storageFolders.id })
    .from(storageFolders)
    .where(eq(storageFolders.parentId, rootId));
  for (const child of children) {
    ids.push(...await collectFolderIds(child.id));
  }
  return ids;
}

export async function purgeFilesFromDisk(files: Array<{ id: string; type: string; physicalPath: string }>) {
  await Promise.all(
    files.map(async (file) => {
      if (file.type === 'image') {
        const versions = await db
          .select()
          .from(storageImageVersions)
          .where(eq(storageImageVersions.fileId, file.id));
        await Promise.all(versions.map((v) => removeFile(v.physicalPath)));
        await db.delete(storageImageVersions).where(eq(storageImageVersions.fileId, file.id));
      } else {
        await removeFile(file.physicalPath);
      }
    }),
  );
}

export async function deleteFile(fileId: string): Promise<{ deleted: string }> {
  const [file] = await db.select().from(storageFiles).where(eq(storageFiles.id, fileId)).limit(1);
  if (!file) return { deleted: fileId };

  await purgeFilesFromDisk([file]);
  await db.delete(storageFiles).where(eq(storageFiles.id, fileId));

  return { deleted: fileId };
}

export async function deleteFolder(folderId: string): Promise<{ deleted: string; filesRemoved: number }> {
  const folderIds = await collectFolderIds(folderId);

  const files = await db
    .select()
    .from(storageFiles)
    .where(inArray(storageFiles.folderId, folderIds));

  await purgeFilesFromDisk(files);

  if (files.length) {
    await db.delete(storageFiles).where(inArray(storageFiles.id, files.map((f) => f.id)));
  }

  await db.delete(storageFolders).where(eq(storageFolders.id, folderId));

  return { deleted: folderId, filesRemoved: files.length };
}

export async function deleteProductionStorage(productionId: string): Promise<{ foldersRemoved: number; filesRemoved: number }> {
  const files = await db
    .select()
    .from(storageFiles)
    .where(eq(storageFiles.productionId, productionId));

  await purgeFilesFromDisk(files);

  if (files.length) {
    await db.delete(storageFiles).where(eq(storageFiles.productionId, productionId));
  }

  const folders = await db
    .select({ id: storageFolders.id })
    .from(storageFolders)
    .where(eq(storageFolders.productionId, productionId));

  if (folders.length) {
    await db.delete(storageFolders).where(eq(storageFolders.productionId, productionId));
  }

  return { foldersRemoved: folders.length, filesRemoved: files.length };
}

export async function deleteCompanyStorage(companyId: string): Promise<{ foldersRemoved: number; filesRemoved: number }> {
  const prods = await db
    .select({ id: productions.id })
    .from(productions)
    .where(eq(productions.companyId, companyId));

  let foldersRemoved = 0;
  let filesRemoved   = 0;

  for (const prod of prods) {
    const result = await deleteProductionStorage(prod.id);
    foldersRemoved += result.foldersRemoved;
    filesRemoved   += result.filesRemoved;
  }

  return { foldersRemoved, filesRemoved };
}
