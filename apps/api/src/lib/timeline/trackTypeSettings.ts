import z from 'zod';

/**
 * Editor behavior columns on track_types (configured on the track-types page).
 * Shared by the POST (with defaults) and PATCH (all-optional) routes.
 */
export const trackBehaviorCreateFields = {
  trackDisplay: z.enum(['normal', 'ruler']).default('normal'),
  nameDisplay:  z.enum(['normal', 'stretch', 'emphasize']).default('normal'),
  clipDisplay:  z.enum(['normal', 'zebra', 'border', 'transparent']).default('normal'),
  metronome:    z.boolean().default(false),
  tts:          z.boolean().default(false),
};

export const trackBehaviorPatchFields = {
  trackDisplay: z.enum(['normal', 'ruler']).optional(),
  nameDisplay:  z.enum(['normal', 'stretch', 'emphasize']).optional(),
  clipDisplay:  z.enum(['normal', 'zebra', 'border', 'transparent']).optional(),
  metronome:    z.boolean().optional(),
  tts:          z.boolean().optional(),
};
