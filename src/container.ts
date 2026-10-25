import type { Logger, ReadinessCheck } from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { UnitOfWork } from './repositories/unit-of-work.js';
import type { UserDirectory } from './providers/user-directory.js';
import { WorkspaceService } from './services/workspace.service.js';
import { MemberService } from './services/member.service.js';
import { MemberPolicy } from './services/member.policy.js';
import { RoleService } from './services/role.service.js';
import { InviteService } from './services/invite.service.js';
import { AuditService } from './services/audit.service.js';
import { WorkspaceController } from './controllers/workspace.controller.js';
import { MemberController } from './controllers/member.controller.js';
import { RoleController } from './controllers/role.controller.js';
import { InviteController } from './controllers/invite.controller.js';
import { AuditController } from './controllers/audit.controller.js';
import { InternalController } from './controllers/internal.controller.js';

export interface ContainerDeps {
  logger: Logger;
  internalSecret: string;
  publicAppUrl: string;
  uow: UnitOfWork;
  users: UserDirectory;
  events: EventPublisher;
  readiness?: Record<string, ReadinessCheck>;
}

export const buildContainer = (deps: ContainerDeps) => {
  const services = {
    workspaces: new WorkspaceService(deps.uow, deps.users, deps.events),
    members: new MemberService(deps.uow, new MemberPolicy(), deps.events),
    roles: new RoleService(deps.uow, deps.events),
    invites: new InviteService(deps.uow, deps.users, deps.events, deps.publicAppUrl),
    audit: new AuditService(deps.uow.repos.auditLogs),
  };
  return {
    logger: deps.logger,
    internalSecret: deps.internalSecret,
    readiness: deps.readiness ?? {},
    services,
    controllers: {
      workspaces: new WorkspaceController(services.workspaces),
      members: new MemberController(services.members),
      roles: new RoleController(services.roles),
      invites: new InviteController(services.invites),
      audit: new AuditController(services.audit),
      internal: new InternalController(services.members),
    },
  };
};

export type Container = ReturnType<typeof buildContainer>;
