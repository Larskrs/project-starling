import z from 'zod';

/**
 * Icon names stored on track types, tracks, source sets and sources.
 *
 * Validated by shape, not against the UI's curated catalogue: the catalogue is
 * a browsing aid that will grow and shrink, and pinning the API to it would
 * turn a future catalogue edit into a validation error on existing rows.
 */
export const iconName = z.string().regex(/^mdi:[a-z0-9]+(-[a-z0-9]+)*$/, 'Must be an mdi icon name').max(64);

/** Optional on create, and clearable to null on both create and patch. */
export const iconField = iconName.nullable().optional();
