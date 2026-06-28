import z from 'zod';
import { eq, and, or } from 'drizzle-orm';
import { db, companies, companyMembers, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, getRouterParam, readMultipart, createError, requireAuth, ApiError } from '../../../lib/handler.js';
import { isImage, writeProfileImage, purgeFilesFromDisk } from '../../../lib/storage.js';

const slotSchema = z.enum(['profile', 'banner']);

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  if (!cslug) throw createError({ statusCode: 400, message: 'Missing company slug' });

  const auth = await requireAuth(event);

  const [company] = await db.select().from(companies).where(eq(companies.slug, cslug)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  if (auth.role !== 'admin') {
    const [mem] = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.companyId, company.id),
        eq(companyMembers.userId, auth.userId),
        or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
      ))
      .limit(1);
    if (!mem) throw new ApiError(403, 'Company admin access required');
  }

  const { fields, files } = await readMultipart(event);

  const slotResult = slotSchema.safeParse(fields['slot']);
  if (!slotResult.success) throw new ApiError(422, 'slot must be "profile" or "banner"');
  const slot = slotResult.data;

  const upload = files['file'];
  if (!upload) throw new ApiError(400, 'No file field in request');
  if (!isImage(upload.mimeType)) throw new ApiError(415, 'Only image types are allowed for profile images');

  const oldFileId = slot === 'profile' ? company.profileImageId : company.bannerImageId;
  if (oldFileId) {
    const [oldFile] = await db.select().from(storageFiles).where(eq(storageFiles.id, oldFileId)).limit(1);
    if (oldFile) {
      await purgeFilesFromDisk([oldFile]);
      await db.delete(storageFiles).where(eq(storageFiles.id, oldFileId));
    }
  }

  const [file] = await db.insert(storageFiles).values({
    companyId:    company.id,
    name:         `${slot}-${upload.filename}`,
    mimeType:     upload.mimeType,
    size:         upload.data.length,
    type:         'image',
    physicalPath: '',
    hidden:       true,
  }).returning();

  const versions = await writeProfileImage(upload.data, company.id, null, slot, file.id);

  await db.insert(storageImageVersions).values(
    versions.map((v) => ({ fileId: file.id, ...v })),
  );

  const physicalPath = versions.reduce((best, v) => v.quality > best.quality ? v : best).physicalPath;
  const totalSize    = versions.reduce((sum, v) => sum + v.size, 0);

  await db.update(storageFiles)
    .set({ physicalPath, size: totalSize })
    .where(eq(storageFiles.id, file.id));

  await db.update(companies)
    .set(slot === 'profile' ? { profileImageId: file.id } : { bannerImageId: file.id })
    .where(eq(companies.id, company.id));

  return { fileId: file.id, slot, versions: versions.length };
});
