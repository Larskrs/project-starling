import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { db, storageFiles, storageImageVersions } from '@starling/db';
import type { MailAttachment } from './mailer.js';

/** Content-ID used for the one image an invite carries. */
export const INVITE_IMAGE_CID = 'invite-image';

/**
 * Rendered at 64px, attached at 128px so it stays sharp on a retina screen.
 */
const ATTACH_PX = 128;

/**
 * Turns a stored profile image into something an email client will actually
 * display.
 *
 * Two conversions happen here, both load-bearing. Storage keeps WebP, which
 * Outlook on Windows and older Apple Mail refuse to render — so this re-encodes
 * to PNG. And the stored versions are up to 1920px, which is absurd to attach
 * to a message — so it downsizes to a thumbnail first.
 *
 * Returns null for anything unusable — no image set, a row that has gone, a
 * file missing from disk. A missing picture must never cost someone their
 * invite, and the templates fall back to a monogram.
 */
export async function loadInlineImage(
  fileId: string | null | undefined,
  cid = INVITE_IMAGE_CID,
): Promise<MailAttachment | null> {
  if (!fileId) return null;

  try {
    const [file] = await db.select().from(storageFiles).where(eq(storageFiles.id, fileId)).limit(1);
    if (!file || file.type !== 'image') return null;

    // Prefer a small stored version: decoding a 1920px original to make a
    // 128px thumbnail is work this request does not need to do.
    const versions = await db
      .select()
      .from(storageImageVersions)
      .where(eq(storageImageVersions.fileId, fileId));

    const source = versions.length > 0
      ? versions.reduce((prev, cur) => (Math.abs(cur.quality - 40) < Math.abs(prev.quality - 40) ? cur : prev))
      : null;

    const raw = await readFile(source?.physicalPath ?? file.physicalPath);

    const content = await sharp(raw)
      .resize(ATTACH_PX, ATTACH_PX, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toBuffer();

    return { filename: 'image.png', content, cid, contentType: 'image/png' };
  } catch (err) {
    console.warn(`[mail] could not attach image ${fileId}:`, (err as Error).message);
    return null;
  }
}
