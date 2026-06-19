import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import z from 'zod';
import { db, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, getRouterParam, getValidatedQuery, createError, requireAuth } from '../../../lib/handler.js';

const querySchema = z.object({
  quality: z.coerce.number().int().min(1).max(100).optional(),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing file id' });

  const [file] = await db.select().from(storageFiles).where(eq(storageFiles.id, id)).limit(1);
  if (!file) throw createError({ statusCode: 404, message: 'File not found' });

  let physicalPath = file.physicalPath;

  if (file.type === 'image') {
    const { quality } = getValidatedQuery(event, querySchema);

    if (quality !== undefined) {
      const versions = await db.select().from(storageImageVersions).where(eq(storageImageVersions.fileId, id));
      const best = versions.reduce((prev, cur) =>
        Math.abs(cur.quality - quality) < Math.abs(prev.quality - quality) ? cur : prev,
      );
      physicalPath = best.physicalPath;
    }
  }

  let fileSize: number;
  try {
    const s = await stat(physicalPath);
    fileSize = s.size;
  } catch {
    throw createError({ statusCode: 404, message: 'File missing from disk' });
  }

  const mime = file.type === 'image' ? 'image/jpeg' : file.mimeType;

  event.res.statusCode = 200;
  event.res.setHeader('Content-Type', mime);
  event.res.setHeader('Content-Length', fileSize);
  event.res.setHeader('Cache-Control', 'private, max-age=3600');

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(physicalPath);
    stream.pipe(event.res, { end: false });
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  event.res.end();
});
