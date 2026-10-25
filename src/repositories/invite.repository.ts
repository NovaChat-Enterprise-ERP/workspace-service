import { and, desc, eq, isNull, or, sql, gt, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { invites, roles, type InviteRow, type RoleRow } from '../db/schema.js';

export type NewInvite = Pick<InviteRow, 'workspaceId' | 'email' | 'tokenHash' | 'roleId' | 'invitedBy' | 'expiresAt' | 'maxUses'>;
export type InviteWithRole = InviteRow & { role: RoleRow };

export interface InviteRepository {
  createMany(input: NewInvite[]): Promise<InviteRow[]>;
  findByTokenHash(tokenHash: string): Promise<InviteWithRole | null>;
  findById(workspaceId: string, id: string): Promise<InviteWithRole | null>;
  listActive(workspaceId: string): Promise<InviteWithRole[]>;
  revoke(id: string): Promise<void>;
  consumeUse(id: string): Promise<boolean>;
}

export class DrizzleInviteRepository implements InviteRepository {
  constructor(private readonly db: Database) {}

  private withRole() {
    return this.db.select({ invite: invites, role: roles }).from(invites).innerJoin(roles, eq(invites.roleId, roles.id));
  }

  async createMany(input: NewInvite[]): Promise<InviteRow[]> {
    return this.db.insert(invites).values(input).returning();
  }

  async findByTokenHash(tokenHash: string): Promise<InviteWithRole | null> {
    const [row] = await this.withRole().where(eq(invites.tokenHash, tokenHash)).limit(1);
    return row ? { ...row.invite, role: row.role } : null;
  }

  async findById(workspaceId: string, id: string): Promise<InviteWithRole | null> {
    const [row] = await this.withRole()
      .where(and(eq(invites.workspaceId, workspaceId), eq(invites.id, id)))
      .limit(1);
    return row ? { ...row.invite, role: row.role } : null;
  }

  async listActive(workspaceId: string): Promise<InviteWithRole[]> {
    const rows = await this.withRole()
      .where(
        and(
          eq(invites.workspaceId, workspaceId),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date()),
          or(isNull(invites.maxUses), lt(invites.uses, invites.maxUses)),
        ),
      )
      .orderBy(desc(invites.createdAt));
    return rows.map((r) => ({ ...r.invite, role: r.role }));
  }

  async revoke(id: string): Promise<void> {
    await this.db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
  }

  async consumeUse(id: string): Promise<boolean> {
    const rows = await this.db
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1` })
      .where(
        and(
          eq(invites.id, id),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date()),
          or(isNull(invites.maxUses), lt(invites.uses, invites.maxUses)),
        ),
      )
      .returning({ id: invites.id });
    return rows.length === 1;
  }
}
