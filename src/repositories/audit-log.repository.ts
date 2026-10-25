import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { auditLogs, type AuditLogRow } from '../db/schema.js';

export type NewAuditLog = Pick<AuditLogRow, 'workspaceId' | 'actorId' | 'action' | 'targetType'> & {
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

export interface AuditLogRepository {
  record(entry: NewAuditLog): Promise<void>;
  list(workspaceId: string, before: { createdAt: string; id: string } | null, limit: number): Promise<AuditLogRow[]>;
}

export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Database) {}

  async record(entry: NewAuditLog): Promise<void> {
    await this.db.insert(auditLogs).values({ ...entry, metadata: entry.metadata ?? {} });
  }

  async list(workspaceId: string, before: { createdAt: string; id: string } | null, limit: number): Promise<AuditLogRow[]> {
    const cursor = before
      ? or(
          lt(auditLogs.createdAt, new Date(before.createdAt)),
          and(eq(auditLogs.createdAt, new Date(before.createdAt)), lt(auditLogs.id, before.id)),
        )
      : undefined;
    return this.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, workspaceId), cursor))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit);
  }
}
