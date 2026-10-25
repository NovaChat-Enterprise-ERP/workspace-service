import type { AuditLogDto, Page } from '@novachat-enterprise-erp/contracts';
import { decodeCursor, encodeCursor } from '@novachat-enterprise-erp/common';
import type { AuditLogRepository, NewAuditLog } from '../repositories/audit-log.repository.js';
import { toAuditDto } from './mappers.js';

export const AUDIT_ACTIONS = {
  WORKSPACE_CREATED: 'workspace.created',
  WORKSPACE_UPDATED: 'workspace.updated',
  WORKSPACE_DELETED: 'workspace.deleted',
  OWNERSHIP_TRANSFERRED: 'ownership.transferred',
  MEMBER_JOINED: 'member.joined',
  MEMBER_LEFT: 'member.left',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  MEMBER_DEACTIVATED: 'member.deactivated',
  MEMBER_REACTIVATED: 'member.reactivated',
  MEMBER_REMOVED: 'member.removed',
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  INVITE_CREATED: 'invite.created',
  INVITE_REVOKED: 'invite.revoked',
} as const;

export type AuditEntry = NewAuditLog;

export class AuditService {
  constructor(private readonly auditLogs: AuditLogRepository) {}

  async list(workspaceId: string, cursor: string | undefined, limit: number): Promise<Page<AuditLogDto>> {
    const before = decodeCursor<{ createdAt: string; id: string }>(cursor);
    const rows = await this.auditLogs.list(workspaceId, before, limit + 1);
    const items = rows.slice(0, limit).map(toAuditDto);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }
}
