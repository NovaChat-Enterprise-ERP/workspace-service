import request from 'supertest';
import { fileURLToPath } from 'node:url';
import type { WorkspaceAccessDto } from '@novachat-enterprise-erp/contracts';
import { createLogger } from '@novachat-enterprise-erp/common';
import { InMemoryEventBus } from '@novachat-enterprise-erp/events';
import { TEST_SECRET, asService, asUser, createTestDatabase } from '@novachat-enterprise-erp/testing';
import { schema } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { DrizzleUnitOfWork } from '../repositories/unit-of-work.js';
import type { UserDirectory, UserProfile } from '../providers/user-directory.js';
import { buildContainer } from '../container.js';
import { createApp } from '../app.js';

export const PROFILES: Record<string, UserProfile> = {
  owner: { id: 'owner', name: 'Itoje Dollar', username: 'itoje_dollar', email: 'itoje@example.com', image: null },
  ada: { id: 'ada', name: 'Ada Lovelace', username: 'ada', email: 'ada@example.com', image: null },
  grace: { id: 'grace', name: 'Grace Hopper', username: 'grace', email: 'grace@example.com', image: null },
  linus: { id: 'linus', name: 'Linus T', username: 'linus', email: 'linus@example.com', image: null },
};

class FakeUserDirectory implements UserDirectory {
  async getProfile(userId: string) {
    return PROFILES[userId] ?? null;
  }
}

export const createHarness = async () => {
  const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));
  const { db, close } = await createTestDatabase(schema, migrations, 'workspace');
  const events = new InMemoryEventBus('workspace-service');
  const container = buildContainer({
    logger: createLogger('test', 'silent'),
    internalSecret: TEST_SECRET,
    publicAppUrl: 'http://app.test',
    uow: new DrizzleUnitOfWork(db as unknown as Database),
    users: new FakeUserDirectory(),
    events,
  });
  const app = createApp(container);

  const user = (userId: string) => asUser({ userId, email: PROFILES[userId]?.email, name: PROFILES[userId]?.name });

  const member = async (workspaceId: string, userId: string) => {
    const res = await request(app).get(`/internal/workspaces/${workspaceId}/members/${userId}/access`).set(asService());
    if (res.status !== 200) throw new Error(`No access for ${userId}: ${res.status}`);
    const access = res.body as WorkspaceAccessDto;
    return asUser({
      userId,
      name: PROFILES[userId]?.name,
      workspaceId,
      memberId: access.memberId,
      role: access.role,
      permissions: access.permissions,
    });
  };

  return { app, events, close, user, member };
};
