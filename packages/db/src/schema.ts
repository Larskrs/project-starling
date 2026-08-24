import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, text, boolean, timestamp, uniqueIndex, integer, type AnyPgColumn, bigint, index, jsonb, check } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);
export const companyRoleEnum = pgEnum('company_role', ['owner', 'admin', 'member']);
export const trackModeEnum = pgEnum("track_mode", [
  "event", // Point Events — cameras, people; position only
  "clip",  // MediaClip — position + mediaStart + end + optional fileId
]);
export const trackDisplayEnum = pgEnum("track_display", ["normal", "ruler"]);
export const nameDisplayEnum  = pgEnum("name_display", ["normal", "stretch", "emphasize"]);
export const clipDisplayEnum  = pgEnum("clip_display", ["normal", "zebra", "border", "transparent"]);
export const frameRateEnum = pgEnum("frame_rate", [
  "23.976", "24", "25", "29.97", "29.97df", "30", "50", "59.94", "60",
]);

export const users = pgTable('users', {
  id:              uuid('id').primaryKey().defaultRandom(),
  email:           text('email').notNull().unique(),
  name:            text('name').notNull(),
  avatar:          text('avatar').notNull().default(''),
  first_name:      text('first_name').notNull(),
  last_name:       text('last_name').notNull(),
  hashedPassword:  text('hashed_password').notNull(),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  role:            userRoleEnum('role').notNull().default('user'),
  avatarImageId:   uuid('avatar_image_id'),
  bannerImageId:   uuid('banner_image_id'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id:        text('id').primaryKey(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => [
  // The expiry sweep in lib/session.ts runs every 5 minutes forever; without
  // this it seq-scans the whole table each time.
  index('sessions_expires_idx').on(t.expiresAt),
]);

export const companies = pgTable('companies', {
  id:             uuid('id').primaryKey().defaultRandom(),
  name:           text('name').notNull(),
  slug:           text('slug').notNull().unique(), // global
  profileImageId: uuid('profile_image_id'),
  bannerImageId:  uuid('banner_image_id'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});

export const productions = pgTable('productions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  companyId:        uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  slug:             text('slug').notNull(),
  profileImageId:   uuid('profile_image_id'),
  bannerImageId:    uuid('banner_image_id'),
  allocatedStorage: bigint('allocated_storage', { mode: 'number' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('prod_slug_uq').on(t.companyId, t.slug)]);

export const storageFileTypeEnum = pgEnum('storage_file_type', ['image', 'audio']);

export const storageFolders = pgTable('storage_folders', {
  id:           uuid('id').primaryKey().defaultRandom(),
  productionId: uuid('production_id').notNull().references(() => productions.id, { onDelete: 'cascade' }),
  parentId:     uuid('parent_id').references((): AnyPgColumn => storageFolders.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  hue:          integer('hue'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

export const storageFiles = pgTable('storage_files', {
  id:           uuid('id').primaryKey().defaultRandom(),
  productionId: uuid('production_id').references(() => productions.id, { onDelete: 'cascade' }),
  companyId:    uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  userId:       uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  folderId:     uuid('folder_id').references(() => storageFolders.id, { onDelete: 'set null' }),
  name:         text('name').notNull(),
  mimeType:     text('mime_type').notNull(),
  size:         integer('size').notNull(),
  type:         storageFileTypeEnum('type').notNull(),
  physicalPath: text('physical_path').notNull(),
  hidden:       boolean('hidden').notNull().default(false),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  // Both are hot: productionId drives the browser listing, storage stats and
  // the production cascade delete; folderId drives every folder navigation.
  index('storage_files_production_idx').on(t.productionId),
  index('storage_files_folder_idx').on(t.folderId),
]);

export const storageImageVersions = pgTable('storage_image_versions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  fileId:       uuid('file_id').notNull().references(() => storageFiles.id, { onDelete: 'cascade' }),
  quality:      integer('quality').notNull(),
  physicalPath: text('physical_path').notNull(),
  size:         integer('size').notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  // Looked up on every image serve that asks for a quality.
  index('storage_image_versions_file_idx').on(t.fileId),
]);

export const productionRoles = pgTable('production_roles', {
  id:           uuid('id').primaryKey().defaultRandom(),
  productionId: uuid('production_id').notNull().references(() => productions.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  hue:          integer('hue').notNull(),                 // OKLCH hue 0–360
  permissions: bigint('permissions', { mode: 'bigint' }).notNull().default(sql`0`),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('role_name_uq').on(t.productionId, t.name)]);

export const productionMembers = pgTable('production_members', {
  id:           uuid('id').primaryKey().defaultRandom(),
  productionId: uuid('production_id').notNull().references(() => productions.id, { onDelete: 'cascade' }),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId:       uuid('role_id').references(() => productionRoles.id, { onDelete: 'set null' }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('prod_member_uq').on(t.productionId, t.userId),
  // productionAccessFilter() filters by userId alone on every list request, and
  // prod_member_uq leads with productionId — so it can't serve that query.
  index('prod_member_user_idx').on(t.userId),
]);

export const companyMembers = pgTable('company_members', {
  id:           uuid('id').primaryKey().defaultRandom(),
  companyId:    uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:         companyRoleEnum('role').notNull().default('member'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('company_member_uq').on(t.companyId, t.userId),
  // Same reason as prod_member_user_idx — company_member_uq leads with companyId.
  index('company_member_user_idx').on(t.userId),
]);

export const trackTypes = pgTable(
  "track_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hue: integer("hue").notNull().default(250), // oklch hue 0-360; theme decides lightness/chroma
    icon: text("icon"), // 'mdi:*' name; null = no icon. Tracks may override it.
    trackMode: trackModeEnum("track_mode").notNull().default("clip"),
    sourceSetId: uuid("source_set_id")
      .references(() => sourceSet.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    // Editor behaviors — configured per type on the track-types page.
    trackDisplay: trackDisplayEnum("track_display").notNull().default("normal"), // 'ruler' = slim pinned strip
    nameDisplay:  nameDisplayEnum("name_display").notNull().default("normal"),   // clip label rendering
    clipDisplay:  clipDisplayEnum("clip_display").notNull().default("normal"),   // clip body rendering
    metronome:    boolean("metronome").notNull().default(false),                 // clips carry data.bpm
    tts:          boolean("tts").notNull().default(false),                       // read clip labels aloud
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("track_types_name_uq").on(t.productionId, t.name),
  ],
);

export const tracks = pgTable("tracks", {
    id: uuid("id").defaultRandom().primaryKey(),
    timelineId: uuid("timeline_id")
      .notNull()
      .references(() => timelines.id, { onDelete: "cascade" }),
    typeId: uuid("type_id")
      .notNull()
      .references(() => trackTypes.id),
    sourceId: uuid("source_id")
      .references(() => sources.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    // Overrides the track type's icon for this track alone; null = inherit.
    icon: text("icon"),
    mode: trackModeEnum("mode").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isMuted: boolean("is_muted").notNull().default(false),
    isLocked: boolean("is_locked").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("tracks_timeline_idx").on(t.timelineId),
  ],
);

export const timelines = pgTable("timelines", {
    id: uuid("id").defaultRandom().primaryKey(),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Same convention as companies/productions: a storageFiles id, no FK, so
    // clients resolve it through /storage/[id]/serve?quality=…
    profileImageId: uuid("profile_image_id"),
    frameRate: frameRateEnum("frame_rate").notNull().default("25"),
    startFrame: integer("start_tc").notNull().default(0),
    endFrame: integer("end_tc").notNull(),
    ltcOffsetFrames: integer("ltc_offset_frames").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("timelines_production_idx").on(t.productionId),
  ],
);

export const sourceSet = pgTable("source_set", {
  id: uuid("id").defaultRandom().primaryKey(),
  productionId: uuid("production_id")
    .notNull()
    .references(() => productions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon"), // 'mdi:*' name shown wherever the set is listed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("source_set_production_idx").on(t.productionId),
]);

export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  productionId: uuid("production_id")
    .notNull()
    .references(() => productions.id, { onDelete: "cascade" }),
  sourceSetId: uuid("source_set_id")
    .references(() => sourceSet.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  hue: integer("hue").notNull(),
  icon: text("icon"), // 'mdi:*' name; each source in a set can differ
  data: jsonb("data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Leading productionId serves both the timeline bootstrap (productionId
  // alone) and the per-set listing (productionId + sourceSetId).
  index("sources_production_set_idx").on(t.productionId, t.sourceSetId),
]);

export const clips = pgTable(
  "clips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    label: text("label").notNull().default(""),
 
    position: integer("position").notNull(),
 
    // Clip mode
    fileId: uuid("file_id")
      .references(() => storageFiles.id, { onDelete: "set null" }),
    mediaStart: integer("media_start"),
    end: integer("end"),
 
    // Free mode
    sourceId: uuid("source_id")
      .references(() => sources.id, { onDelete: "set null" }),
 
    // Type-specific data
    data: jsonb("data"),
 
    hue: integer("hue"), // oklch hue 0-360; null = inherit the track type's hue
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("clips_track_position_idx").on(t.trackId, t.position),
    index("clips_source_idx").on(t.sourceId),
    check(
      "clips_valid_media_range",
      sql`"media_start" IS NULL OR "end" IS NULL OR "end" > "media_start"`,
    ),
    check(
      "clips_media_pair",
      sql`("media_start" IS NULL) = ("end" IS NULL)`,
    ),
  ],
);
 
// ─── Aktivitet ───────────────────────────────────────────────────────

/**
 * What an activity row points at. `entityId` is deliberately un-constrained
 * (no FK) so one log can cover every kind of entity — readers join to the
 * concrete table, which also makes rows for deleted entities fall out of
 * results on their own.
 */
export const activityEntityEnum = pgEnum('activity_entity', [
  'timeline', 'production', 'company', 'file',
]);

export const activityActionEnum = pgEnum('activity_action', [
  'open', 'create', 'update', 'delete',
]);

/**
 * Generic per-user activity log. Today it feeds the home page's "recently
 * opened" lists; the shape is intentionally open-ended (any entity, any
 * action, free-form `data`) so later features can log into the same table.
 *
 * Repeats of the same user/entity/action inside a short window are COALESCED
 * onto the existing row — `occurredAt` moves forward and `count` increments —
 * so a user reopening a timeline all day leaves one row, not hundreds.
 */
export const activity = pgTable(
  'activity',
  {
    id:         uuid('id').primaryKey().defaultRandom(),
    userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    entityType: activityEntityEnum('entity_type').notNull(),
    entityId:   uuid('entity_id').notNull(),
    action:     activityActionEnum('action').notNull().default('open'),
    // Scope columns — nullable because not every entity has both. They give
    // future features a cheap "everything that happened in this production"
    // query, and let a deleted production take its log rows with it.
    productionId: uuid('production_id').references(() => productions.id, { onDelete: 'cascade' }),
    companyId:    uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    data:       jsonb('data'),
    count:      integer('count').notNull().default(1),
    occurredAt: timestamp('occurred_at').notNull().defaultNow(),  // last occurrence
    createdAt:  timestamp('created_at').notNull().defaultNow(),   // first occurrence
  },
  (t) => [
    index('activity_user_recent_idx').on(t.userId, t.occurredAt),
    index('activity_user_entity_idx').on(t.userId, t.entityType, t.entityId, t.action),
    index('activity_entity_idx').on(t.entityType, t.entityId),
  ],
);

// ─── Notater ─────────────────────────────────────────────────────────

export const clipNotes = pgTable(
  "clip_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clips.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("clip_notes_clip_idx").on(t.clipId),
  ],
);