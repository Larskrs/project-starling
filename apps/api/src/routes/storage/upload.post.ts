import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, companies, storageFolders, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, readMultipart, createError, ApiError, requireAuth } from '../../lib/handler.js';
import { isImage, isAudio, processImage, writeAudio } from '../../lib/storage.js';

const metaSchema = z.object({
  company_id: z.uuid(),
  folder_id:  z.uuid().optional(),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const { fields, files } = await readMultipart(event);

  const meta = metaSchema.safeParse(fields);
  if (!meta.success) throw new ApiError(422, 'Invalid fields', meta.error.flatten());

  const { company_id, folder_id } = meta.data;
  const upload = files['file'];
  if (!upload) throw new ApiError(400, 'No file field in request');

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, company_id)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  if (folder_id) {
    const [folder] = await db.select({ companyId: storageFolders.companyId })
      .from(storageFolders).where(eq(storageFolders.id, folder_id)).limit(1);
    if (!folder)                         throw createError({ statusCode: 404, message: 'Folder not found' });
    if (folder.companyId !== company_id) throw createError({ statusCode: 403, message: 'Folder belongs to a different company' });
  }

  const { filename, mimeType, data } = upload;

  if (!isImage(mimeType) && !isAudio(mimeType)) {
    throw new ApiError(415, `Unsupported file type: ${mimeType}. Allowed: images and audio.`);
  }

  const type = isImage(mimeType) ? 'image' : 'audio';

  const [file] = await db.insert(storageFiles).values({
    companyId:    company_id,
    folderId:     folder_id ?? null,
    name:         filename,
    mimeType,
    size:         data.length,
    type,
    physicalPath: '', // filled in below
  }).returning();

  let physicalPath: string;
  let versions: typeof storageImageVersions.$inferSelect[] = [];

  if (type === 'image') {
    const imageVersions = await processImage(data, company_id, file.id);

    await db.insert(storageImageVersions).values(
      imageVersions.map((v) => ({ fileId: file.id, ...v })),
    );

    // physicalPath for the file record points to the highest quality version
    physicalPath = imageVersions.reduce((best, v) => v.quality > best.quality ? v : best).physicalPath;
    versions = await db.select().from(storageImageVersions).where(eq(storageImageVersions.fileId, file.id));
  } else {
    physicalPath = await writeAudio(data, company_id, file.id, mimeType);
  }

  const [updated] = await db.update(storageFiles)
    .set({ physicalPath })
    .where(eq(storageFiles.id, file.id))
    .returning();

  return { file: updated, versions: type === 'image' ? versions : undefined };
});
