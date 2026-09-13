import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { eq, inArray, sql } from 'drizzle-orm';
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

// storage/c/{companyId}/p/{productionId}/t/{timelineId}/profile/{fileId}@{quality}.webp
export function timelineProfileImagePath(companyId: string, productionId: string, timelineId: string, fileId: string, quality: number): string {
  return join(STORAGE_ROOT, 'c', companyId, 'p', productionId, 't', timelineId, 'profile', `${fileId}@${quality}.webp`);
}

// storage/c/{companyId}/p/{productionId}/tokens/{tokenId}/profile/{fileId}@{quality}.webp
export function tokenProfileImagePath(companyId: string, productionId: string, tokenId: string, fileId: string, quality: number): string {
  return join(STORAGE_ROOT, 'c', companyId, 'p', productionId, 'tokens', tokenId, 'profile', `${fileId}@${quality}.webp`);
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
 * Write a timeline's profile image. Timelines have no banner slot, so unlike
 * companies/productions there is nothing to select — one image per timeline.
 */
export async function writeTimelineProfileImage(
  data:         Buffer,
  companyId:    string,
  productionId: string,
  timelineId:   string,
  fileId:       string,
): Promise<ImageVersion[]> {
  return processImage(data, (q) => timelineProfileImagePath(companyId, productionId, timelineId, fileId, q));
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

// ── Deletion ──────────────────────────────────────────────────────────────────
//
// Every delete below follows the same two-phase shape: all DB work happens
// inside one transaction, and disk unlinks happen only after it commits.
//
// The order matters. Deleting rows and files as interleaved steps — which is
// what these did before — leaves the two stores inconsistent whenever a step
// throws partway: rows pointing at files that are gone, or files on disk that
// no row accounts for, silently eating the production's storage quota.
//
// Neither store can be made to roll back with the other, so the choice is which
// way to fail. Unlinking after the commit means a crash in between leaves an
// orphaned file on disk: invisible to users, reclaimable by a sweep, and
// harmless. The reverse ordering leaves a row whose file 404s on every read —
// so this is the direction that degrades gracefully.

/** Remove a file from disk, ignoring not-found errors. */
export async function removeFile(physicalPath: string): Promise<void> {
  await unlink(physicalPath).catch((e) => { if (e?.code !== 'ENOENT') throw e; });
}

/** Unlink a batch, tolerating individual failures — see the note above. */
async function removeFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map(p => removeFile(p).catch((e) => {
    console.error(`[storage] failed to unlink ${p}:`, e);
  })));
}

/** A DB handle that may be the outer db or an open transaction. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every physical path belonging to `files`, image versions included.
 * Read-only — the caller decides when the rows themselves go.
 */
async function physicalPathsFor(
  tx: Db,
  files: Array<{ id: string; type: string; physicalPath: string }>,
): Promise<string[]> {
  const paths = files.map(f => f.physicalPath);

  const imageIds = files.filter(f => f.type === 'image').map(f => f.id);
  if (imageIds.length > 0) {
    const versions = await tx
      .select({ physicalPath: storageImageVersions.physicalPath })
      .from(storageImageVersions)
      .where(inArray(storageImageVersions.fileId, imageIds));
    paths.push(...versions.map(v => v.physicalPath));
  }

  return paths;
}

/**
 * A folder and everything nested under it, in one round-trip.
 *
 * The previous version issued a query per folder and recursed in JS, so a deep
 * tree cost a query per node; a recursive CTE resolves the whole tree in one.
 */
async function descendantFolderIds(tx: Db, rootId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM storage_folders WHERE id = ${rootId}
      UNION ALL
      SELECT f.id FROM storage_folders f JOIN tree t ON f.parent_id = t.id
    )
    SELECT id FROM tree
  `);
  return Array.from(rows as Iterable<{ id: string }>, r => r.id);
}

/**
 * Delete the disk artefacts for files whose rows are going away by another
 * route (a FK cascade, or an owner row being replaced). Image version rows
 * cascade from storage_files, so only the paths need collecting here.
 */
export async function purgeFilesFromDisk(
  files: Array<{ id: string; type: string; physicalPath: string }>,
): Promise<void> {
  if (files.length === 0) return;
  const paths = await physicalPathsFor(db, files);
  await db.delete(storageImageVersions)
    .where(inArray(storageImageVersions.fileId, files.map(f => f.id)));
  await removeFiles(paths);
}

export async function deleteFile(fileId: string): Promise<{ deleted: string }> {
  const paths = await db.transaction(async (tx) => {
    const [file] = await tx.select().from(storageFiles).where(eq(storageFiles.id, fileId)).limit(1);
    if (!file) return [];

    const collected = await physicalPathsFor(tx, [file]);
    // storage_image_versions.file_id cascades from this delete.
    await tx.delete(storageFiles).where(eq(storageFiles.id, fileId));
    return collected;
  });

  await removeFiles(paths);
  return { deleted: fileId };
}

export async function deleteFolder(folderId: string): Promise<{ deleted: string; filesRemoved: number }> {
  const { paths, filesRemoved } = await db.transaction(async (tx) => {
    const folderIds = await descendantFolderIds(tx, folderId);

    const files = folderIds.length === 0 ? [] : await tx
      .select({ id: storageFiles.id, type: storageFiles.type, physicalPath: storageFiles.physicalPath })
      .from(storageFiles)
      .where(inArray(storageFiles.folderId, folderIds));

    const collected = await physicalPathsFor(tx, files);

    // Files aren't cascaded by the folder delete — storage_files.folder_id is
    // ON DELETE SET NULL, so without this they'd survive as loose root-level
    // rows rather than being removed with the folder.
    if (files.length > 0) {
      await tx.delete(storageFiles).where(inArray(storageFiles.id, files.map(f => f.id)));
    }
    // Child folders cascade via storage_folders.parent_id.
    await tx.delete(storageFolders).where(eq(storageFolders.id, folderId));

    return { paths: collected, filesRemoved: files.length };
  });

  await removeFiles(paths);
  return { deleted: folderId, filesRemoved };
}

export async function deleteProductionStorage(productionId: string): Promise<{ foldersRemoved: number; filesRemoved: number }> {
  const { paths, filesRemoved, foldersRemoved } = await db.transaction(async (tx) => {
    const files = await tx
      .select({ id: storageFiles.id, type: storageFiles.type, physicalPath: storageFiles.physicalPath })
      .from(storageFiles)
      .where(eq(storageFiles.productionId, productionId));

    const collected = await physicalPathsFor(tx, files);

    if (files.length > 0) {
      await tx.delete(storageFiles).where(eq(storageFiles.productionId, productionId));
    }

    const folders = await tx
      .delete(storageFolders)
      .where(eq(storageFolders.productionId, productionId))
      .returning({ id: storageFolders.id });

    return { paths: collected, filesRemoved: files.length, foldersRemoved: folders.length };
  });

  await removeFiles(paths);
  return { foldersRemoved, filesRemoved };
}

export async function deleteCompanyStorage(companyId: string): Promise<{ foldersRemoved: number; filesRemoved: number }> {
  const prods = await db
    .select({ id: productions.id })
    .from(productions)
    .where(eq(productions.companyId, companyId));

  let foldersRemoved = 0;
  let filesRemoved   = 0;

  // Sequential rather than parallel: each production is its own transaction, so
  // one failing leaves the others already committed instead of half-applied.
  for (const prod of prods) {
    const result = await deleteProductionStorage(prod.id);
    foldersRemoved += result.foldersRemoved;
    filesRemoved   += result.filesRemoved;
  }

  return { foldersRemoved, filesRemoved };
}
