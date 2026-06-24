import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const { company, production } = await requireProductionAccess(event, { cslug, pslug });

  return { company, production };
});
