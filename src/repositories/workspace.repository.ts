import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { members, roles, workspaces, type RoleRow, type WorkspaceRow } from '../db/schema.js';

export type NewWorkspace = Pick<WorkspaceRow, 'name' | 'slug' | 'ownerId'>;
export type WorkspacePatch = Partial<
  Pick<WorkspaceRow, 'name' | 'slug' | 'logoUrl' | 'description' | 'allowMemberInvites' | 'ownerId' | 'deletedAt'>
>;
export interface WorkspaceMembership {
  workspace: WorkspaceRow;
  memberId: string;
  role: RoleRow;
}

export interface WorkspaceRepository {
  create(input: NewWorkspace): Promise<WorkspaceRow>;
  findById(id: string): Promise<WorkspaceRow | null>;
  findBySlug(slug: string): Promise<WorkspaceRow | null>;
  update(id: string, patch: WorkspacePatch): Promise<WorkspaceRow | null>;
  listForUser(userId: string): Promise<WorkspaceMembership[]>;
}

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewWorkspace): Promise<WorkspaceRow> {
    const [row] = await this.db.insert(workspaces).values(input).returning();
    return row!;
  }

  async findById(id: string): Promise<WorkspaceRow | null> {
    const [row] = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async findBySlug(slug: string): Promise<WorkspaceRow | null> {
    const [row] = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async update(id: string, patch: WorkspacePatch): Promise<WorkspaceRow | null> {
    const [row] = await this.db
      .update(workspaces)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(workspaces.id, id))
      .returning();
    return row ?? null;
  }

  async listForUser(userId: string): Promise<WorkspaceMembership[]> {
    const rows = await this.db
      .select({ workspace: workspaces, memberId: members.id, role: roles })
      .from(members)
      .innerJoin(workspaces, eq(members.workspaceId, workspaces.id))
      .innerJoin(roles, eq(members.roleId, roles.id))
      .where(and(eq(members.userId, userId), isNull(members.deactivatedAt), isNull(workspaces.deletedAt)))
      .orderBy(asc(workspaces.name));
    return rows;
  }
}
