import z from 'zod';
import { db, trackTypes, sourceSet, sources } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { getTrackTypePreset } from '../../../../lib/trackTypePresets.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  presetId:  z.string().min(1),
  name:      z.string().min(1).max(64).optional(),
  sortOrder: z.number().int().min(0).default(0),
  // Camera presets only: also create a source set with `count` cameras.
  cameraSet: z.object({
    name:  z.string().min(1).max(128),
    count: z.number().int().min(1).max(64),
  }).optional(),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const body = await readValidatedBody(event, bodySchema);

  const preset = getTrackTypePreset(body.presetId);
  if (!preset) throw createError({ statusCode: 404, message: 'Unknown track type preset' });
  if (body.cameraSet && !preset.supportsCameraSet) {
    throw createError({ statusCode: 400, message: 'This preset does not support a camera set' });
  }

  return db.transaction(async (tx) => {
    let createdSet = null;
    let cameras: (typeof sources.$inferSelect)[] = [];

    if (body.cameraSet) {
      const [set] = await tx.insert(sourceSet).values({
        productionId: production.id,
        name:         body.cameraSet.name,
      }).returning();
      createdSet = set!;

      // Spread camera hues as evenly as possible around the wheel,
      // anchored at the preset's own hue.
      const count = body.cameraSet.count;
      cameras = await tx.insert(sources).values(
        Array.from({ length: count }, (_, i) => ({
          productionId: production.id,
          sourceSetId:  createdSet!.id,
          name:         `Camera ${i + 1}`,
          shortName:    `C${i + 1}`,
          hue:          (preset.settings.hue + Math.round((i * 360) / count)) % 360,
        })),
      ).returning();
    }

    const [trackType] = await tx.insert(trackTypes).values({
      productionId: production.id,
      name:         body.name ?? preset.name,
      hue:          preset.settings.hue,
      trackMode:    preset.settings.trackMode,
      sourceSetId:  createdSet?.id ?? null,
      sortOrder:    body.sortOrder,
      trackDisplay: preset.settings.trackDisplay,
      nameDisplay:  preset.settings.nameDisplay,
      clipDisplay:  preset.settings.clipDisplay,
      metronome:    preset.settings.metronome,
      tts:          preset.settings.tts,
    }).returning();

    return { trackType: trackType!, sourceSet: createdSet, sources: cameras };
  });
});
