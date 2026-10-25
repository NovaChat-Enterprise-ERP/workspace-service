import type {
  AuditLogDto,
  InviteDto,
  MemberDto,
  RoleDto,
  WorkspaceAccessDto,
  WorkspaceDto,
  WorkspaceSummaryDto,
} from '@novachat-enterprise-erp/contracts';
import type { AuditLogRow, InviteRow, MemberWithRole, RoleRow, WorkspaceRow } from '../db/schema.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const toWorkspaceDto = (w: WorkspaceRow): WorkspaceDto => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  logoUrl: w.logoUrl,
  description: w.description,
  ownerId: w.ownerId,
  allowMemberInvites: w.allowMemberInvites,
  createdAt: w.createdAt.toISOString(),
});

export const toWorkspaceSummary = (w: WorkspaceRow, memberId: string, role: RoleRow): WorkspaceSummaryDto => ({
  ...toWorkspaceDto(w),
  memberId,
  role: role.key,
  permissions: role.permissions,
});

export const toMemberDto = (m: MemberWithRole, now = new Date()): MemberDto => {
  const statusActive = !m.statusExpiresAt || m.statusExpiresAt > now;
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    userId: m.userId,
    name: m.name,
    username: m.username,
    email: m.email,
    image: m.image,
    title: m.title,
    role: { id: m.role.id, key: m.role.key, name: m.role.name },
    status: {
      emoji: statusActive ? m.statusEmoji : null,
      text: statusActive ? m.statusText : null,
      expiresAt: statusActive ? iso(m.statusExpiresAt) : null,
    },
    isAway: m.isAway,
    notificationsPausedUntil: iso(m.notificationsPausedUntil),
    deactivatedAt: iso(m.deactivatedAt),
    joinedAt: m.joinedAt.toISOString(),
  };
};

export const toAccessDto = (m: MemberWithRole): WorkspaceAccessDto => ({
  workspaceId: m.workspaceId,
  memberId: m.id,
  role: m.role.key,
  permissions: m.role.permissions,
  deactivated: m.deactivatedAt !== null,
});

export const toRoleDto = (r: RoleRow & { memberCount?: number }): RoleDto => ({
  id: r.id,
  workspaceId: r.workspaceId,
  key: r.key,
  name: r.name,
  description: r.description,
  permissions: r.permissions,
  isSystem: r.isSystem,
  memberCount: r.memberCount ?? 0,
});

export const toInviteDto = (i: InviteRow, role: RoleRow, url?: string): InviteDto => ({
  id: i.id,
  workspaceId: i.workspaceId,
  email: i.email,
  roleId: role.id,
  roleName: role.name,
  invitedBy: i.invitedBy,
  expiresAt: i.expiresAt.toISOString(),
  maxUses: i.maxUses,
  uses: i.uses,
  revokedAt: iso(i.revokedAt),
  createdAt: i.createdAt.toISOString(),
  ...(url ? { url } : {}),
});

export const toAuditDto = (a: AuditLogRow): AuditLogDto => ({
  id: a.id,
  workspaceId: a.workspaceId,
  actorId: a.actorId,
  action: a.action,
  targetType: a.targetType,
  targetId: a.targetId,
  metadata: a.metadata,
  createdAt: a.createdAt.toISOString(),
});
