import { defineEventHandler, getRouterParam, createError } from '../../lib/http/handler.js';
import { requireCompanyAccess } from '../../lib/access/company.js';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 404, message: 'Company not found' });

  const { company, canManage } = await requireCompanyAccess(event, { slug });

  return { ...company, canManage };
});
