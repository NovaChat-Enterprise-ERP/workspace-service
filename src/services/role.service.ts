import { randomBytes } from 'node:crypto';
import {
  EVENTS,
  PERMISSIONS,
  SYSTEM_ROLES,
  type CreateRoleInput,
  type RoleDto,
  type UpdateRoleInput,
} from '@novachat-enterprise-erp/contracts';
import { BadRequestError, ForbiddenError, NotFoundError, type MemberContext } from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { UnitOfWork } from '../repositories/unit-of-work.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { toRoleDto } from './mappers.js';

const assertGrantable = (permissions: string[] | undefined) => {
  if (permissions?.includes(PERMISSIONS.WORKSPACE_DELETE)) {
    throw new BadRequestError('Only the owner can delete the workspace; this permission cannot be granted');
  }
};

export class RoleService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly events: EventPublisher,
  ) {}

  async list(workspaceId: string): Promise<RoleDto[]> {
    return (await this.uow.repos.roles.list(workspaceId)).map(toRoleDto);
  }

  async create(actor: MemberContext, input: CreateRoleInput): Promise<RoleDto> {
    assertGrantable(input.permissions);
    const key = `custom-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${randomBytes(3).toString('hex')}`;
    const role = await this.uow.transaction(async (repos) => {
      const [row] = await repos.roles.createMany([
        {
          workspaceId: actor.workspaceId,
          key,
          name: input.name,
          description: input.description ?? null,
          permissions: [...new Set(input.permissions)],
          isSystem: false,
        },
      ]);
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.ROLE_CREATED,
        targetType: 'role',
        targetId: row!.id,
        metadata: { name: input.name },
      });
      return row!;
    });
    await this.publishChange(actor, role.id);
    return toRoleDto(role);
  }

  async update(actor: MemberContext, roleId: string, input: UpdateRoleInput): Promise<RoleDto> {
    const role = await this.uow.repos.roles.findById(actor.workspaceId, roleId);
    if (!role) throw new NotFoundError('Role');
    if (role.key === SYSTEM_ROLES.OWNER) throw new ForbiddenError('The owner role cannot be modified');
    if (role.isSystem && input.name && input.name !== role.name) {
      throw new BadRequestError('System roles cannot be renamed');
    }
    assertGrantable(input.permissions);

    const updated = await this.uow.transaction(async (repos) => {
      const row = await repos.roles.update(role.id, {
        ...input,
        permissions: input.permissions ? [...new Set(input.permissions)] : undefined,
      });
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.ROLE_UPDATED,
        targetType: 'role',
        targetId: role.id,
        metadata: { changes: Object.keys(input) },
      });
      return row!;
    });
    await this.publishChange(actor, role.id);
    return toRoleDto(updated);
  }

  async delete(actor: MemberContext, roleId: string): Promise<void> {
    const role = await this.uow.repos.roles.findById(actor.workspaceId, roleId);
    if (!role) throw new NotFoundError('Role');
    if (role.isSystem) throw new ForbiddenError('System roles cannot be deleted');
    const fallback = await this.uow.repos.roles.findByKey(actor.workspaceId, SYSTEM_ROLES.MEMBER);

    await this.uow.transaction(async (repos) => {
      await repos.members.reassignRole(actor.workspaceId, role.id, fallback!.id);
      await repos.roles.delete(role.id);
      await repos.auditLogs.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: AUDIT_ACTIONS.ROLE_DELETED,
        targetType: 'role',
        targetId: role.id,
        metadata: { name: role.name },
      });
    });
    await this.publishChange(actor, role.id);
  }

  private publishChange(actor: MemberContext, roleId: string) {
    return this.events.publish({
      type: EVENTS.ROLE_UPDATED,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      data: { roleId },
    });
  }
}
