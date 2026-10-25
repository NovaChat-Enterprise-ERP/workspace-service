import type { Database } from '../db/client.js';
import { DrizzleAuditLogRepository, type AuditLogRepository } from './audit-log.repository.js';
import { DrizzleInviteRepository, type InviteRepository } from './invite.repository.js';
import { DrizzleMemberRepository, type MemberRepository } from './member.repository.js';
import { DrizzleRoleRepository, type RoleRepository } from './role.repository.js';
import { DrizzleWorkspaceRepository, type WorkspaceRepository } from './workspace.repository.js';

export interface Repositories {
  workspaces: WorkspaceRepository;
  roles: RoleRepository;
  members: MemberRepository;
  invites: InviteRepository;
  auditLogs: AuditLogRepository;
}

export interface UnitOfWork {
  readonly repos: Repositories;
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}

export const createRepositories = (db: Database): Repositories => ({
  workspaces: new DrizzleWorkspaceRepository(db),
  roles: new DrizzleRoleRepository(db),
  members: new DrizzleMemberRepository(db),
  invites: new DrizzleInviteRepository(db),
  auditLogs: new DrizzleAuditLogRepository(db),
});

export class DrizzleUnitOfWork implements UnitOfWork {
  readonly repos: Repositories;

  constructor(private readonly db: Database) {
    this.repos = createRepositories(db);
  }

  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(createRepositories(tx as unknown as Database)));
  }
}
