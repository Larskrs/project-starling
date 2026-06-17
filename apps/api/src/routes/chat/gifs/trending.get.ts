import { defineEventHandler, requireAuth, ApiError } from '../../../lib/handler.js';

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const key = process.env.GIPHY_API_KEY;
  if (!key) throw new ApiError(500, 'Giphy API key not configured');

  const limit = event.url.searchParams.get('limit') ?? '24';
  const qs    = new URLSearchParams({ api_key: key, limit, rating: 'g' });
  const res   = await fetch(`${GIPHY_BASE}/trending?${qs}`);
  if (!res.ok) throw new ApiError(502, 'Giphy request failed');

  const { data } = await res.json() as { data: unknown[] };
  return { data };
});
