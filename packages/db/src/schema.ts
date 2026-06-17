import { pgTable, pgEnum, uuid, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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