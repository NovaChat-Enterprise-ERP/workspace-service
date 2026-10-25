import {
  DEFAULT_ROLE_PERMISSIONS,
  EVENTS,
  SYSTEM_ROLES,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceDto,
  type WorkspaceSummaryDto,
} from '@novachat-enterprise-erp/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  isUniqueViolation,
  type MemberContext,
  type UserContext,
} from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { UnitOfWork } from '../repositories/unit-of-work.js';
import type { UserDirectory } from '../providers/user-directory.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { toWorkspaceDto, toWorkspaceSummary } from './mappers.js';

const SYSTEM_ROLE_NAMES: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

export class WorkspaceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserDirectory,
    private readonly events: EventPublisher,
  ) {}

  async create(actor: UserContext, input: CreateWorkspaceInput): Promise<WorkspaceSummaryDto> {
    if (await this.uow.repos.workspaces.findBySlug(input.slug)) throw new ConflictError('That URL is already taken');
    const profile = await this.users.getProfile(actor.userId);
    if (!profile) throw new NotFoundError('User profile');

    try {
      const result = await this.uow.transaction(async (repos) => {
        const workspace = await repos.workspaces.create({ ...input, ownerId: actor.userId });
        const roles = await repos.roles.createMany(
          Object.values(SYSTEM_ROLES).map((key) => ({
            workspaceId: workspace.id,
            key,
            name: SYSTEM_ROLE_NAMES[key]!,
            permissions: DEFAULT_ROLE_PERMISSIONS[key],
            isSystem: true,
          })),
        );
        const ownerRole = roles.find((r) => r.key === SYSTEM_ROLES.OWNER)!;
        const member = await repos.members.create({
          workspaceId: workspace.id,
          userId: actor.userId,
          roleId: ownerRole.id,
          name: profile.name,
          username: profile.username,
          email: profile.email,
          image: profile.image,
        });
        await repos.auditLogs.record({
          workspaceId: workspace.id,
          actorId: actor.userId,
          action: AUDIT_ACTIONS.WORKSPACE_CREATED,
          targetType: 'workspace',
          targetId: workspace.id,
        });
        return { workspace, member, ownerRole };
      });

      const dto = toWorkspaceSummary(result.workspace, result.member.id, result.ownerRole);
      await this.events.publish({
        type: EVENTS.WORKSPACE_CREATED,
        workspaceId: dto.id,
        actorId: actor.userId,
        data: { workspace: toWorkspaceDto(result.workspace), ownerMemberId: result.member.id },
      });
      await this.events.publish({
        type: EVENTS.MEMBER_JOINED,
        workspaceId: dto.id,
        actorId: actor.userId,
        data: { userId: actor.userId, memberId: result.member.id, role: SYSTEM_ROLES.OWNER },
      });
      return dto;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('That URL is already taken');
      throw error;
    }
  }

  async listMine(userId: string): Promise<WorkspaceSummaryDto[]> {
    const memberships = await this.uow.repos.workspaces.listForUser(userId);
    return memberships.map((m) => toWorkspaceSummary(m.workspace, m.memberId, m.role));
  }

  async getBySlugForUser(slug: string, userId: string): Promise<WorkspaceSummaryDto> {
    const workspace = await this.uow.repos.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundError('Workspace');
    const member = await this.uow.repos.members.findByUser(workspace.id, userId);
    if (!member || member.deactivatedAt) throw new NotFoundError('Workspace');
    return toWorkspaceSummary(workspace, member.id, member.role);
  }

  async get(workspaceId: string): Promise<WorkspaceDto> {
    const workspace = await this.uow.repos.workspaces.findById(workspaceId);
    if (!workspace) throw new NotFoundError('Workspace');
    return toWorkspaceDto(workspace);
  }

  async update(actor: MemberContext, input: UpdateWorkspaceInput): Promise<WorkspaceDto> {
    if (input.slug) {
      const existing = await this.uow.repos.workspaces.findBySlug(input.slug);
      if (existing && existing.id !== actor.workspaceId) throw new ConflictError('That URL is already taken');
    }
    const workspace = await this.uow.transaction(async (repos) => {
      const row = await repos.workspaces.update(actor.workspaceId, input);
      if (!row) throw new NotFoundError('Workspace');
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.WORKSPACE_UPDATED,
        targetType: 'workspace',
        targetId: actor.workspaceId,
        metadata: { changes: Object.keys(input) },
      });
      return row;
    });
    const dto = toWorkspaceDto(workspace);
    await this.events.publish({ type: EVENTS.WORKSPACE_UPDATED, workspaceId: dto.id, actorId: actor.userId, data: dto });
    return dto;
  }

  async delete(actor: MemberContext): Promise<void> {
    const workspace = await this.uow.repos.workspaces.findById(actor.workspaceId);
    if (!workspace) throw new NotFoundError('Workspace');
    if (workspace.ownerId !== actor.userId) throw new ForbiddenError('Only the owner can delete the workspace');
    await this.uow.transaction(async (repos) => {
      await repos.workspaces.update(workspace.id, { deletedAt: new Date(), slug: `${workspace.slug}-deleted-${Date.now()}` });
      await repos.auditLogs.record({
        workspaceId: workspace.id,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.WORKSPACE_DELETED,
        targetType: 'workspace',
        targetId: workspace.id,
      });
    });
    await this.events.publish({
      type: EVENTS.WORKSPACE_UPDATED,
      workspaceId: workspace.id,
      actorId: actor.userId,
      data: { ...toWorkspaceDto(workspace), deleted: true },
    });
  }

  async leave(actor: MemberContext): Promise<void> {
    const member = await this.uow.repos.members.findById(actor.workspaceId, actor.memberId);
    if (!member) throw new NotFoundError('Member');
    if (member.role.key === SYSTEM_ROLES.OWNER) {
      throw new ForbiddenError('Transfer ownership before leaving the workspace');
    }
    await this.uow.transaction(async (repos) => {
      await repos.members.delete(member.id);
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.MEMBER_LEFT,
        targetType: 'member',
        targetId: member.id,
      });
    });
    await this.events.publish({
      type: EVENTS.MEMBER_REMOVED,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      data: { userId: member.userId, memberId: member.id, reason: 'left' },
    });
  }

  async transferOwnership(actor: MemberContext, targetMemberId: string): Promise<void> {
    const { repos } = this.uow;
    const [workspace, current, target] = await Promise.all([
      repos.workspaces.findById(actor.workspaceId),
      repos.members.findById(actor.workspaceId, actor.memberId),
      repos.members.findById(actor.workspaceId, targetMemberId),
    ]);
    if (!workspace || !current) throw new NotFoundError('Workspace');
    if (workspace.ownerId !== actor.userId) throw new ForbiddenError('Only the owner can transfer ownership');
    if (!target || target.deactivatedAt) throw new NotFoundError('Member');
    if (target.id === current.id) throw new ForbiddenError('You already own this workspace');

    const [ownerRole, adminRole] = await Promise.all([
      repos.roles.findByKey(workspace.id, SYSTEM_ROLES.OWNER),
      repos.roles.findByKey(workspace.id, SYSTEM_ROLES.ADMIN),
    ]);
    await this.uow.transaction(async (tx) => {
      await tx.members.update(target.id, { roleId: ownerRole!.id });
      await tx.members.update(current.id, { roleId: adminRole!.id });
      await tx.workspaces.update(workspace.id, { ownerId: target.userId });
      await tx.auditLogs.record({
        workspaceId: workspace.id,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.OWNERSHIP_TRANSFERRED,
        targetType: 'member',
        targetId: target.id,
      });
    });
    for (const [member, role] of [
      [target, SYSTEM_ROLES.OWNER],
      [current, SYSTEM_ROLES.ADMIN],
    ] as const) {
      await this.events.publish({
        type: EVENTS.MEMBER_ROLE_CHANGED,
        workspaceId: workspace.id,
        actorId: actor.userId,
        data: { userId: member.userId, memberId: member.id, role },
      });
    }
  }
}
