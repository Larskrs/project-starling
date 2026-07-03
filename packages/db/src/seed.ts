import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import { eq, and } from 'drizzle-orm';
import {
  users, companies, productions,
  companyMembers, productionMembers, productionRoles,
  sourceSet, sources, trackTypes, timelines, tracks,
} from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '..', '.env') });

const scrypt = promisify(_scrypt);
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key  = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

const client = postgres(process.env.DATABASE_URL ?? '', { max: 1 });
const db = drizzle(client);

console.log('Seeding...');

// ── User ──────────────────────────────────────────────────────────────────────
const [insertedUser] = await db.insert(users).values({
  email:           'larskrs@smage.org',
  name:            'Lars Kristian',
  first_name:      'Lars',
  last_name:       'Kristian',
  hashedPassword:  await hashPassword('password'),
  isEmailVerified: true,
  role:            'admin',
}).onConflictDoNothing().returning();

const user = insertedUser ?? (
  await db.select().from(users).where(eq(users.email, 'larskrs@smage.org'))
)[0]!;
console.log(`  User: ${user.email}`);

// ── Company ───────────────────────────────────────────────────────────────────
const [insertedCompany] = await db.insert(companies).values({
  name: 'NRK',
  slug: 'nrk',
}).onConflictDoNothing().returning();

const company = insertedCompany ?? (
  await db.select().from(companies).where(eq(companies.slug, 'nrk'))
)[0]!;
console.log(`  Company: ${company.name}`);

await db.insert(companyMembers).values({
  companyId: company.id,
  userId:    user.id,
  role:      'owner',
}).onConflictDoNothing();

// ── Production ────────────────────────────────────────────────────────────────
const [insertedProd] = await db.insert(productions).values({
  companyId: company.id,
  name:      'Melodi Grand Prix',
  slug:      'melodi-grand-prix',
}).onConflictDoNothing().returning();

const production = insertedProd ?? (
  await db.select().from(productions)
    .where(and(eq(productions.companyId, company.id), eq(productions.slug, 'melodi-grand-prix')))
)[0]!;
console.log(`  Production: ${production.name}`);

if (insertedProd) {
  const allPermissions = (1n << 8n) - 1n;
  const [adminRole] = await db.insert(productionRoles).values({
    productionId: production.id,
    name:         'Administrator',
    hue:          250,
    permissions:  allPermissions,
  }).returning();

  await db.insert(productionMembers).values({
    productionId: production.id,
    userId:       user.id,
    roleId:       adminRole!.id,
  }).onConflictDoNothing();
}

// ── Camera source set ─────────────────────────────────────────────────────────
let [camSet] = await db.select().from(sourceSet)
  .where(and(eq(sourceSet.productionId, production.id), eq(sourceSet.name, 'Cameras')));

if (!camSet) {
  [camSet] = await db.insert(sourceSet).values({
    productionId: production.id,
    name:         'Cameras',
  }).returning();
  console.log(`  Source set: ${camSet!.name}`);
}

const cameras = [
  { name: 'Camera 1',   shortName: 'C1',  hue: 195 },
  { name: 'Camera 2',   shortName: 'C2',  hue: 210 },
  { name: 'Camera 3',   shortName: 'C3',  hue: 225 },
  { name: 'Camera 4',   shortName: 'C4',  hue: 240 },
  { name: 'Camera 5',   shortName: 'C5',  hue: 255 },
  { name: 'Crane',      shortName: 'CRN', hue: 145 },
  { name: 'Steadycam',  shortName: 'STC', hue: 35  },
];

for (const cam of cameras) {
  const [existing] = await db.select({ id: sources.id }).from(sources)
    .where(and(eq(sources.productionId, production.id), eq(sources.name, cam.name)));
  if (!existing) {
    await db.insert(sources).values({
      productionId: production.id,
      sourceSetId:  camSet!.id,
      name:         cam.name,
      shortName:    cam.shortName,
      hue:          cam.hue,
    });
    console.log(`    Source: ${cam.name} (${cam.shortName})`);
  }
}

// ── Camera track type ─────────────────────────────────────────────────────────
let [camTrackType] = await db.select().from(trackTypes)
  .where(and(eq(trackTypes.productionId, production.id), eq(trackTypes.name, 'Camera')));

if (!camTrackType) {
  [camTrackType] = await db.insert(trackTypes).values({
    productionId: production.id,
    name:         'Camera',
    hue:          215,
    trackMode:    'event',
    sourceSetId:  camSet!.id,
    sortOrder:    0,
  }).returning();
  console.log(`  Track type: ${camTrackType!.name}`);
}

// ── Audio track type ──────────────────────────────────────────────────────────
let [audioTrackType] = await db.select().from(trackTypes)
  .where(and(eq(trackTypes.productionId, production.id), eq(trackTypes.name, 'Audio')));

if (!audioTrackType) {
  [audioTrackType] = await db.insert(trackTypes).values({
    productionId: production.id,
    name:         'Audio',
    hue:          45,
    trackMode:    'clip',
    sortOrder:    1,
  }).returning();
  console.log(`  Track type: ${audioTrackType!.name}`);
}

// ── Test timeline ─────────────────────────────────────────────────────────────
let [testTimeline] = await db.select().from(timelines)
  .where(and(eq(timelines.productionId, production.id), eq(timelines.name, 'Test Timeline')));

if (!testTimeline) {
  [testTimeline] = await db.insert(timelines).values({
    productionId: production.id,
    name:         'Test Timeline',
    frameRate:    '25',
    startFrame:   0,
    endFrame:     90000, // 1 hour @ 25 fps
    ltcOffsetFrames: 0,
  }).returning();
  console.log(`  Timeline: ${testTimeline!.name}`);
}

// ── Camera track ──────────────────────────────────────────────────────────────
const [existingCamTrack] = await db.select({ id: tracks.id }).from(tracks)
  .where(and(eq(tracks.timelineId, testTimeline!.id), eq(tracks.name, 'Camera')));

if (!existingCamTrack) {
  await db.insert(tracks).values({
    timelineId: testTimeline!.id,
    typeId:     camTrackType!.id,
    name:       'Camera',
    mode:       'event',
    sortOrder:  0,
  });
  console.log(`  Track: Camera`);
}

// ── Audio track ───────────────────────────────────────────────────────────────
const [existingAudioTrack] = await db.select({ id: tracks.id }).from(tracks)
  .where(and(eq(tracks.timelineId, testTimeline!.id), eq(tracks.name, 'Audio')));

if (!existingAudioTrack) {
  await db.insert(tracks).values({
    timelineId: testTimeline!.id,
    typeId:     audioTrackType!.id,
    name:       'Audio',
    mode:       'clip',
    sortOrder:  1,
  });
  console.log(`  Track: Audio`);
}

console.log('Seed complete — password: password');
await client.end();
