import z from 'zod';

// Bounded schema for the clips.data jsonb column. Known behavior fields are
// typed; unknown keys are tolerated (future behaviors) but the whole blob is
// size-capped so a client can't store — and broadcast to every peer — an
// arbitrary payload under the previous z.any().
const MAX_DATA_JSON_BYTES = 2048;

export const clipDataSchema = z.object({
  bpm:         z.number().min(1).max(999).optional(),
  beatsPerBar: z.number().int().min(1).max(12).optional(),
})
  .catchall(z.unknown())
  .refine(
    d => JSON.stringify(d).length <= MAX_DATA_JSON_BYTES,
    { message: `data must serialize to at most ${MAX_DATA_JSON_BYTES} bytes` },
  );
