import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { members, roles, type RoleRow } from '../db/schema.js';

export type NewRole = Pick<RoleRow, 'workspaceId' | 'key' | 'name' | 'permissions' | 'isSystem'> & {
  description?: string | null;
};
export type RolePatch = Partial<Pick<RoleRow, 'name' | 'description' | 'permissions'>>;
export type RoleWithCount = RoleRow & { memberCount: number };

export interface RoleRepository {
  createMany(input: NewRole[]): Promise<RoleRow[]>;
  findById(workspaceId: string, id: string): Promise<RoleRow | null>;
  findByKey(workspaceId: string, key: string): Promise<RoleRow | null>;
  list(workspaceId: string): Promise<RoleWithCount[]>;
  update(id: string, patch: RolePatch): Promise<RoleRow | null>;
  delete(id: string): Promise<void>;
}

export class DrizzleRoleRepository implements RoleRepository {
  constructor(private readonly db: Database) {}

  async createMany(input: NewRole[]): Promise<RoleRow[]> {
    return this.db.insert(roles).values(input).returning();
  }

  async findById(workspaceId: string, id: string): Promise<RoleRow | null> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.workspaceId, workspaceId), eq(roles.id, id)))
      .limit(1);
    return row ?? null;
  }

  async findByKey(workspaceId: string, key: string): Promise<RoleRow | null> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.workspaceId, workspaceId), eq(roles.key, key)))
      .limit(1);
    return row ?? null;
  }

  async list(workspaceId: string): Promise<RoleWithCount[]> {
    const rows = await this.db.select().from(roles).where(eq(roles.workspaceId, workspaceId)).orderBy(asc(roles.createdAt));
    if (rows.length === 0) return [];
    const counts = await this.db
      .select({ roleId: members.roleId, total: count() })
      .from(members)
      .where(inArray(members.roleId, rows.map((r) => r.id)))
      .groupBy(members.roleId);
    const byRole = new Map(counts.map((c) => [c.roleId, Number(c.total)]));
    return rows.map((r) => ({ ...r, memberCount: byRole.get(r.id) ?? 0 }));
  }

  async update(id: string, patch: RolePatch): Promise<RoleRow | null> {
    const [row] = await this.db.update(roles).set({ ...patch, updatedAt: new Date() }).where(eq(roles.id, id)).returning();
    return row ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(roles).where(eq(roles.id, id));
  }
}
