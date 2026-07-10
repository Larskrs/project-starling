import { defineEventHandler } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { trackTypePresets } from '../../../../lib/trackTypePresets.js';

export default defineEventHandler(async (event) => {
  await requireProductionParam(event);
  return trackTypePresets;
});
