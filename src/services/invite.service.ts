import {
  EVENTS,
  PERMISSIONS,
  SYSTEM_ROLES,
  type CreateInviteLinkInput,
  type CreateInvitesInput,
  type InviteDto,
  type InvitePreviewDto,
  type WorkspaceSummaryDto,
} from '@novachat-enterprise-erp/contracts';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  isUniqueViolation,
  randomToken,
  sha256,
  type MemberContext,
  type UserContext,
} from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { RoleRow, WorkspaceRow } from '../db/schema.js';
import type { InviteWithRole } from '../repositories/invite.repository.js';
import type { UnitOfWork } from '../repositories/unit-of-work.js';
import type { UserDirectory } from '../providers/user-directory.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { toInviteDto, toWorkspaceSummary } from './mappers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_INVITE_DAYS = 14;

type InvalidReason = NonNullable<InvitePreviewDto['reason']>;

export class InviteService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserDirectory,
    private readonly events: EventPublisher,
    private readonly publicAppUrl: string,
  ) {}

  async createEmailInvites(actor: MemberContext, input: CreateInvitesInput): Promise<InviteDto[]> {
    const { workspace, role } = await this.prepare(actor, input.roleId);
    const emails = [...new Set(input.emails)];
    const tokens = emails.map(() => randomToken());
    const expiresAt = new Date(Date.now() + EMAIL_INVITE_DAYS * DAY_MS);

    const rows = await this.uow.transaction(async (repos) => {
      const created = await repos.invites.createMany(
        emails.map((email, i) => ({
          workspaceId: workspace.id,
          email,
          tokenHash: sha256(tokens[i]!),
          roleId: role.id,
          invitedBy: actor.userId,
          expiresAt,
          maxUses: 1,
        })),
      );
      await repos.auditLogs.record({
        workspaceId: workspace.id,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.INVITE_CREATED,
        targetType: 'invite',
        metadata: { emails, role: role.key },
      });
      return created;
    });

    const invites = rows.map((row, i) => toInviteDto(row, role, this.url(tokens[i]!)));
    for (const invite of invites) {
      await this.events.publish({
        type: EVENTS.INVITE_CREATED,
        workspaceId: workspace.id,
        actorId: actor.userId,
        data: {
          inviteId: invite.id,
          email: invite.email,
          url: invite.url,
          workspaceName: workspace.name,
          inviterName: actor.name ?? null,
          expiresAt: invite.expiresAt,
        },
      });
    }
    return invites;
  }

  async createLink(actor: MemberContext, input: CreateInviteLinkInput): Promise<InviteDto> {
    const { workspace, role } = await this.prepare(actor, input.roleId);
    const token = randomToken();
    const row = await this.uow.transaction(async (repos) => {
      const [created] = await repos.invites.createMany([
        {
          workspaceId: workspace.id,
          email: null,
          tokenHash: sha256(token),
          roleId: role.id,
          invitedBy: actor.userId,
          expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
          maxUses: input.maxUses,
        },
      ]);
      await repos.auditLogs.record({
        workspaceId: workspace.id,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.INVITE_CREATED,
        targetType: 'invite',
        targetId: created!.id,
        metadata: { link: true, role: role.key, maxUses: input.maxUses },
      });
      return created!;
    });
    return toInviteDto(row, role, this.url(token));
  }

  async list(workspaceId: string): Promise<InviteDto[]> {
    const rows = await this.uow.repos.invites.listActive(workspaceId);
    return rows.map((r) => toInviteDto(r, r.role));
  }

  async revoke(actor: MemberContext, inviteId: string): Promise<void> {
    const invite = await this.uow.repos.invites.findById(actor.workspaceId, inviteId);
    if (!invite) throw new NotFoundError('Invite');
    await this.uow.transaction(async (repos) => {
      await repos.invites.revoke(invite.id);
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.INVITE_REVOKED,
        targetType: 'invite',
        targetId: invite.id,
      });
    });
  }

  async preview(token: string): Promise<InvitePreviewDto> {
    const { invite, workspace } = await this.lookup(token);
    const inviter = await this.uow.repos.members.findByUser(workspace.id, invite.invitedBy);
    const reason = this.invalidReason(invite);
    return {
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, logoUrl: workspace.logoUrl },
      inviterName: inviter?.name ?? null,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
      valid: !reason,
      ...(reason ? { reason } : {}),
    };
  }

  async accept(token: string, actor: UserContext): Promise<WorkspaceSummaryDto> {
    const { invite, workspace } = await this.lookup(token);
    const existing = await this.uow.repos.members.findByUser(workspace.id, actor.userId);
    if (existing) {
      if (existing.deactivatedAt) throw new ForbiddenError('Your account has been deactivated in this workspace');
      return toWorkspaceSummary(workspace, existing.id, existing.role);
    }

    const reason = this.invalidReason(invite);
    if (reason) throw new AppError(410, `INVITE_${reason.toUpperCase()}`, `This invite is ${reason}`);

    const profile = await this.users.getProfile(actor.userId);
    if (!profile) throw new NotFoundError('User profile');
    if (invite.email && invite.email.toLowerCase() !== profile.email.toLowerCase()) {
      throw new ForbiddenError(`This invite was sent to ${invite.email}. Sign in with that account to accept it.`);
    }

    try {
      const member = await this.uow.transaction(async (repos) => {
        if (!(await repos.invites.consumeUse(invite.id))) {
          throw new AppError(410, 'INVITE_EXHAUSTED', 'This invite is no longer valid');
        }
        const created = await repos.members.create({
          workspaceId: workspace.id,
          userId: actor.userId,
          roleId: invite.roleId,
          name: profile.name,
          username: profile.username,
          email: profile.email,
          image: profile.image,
        });
        await repos.auditLogs.record({
          workspaceId: workspace.id,
          actorId: actor.userId,
          action: AUDIT_ACTIONS.MEMBER_JOINED,
          targetType: 'member',
          targetId: created.id,
          metadata: { inviteId: invite.id, invitedBy: invite.invitedBy },
        });
        return created;
      });

      await this.events.publish({
        type: EVENTS.INVITE_ACCEPTED,
        workspaceId: workspace.id,
        actorId: actor.userId,
        data: { inviteId: invite.id, invitedBy: invite.invitedBy, userId: actor.userId },
      });
      await this.events.publish({
        type: EVENTS.MEMBER_JOINED,
        workspaceId: workspace.id,
        actorId: actor.userId,
        data: { userId: actor.userId, memberId: member.id, role: invite.role.key },
      });
      return toWorkspaceSummary(workspace, member.id, invite.role);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const member = await this.uow.repos.members.findByUser(workspace.id, actor.userId);
      return toWorkspaceSummary(workspace, member!.id, member!.role);
    }
  }

  private async prepare(actor: MemberContext, roleId: string | undefined): Promise<{ workspace: WorkspaceRow; role: RoleRow }> {
    const { repos } = this.uow;
    const workspace = await repos.workspaces.findById(actor.workspaceId);
    if (!workspace) throw new NotFoundError('Workspace');
    const canManage = actor.permissions.includes(PERMISSIONS.MEMBERS_MANAGE);
    if (!workspace.allowMemberInvites && !canManage) {
      throw new ForbiddenError('Only admins can invite people to this workspace');
    }
    const role = roleId
      ? await repos.roles.findById(workspace.id, roleId)
      : await repos.roles.findByKey(workspace.id, SYSTEM_ROLES.MEMBER);
    if (!role) throw new NotFoundError('Role');
    if (role.key === SYSTEM_ROLES.OWNER) throw new ForbiddenError('You cannot invite someone as owner');
    if (!canManage && role.key !== SYSTEM_ROLES.MEMBER && role.key !== SYSTEM_ROLES.GUEST) {
      throw new ForbiddenError('You can only invite members or guests');
    }
    return { workspace, role };
  }

  private async lookup(token: string): Promise<{ invite: InviteWithRole; workspace: WorkspaceRow }> {
    const invite = await this.uow.repos.invites.findByTokenHash(sha256(token));
    if (!invite) throw new NotFoundError('Invite');
    const workspace = await this.uow.repos.workspaces.findById(invite.workspaceId);
    if (!workspace) throw new NotFoundError('Invite');
    return { invite, workspace };
  }

  private invalidReason(invite: InviteWithRole): InvalidReason | null {
    if (invite.revokedAt) return 'revoked';
    if (invite.expiresAt <= new Date()) return 'expired';
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) return 'exhausted';
    return null;
  }

  private url(token: string): string {
    return `${this.publicAppUrl}/invite/${token}`;
  }
}
