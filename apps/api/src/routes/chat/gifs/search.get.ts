import { z } from 'zod';
import { defineEventHandler, requireAuth, ApiError, getValidatedQuery } from '../../../lib/handler.js';

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

const querySchema = z.object({
  q:     z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(24).transform(String),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const key = process.env.GIPHY_API_KEY;
  if (!key) throw new ApiError(500, 'Giphy API key not configured');

  const { q, limit } = getValidatedQuery(event, querySchema);
  const qs           = new URLSearchParams({ api_key: key, q, limit, rating: 'g' });
  const res          = await fetch(`${GIPHY_BASE}/search?${qs}`);
  if (!res.ok) throw new ApiError(502, 'Giphy request failed');

  const { data } = await res.json() as { data: unknown[] };
  return { data };
});
