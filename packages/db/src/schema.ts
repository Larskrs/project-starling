import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, text, boolean, timestamp, uniqueIndex, integer, type AnyPgColumn, bigint, index, jsonb, numeric, check } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);
export const companyRoleEnum = pgEnum('company_role', ['owner', 'admin', 'member']);
export const trackModeEnum = pgEnum("track_mode", [
  "event", // Point Events — cameras, people; position only
  "clip",  // MediaClip — position + mediaStart + end + optional fileId
]);
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
});

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
});

export const storageImageVersions = pgTable('storage_image_versions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  fileId:       uuid('file_id').notNull().references(() => storageFiles.id, { onDelete: 'cascade' }),
  quality:      integer('quality').notNull(),
  physicalPath: text('physical_path').notNull(),
  size:         integer('size').notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

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
}, (t) => [uniqueIndex('prod_member_uq').on(t.productionId, t.userId)]);

export const companyMembers = pgTable('company_members', {
  id:           uuid('id').primaryKey().defaultRandom(),
  companyId:    uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:         companyRoleEnum('role').notNull().default('member'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('company_member_uq').on(t.companyId, t.userId)]);

export const trackTypes = pgTable(
  "track_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productionId: uuid("production_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    trackMode: trackModeEnum("track_mode").notNull().default("clip"),
    sourceSetId: uuid("source_set_id")
      .references(() => sourceSet.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  data: jsonb("data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
 
    color: text("color"),
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