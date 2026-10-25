import { and, asc, eq, gt, ilike, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { members, roles, type MemberRow, type MemberWithRole } from '../db/schema.js';

export type NewMember = Pick<MemberRow, 'workspaceId' | 'userId' | 'roleId' | 'name' | 'username' | 'email' | 'image'>;
export type MemberPatch = Partial<
  Pick<
    MemberRow,
    | 'roleId'
    | 'title'
    | 'statusEmoji'
    | 'statusText'
    | 'statusExpiresAt'
    | 'isAway'
    | 'notificationsPausedUntil'
    | 'deactivatedAt'
  >
>;
export type ProfileSnapshot = Partial<Pick<MemberRow, 'name' | 'username' | 'email' | 'image'>>;

export interface MemberListFilter {
  q?: string;
  roleId?: string;
  status: 'active' | 'deactivated' | 'all';
  after?: { name: string; id: string } | null;
  limit: number;
}

export interface MemberRepository {
  create(input: NewMember): Promise<MemberRow>;
  findById(workspaceId: string, id: string): Promise<MemberWithRole | null>;
  findByUser(workspaceId: string, userId: string): Promise<MemberWithRole | null>;
  findByUsers(workspaceId: string, userIds: string[]): Promise<MemberWithRole[]>;
  list(workspaceId: string, filter: MemberListFilter): Promise<MemberWithRole[]>;
  update(id: string, patch: MemberPatch): Promise<MemberRow | null>;
  delete(id: string): Promise<void>;
  updateProfileForUser(userId: string, snapshot: ProfileSnapshot): Promise<MemberRow[]>;
  reassignRole(workspaceId: string, fromRoleId: string, toRoleId: string): Promise<void>;
}

export class DrizzleMemberRepository implements MemberRepository {
  constructor(private readonly db: Database) {}

  private selectWithRole() {
    return this.db.select({ member: members, role: roles }).from(members).innerJoin(roles, eq(members.roleId, roles.id));
  }

  private static merge(rows: { member: MemberRow; role: typeof roles.$inferSelect }[]): MemberWithRole[] {
    return rows.map((r) => ({ ...r.member, role: r.role }));
  }

  async create(input: NewMember): Promise<MemberRow> {
    const [row] = await this.db.insert(members).values(input).returning();
    return row!;
  }

  async findById(workspaceId: string, id: string): Promise<MemberWithRole | null> {
    const rows = await this.selectWithRole()
      .where(and(eq(members.workspaceId, workspaceId), eq(members.id, id)))
      .limit(1);
    return DrizzleMemberRepository.merge(rows)[0] ?? null;
  }

  async findByUser(workspaceId: string, userId: string): Promise<MemberWithRole | null> {
    const rows = await this.selectWithRole()
      .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)))
      .limit(1);
    return DrizzleMemberRepository.merge(rows)[0] ?? null;
  }

  async findByUsers(workspaceId: string, userIds: string[]): Promise<MemberWithRole[]> {
    if (userIds.length === 0) return [];
    const rows = await this.selectWithRole().where(
      and(eq(members.workspaceId, workspaceId), inArray(members.userId, userIds)),
    );
    return DrizzleMemberRepository.merge(rows);
  }

  async list(workspaceId: string, filter: MemberListFilter): Promise<MemberWithRole[]> {
    const conditions: (SQL | undefined)[] = [eq(members.workspaceId, workspaceId)];
    if (filter.status === 'active') conditions.push(isNull(members.deactivatedAt));
    if (filter.status === 'deactivated') conditions.push(isNotNull(members.deactivatedAt));
    if (filter.roleId) conditions.push(eq(members.roleId, filter.roleId));
    if (filter.q) {
      const term = `%${filter.q.replace(/[%_\\]/g, '\\$&')}%`;
      conditions.push(or(ilike(members.name, term), ilike(members.username, term), ilike(members.email, term)));
    }
    if (filter.after) {
      conditions.push(
        or(gt(members.name, filter.after.name), and(eq(members.name, filter.after.name), gt(members.id, filter.after.id))),
      );
    }
    const rows = await this.selectWithRole()
      .where(and(...conditions))
      .orderBy(asc(members.name), asc(members.id))
      .limit(filter.limit);
    return DrizzleMemberRepository.merge(rows);
  }

  async update(id: string, patch: MemberPatch): Promise<MemberRow | null> {
    const [row] = await this.db.update(members).set({ ...patch, updatedAt: new Date() }).where(eq(members.id, id)).returning();
    return row ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(members).where(eq(members.id, id));
  }

  async updateProfileForUser(userId: string, snapshot: ProfileSnapshot): Promise<MemberRow[]> {
    return this.db.update(members).set({ ...snapshot, updatedAt: new Date() }).where(eq(members.userId, userId)).returning();
  }

  async reassignRole(workspaceId: string, fromRoleId: string, toRoleId: string): Promise<void> {
    await this.db
      .update(members)
      .set({ roleId: toRoleId, updatedAt: new Date() })
      .where(and(eq(members.workspaceId, workspaceId), eq(members.roleId, fromRoleId)));
  }
}
