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

  const mime = file.type === 'image' ? 'image/webp' : file.mimeType;
  const rangeHeader = event.req.headers['range'];

  event.res.setHeader('Content-Type', mime);
  event.res.setHeader('Accept-Ranges', 'bytes');
  event.res.setHeader('Cache-Control', 'private, max-age=3600');

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!match) throw createError({ statusCode: 416, message: 'Invalid Range header' });

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;

    if (start > end || start >= fileSize) {
      event.res.statusCode = 416;
      event.res.setHeader('Content-Range', `bytes */${fileSize}`);
      event.res.end();
      return;
    }

    event.res.statusCode = 206;
    event.res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    event.res.setHeader('Content-Length', end - start + 1);

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(physicalPath, { start, end });
      stream.pipe(event.res, { end: false });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  } else {
    event.res.statusCode = 200;
    event.res.setHeader('Content-Length', fileSize);

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(physicalPath);
      stream.pipe(event.res, { end: false });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  }

  event.res.end();
});
