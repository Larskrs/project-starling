import { eq, inArray } from 'drizzle-orm';
import { db, tracks, trackTypes, sources, clips, storageFiles } from '@starling/db';
import { defineEventHandler } from '../../../lib/handler.js';
import { requireTimelineParam } from '../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production, timeline } = await requireTimelineParam(event);

  const [trackRows, trackTypeRows, sourceRows] = await Promise.all([
    db.select({
      id:              tracks.id,
      timelineId:      tracks.timelineId,
      typeId:          tracks.typeId,
      sourceId:        tracks.sourceId,
      name:            tracks.name,
      mode:            tracks.mode,
      sortOrder:       tracks.sortOrder,
      isMuted:         tracks.isMuted,
      isLocked:        tracks.isLocked,
      createdAt:       tracks.createdAt,
      typeName:         trackTypes.name,
      typeHue:          trackTypes.hue,
      typeTrackDisplay: trackTypes.trackDisplay,
      typeNameDisplay:  trackTypes.nameDisplay,
      typeClipDisplay:  trackTypes.clipDisplay,
      typeMetronome:    trackTypes.metronome,
      typeTts:          trackTypes.tts,
      sourceName:      sources.name,
      sourceShortName: sources.shortName,
      sourceHue:       sources.hue,
    })
      .from(tracks)
      .leftJoin(trackTypes, eq(tracks.typeId, trackTypes.id))
      .leftJoin(sources,    eq(tracks.sourceId, sources.id))
      .where(eq(tracks.timelineId, timeline.id))
      .orderBy(tracks.sortOrder, tracks.createdAt),

    db.select().from(trackTypes).where(eq(trackTypes.productionId, production.id)).orderBy(trackTypes.sortOrder, trackTypes.createdAt),
    db.select().from(sources).where(eq(sources.productionId, production.id)).orderBy(sources.createdAt),
  ]);

  const clipRows = trackRows.length > 0
    ? await db.select().from(clips)
        .where(inArray(clips.trackId, trackRows.map(t => t.id)))
        .orderBy(clips.position)
    : [];

  // Resolve file types for clips that reference a storage file.
  const fileIds = [...new Set(clipRows.filter(c => c.fileId).map(c => c.fileId!))]
  const fileTypeRows = fileIds.length > 0
    ? await db.select({ id: storageFiles.id, type: storageFiles.type })
        .from(storageFiles).where(inArray(storageFiles.id, fileIds))
    : []
  const fileTypeMap: Record<string, string> = Object.fromEntries(fileTypeRows.map(f => [f.id, f.type]))

  const clipsByTrack: Record<string, ({ fileType: string | null } & typeof clipRows[number])[]> = {};
  for (const clip of clipRows) {
    const row = { ...clip, fileType: clip.fileId ? (fileTypeMap[clip.fileId] ?? null) : null };
    (clipsByTrack[clip.trackId] ??= []).push(row);
  }

  return {
    timeline,
    tracks:     trackRows.map(tr => ({ ...tr, clips: clipsByTrack[tr.id] ?? [] })),
    trackTypes: trackTypeRows,
    sources:    sourceRows,
  };
});
