import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, text, boolean, timestamp, uniqueIndex, integer, type AnyPgColumn, bigint } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);
export const companyRoleEnum = pgEnum('company_role', ['owner', 'admin', 'member']);

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

