import { pgTable, pgEnum, uuid, text, boolean, timestamp, uniqueIndex, integer, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

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
  createdAt:       timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id:        text('id').primaryKey(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
});

export const companies = pgTable('companies', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  slug:      text('slug').notNull().unique(), // global
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const productions = pgTable('productions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  slug:      text('slug').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
  productionId: uuid('production_id').notNull().references(() => productions.id, { onDelete: 'cascade' }),
  folderId:     uuid('folder_id').references(() => storageFolders.id, { onDelete: 'set null' }),
  name:         text('name').notNull(),
  mimeType:     text('mime_type').notNull(),
  size:         integer('size').notNull(),
  type:         storageFileTypeEnum('type').notNull(),
  physicalPath: text('physical_path').notNull(),
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