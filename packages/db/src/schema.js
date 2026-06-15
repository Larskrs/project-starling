"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessions = exports.users = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    email: (0, pg_core_1.text)('email').notNull().unique(),
    name: (0, pg_core_1.text)('name').notNull(),
    hashedPassword: (0, pg_core_1.text)('hashed_password').notNull(),
    isEmailVerified: (0, pg_core_1.boolean)('is_email_verified').notNull().default(false),
    isAdministrator: (0, pg_core_1.boolean)('is_administrator').notNull().default(false),
    createdAt: (0, pg_core_1.timestamp)('created_at').notNull().defaultNow(),
});
exports.sessions = (0, pg_core_1.pgTable)('sessions', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    userId: (0, pg_core_1.integer)('user_id').notNull().references(() => exports.users.id, { onDelete: 'cascade' }),
    role: (0, pg_core_1.text)('role').$type().notNull(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at').notNull(),
});
