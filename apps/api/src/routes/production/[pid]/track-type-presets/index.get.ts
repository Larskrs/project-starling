import { defineEventHandler } from '../../../../lib/http/handler.js';
import { requireProductionParam } from '../../../../lib/access/production.js';
import { trackTypePresets } from '../../../../lib/timeline/trackTypePresets.js';

export default defineEventHandler(async (event) => {
  await requireProductionParam(event);
  return trackTypePresets;
});
