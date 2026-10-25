import {
  EVENTS,
  type ListMembersQuery,
  type MemberDto,
  type Page,
  type UpdateMyMembershipInput,
  type UserDto,
  type WorkspaceAccessDto,
} from '@novachat-enterprise-erp/contracts';
import { BadRequestError, NotFoundError, decodeCursor, encodeCursor, type MemberContext } from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { MemberWithRole } from '../db/schema.js';
import type { MemberPatch } from '../repositories/member.repository.js';
import type { UnitOfWork } from '../repositories/unit-of-work.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { toAccessDto, toMemberDto } from './mappers.js';
import type { MemberPolicy } from './member.policy.js';

export class MemberService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly policy: MemberPolicy,
    private readonly events: EventPublisher,
  ) {}

  async getMe(actor: MemberContext): Promise<MemberDto> {
    return toMemberDto(await this.load(actor.workspaceId, actor.memberId));
  }

  async updateMe(actor: MemberContext, input: UpdateMyMembershipInput): Promise<MemberDto> {
    const patch: MemberPatch = {};
    if (input.status) {
      patch.statusEmoji = input.status.emoji ?? null;
      patch.statusText = input.status.text ?? null;
      patch.statusExpiresAt = input.status.expiresAt ? new Date(input.status.expiresAt) : null;
    }
    if (input.isAway !== undefined) patch.isAway = input.isAway;
    if (input.title !== undefined) patch.title = input.title;
    if (input.notificationsPausedUntil !== undefined) {
      patch.notificationsPausedUntil = input.notificationsPausedUntil ? new Date(input.notificationsPausedUntil) : null;
    }
    await this.uow.repos.members.update(actor.memberId, patch);
    const member = toMemberDto(await this.load(actor.workspaceId, actor.memberId));
    await this.events.publish({
      type: EVENTS.MEMBER_STATUS_CHANGED,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      data: {
        userId: member.userId,
        memberId: member.id,
        status: member.status,
        isAway: member.isAway,
        notificationsPausedUntil: member.notificationsPausedUntil,
      },
    });
    return member;
  }

  async list(workspaceId: string, query: ListMembersQuery): Promise<Page<MemberDto>> {
    const after = decodeCursor<{ name: string; id: string }>(query.cursor);
    const rows = await this.uow.repos.members.list(workspaceId, {
      q: query.q,
      roleId: query.role,
      status: query.status,
      after,
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((m) => toMemberDto(m)),
      nextCursor: rows.length > query.limit && last ? encodeCursor({ name: last.name, id: last.id }) : null,
    };
  }

  async get(workspaceId: string, memberId: string): Promise<MemberDto> {
    return toMemberDto(await this.load(workspaceId, memberId));
  }

  async changeRole(actor: MemberContext, memberId: string, roleId: string): Promise<MemberDto> {
    const [actorMember, target, role] = await Promise.all([
      this.load(actor.workspaceId, actor.memberId),
      this.load(actor.workspaceId, memberId),
      this.uow.repos.roles.findById(actor.workspaceId, roleId),
    ]);
    if (!role) throw new NotFoundError('Role');
    this.policy.assertCanManage(actorMember, target);
    this.policy.assertCanAssign(actorMember, role);
    if (target.roleId === role.id) return toMemberDto(target);

    await this.uow.transaction(async (repos) => {
      await repos.members.update(target.id, { roleId: role.id });
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
        targetType: 'member',
        targetId: target.id,
        metadata: { from: target.role.key, to: role.key },
      });
    });
    await this.events.publish({
      type: EVENTS.MEMBER_ROLE_CHANGED,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      data: { userId: target.userId, memberId: target.id, role: role.key },
    });
    return toMemberDto(await this.load(actor.workspaceId, target.id));
  }

  async deactivate(actor: MemberContext, memberId: string): Promise<MemberDto> {
    return this.setActive(actor, memberId, false);
  }

  async reactivate(actor: MemberContext, memberId: string): Promise<MemberDto> {
    return this.setActive(actor, memberId, true);
  }

  async remove(actor: MemberContext, memberId: string): Promise<void> {
    const [actorMember, target] = await Promise.all([
      this.load(actor.workspaceId, actor.memberId),
      this.load(actor.workspaceId, memberId),
    ]);
    this.policy.assertCanManage(actorMember, target);
    await this.uow.transaction(async (repos) => {
      await repos.members.delete(target.id);
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.MEMBER_REMOVED,
        targetType: 'member',
        targetId: target.id,
        metadata: { userId: target.userId, name: target.name },
      });
    });
    await this.events.publish({
      type: EVENTS.MEMBER_REMOVED,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      data: { userId: target.userId, memberId: target.id, reason: 'removed' },
    });
  }

  async access(workspaceId: string, userId: string): Promise<WorkspaceAccessDto | null> {
    const workspace = await this.uow.repos.workspaces.findById(workspaceId).catch(() => null);
    if (!workspace) return null;
    const member = await this.uow.repos.members.findByUser(workspaceId, userId);
    return member ? toAccessDto(member) : null;
  }

  async findByUsers(workspaceId: string, userIds: string[]): Promise<MemberDto[]> {
    const rows = await this.uow.repos.members.findByUsers(workspaceId, [...new Set(userIds)]);
    return rows.map((m) => toMemberDto(m));
  }

  async findByUser(workspaceId: string, userId: string): Promise<MemberDto> {
    const member = await this.uow.repos.members.findByUser(workspaceId, userId);
    if (!member) throw new NotFoundError('Member');
    return toMemberDto(member);
  }

  async syncProfile(user: Pick<UserDto, 'id' | 'name' | 'username' | 'email' | 'image'>): Promise<void> {
    await this.uow.repos.members.updateProfileForUser(user.id, {
      name: user.name,
      username: user.username,
      email: user.email,
      image: user.image,
    });
  }

  private async setActive(actor: MemberContext, memberId: string, active: boolean): Promise<MemberDto> {
    const [actorMember, target] = await Promise.all([
      this.load(actor.workspaceId, actor.memberId),
      this.load(actor.workspaceId, memberId),
    ]);
    this.policy.assertCanManage(actorMember, target);
    if (active === (target.deactivatedAt === null)) {
      throw new BadRequestError(active ? 'Member is already active' : 'Member is already deactivated');
    }
    await this.uow.transaction(async (repos) => {
      await repos.members.update(target.id, { deactivatedAt: active ? null : new Date() });
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: active ? AUDIT_ACTIONS.MEMBER_REACTIVATED : AUDIT_ACTIONS.MEMBER_DEACTIVATED,
        targetType: 'member',
        targetId: target.id,
      });
    });
    await this.events.publish({
      type: active ? EVENTS.MEMBER_REACTIVATED : EVENTS.MEMBER_DEACTIVATED,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      data: { userId: target.userId, memberId: target.id },
    });
    return toMemberDto(await this.load(actor.workspaceId, target.id));
  }

  private async load(workspaceId: string, memberId: string): Promise<MemberWithRole> {
    const member = await this.uow.repos.members.findById(workspaceId, memberId);
    if (!member) throw new NotFoundError('Member');
    return member;
  }
}
