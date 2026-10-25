import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const workspaceSchema = pgSchema('workspace');

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const workspaces = workspaceSchema.table('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  description: text('description'),
  ownerId: text('owner_id').notNull(),
  allowMemberInvites: boolean('allow_member_invites').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
});

export const roles = workspaceSchema.table(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('roles_workspace_key_uq').on(t.workspaceId, t.key)],
);

export const members = workspaceSchema.table(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    name: text('name').notNull(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    image: text('image'),
    title: text('title'),
    statusEmoji: text('status_emoji'),
    statusText: text('status_text'),
    statusExpiresAt: timestamp('status_expires_at', { withTimezone: true }),
    isAway: boolean('is_away').notNull().default(false),
    notificationsPausedUntil: timestamp('notifications_paused_until', { withTimezone: true }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('members_workspace_user_uq').on(t.workspaceId, t.userId),
    index('members_user_idx').on(t.userId),
    index('members_role_idx').on(t.roleId),
  ],
);

export const invites = workspaceSchema.table(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email'),
    tokenHash: text('token_hash').notNull().unique(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    invitedBy: text('invited_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invites_workspace_idx').on(t.workspaceId)],
);

export const auditLogs = workspaceSchema.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_workspace_created_idx').on(t.workspaceId, t.createdAt)],
);

export const schema = { workspaces, roles, members, invites, auditLogs };

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type MemberWithRole = MemberRow & { role: RoleRow };
