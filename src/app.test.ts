import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { EVENTS, type InviteDto, type MemberDto, type RoleDto, type WorkspaceSummaryDto } from '@novachat-enterprise-erp/contracts';
import { asService } from '@novachat-enterprise-erp/testing';
import { PROFILES, createHarness } from './test/harness.js';

let h: Awaited<ReturnType<typeof createHarness>>;
let ws: WorkspaceSummaryDto;

const join = async (userId: string) => {
  const link = await request(h.app)
    .post(`/api/v1/workspaces/${ws.id}/invites/link`)
    .set(await h.member(ws.id, 'owner'))
    .send({});
  const token = (link.body as InviteDto).url!.split('/').at(-1)!;
  const res = await request(h.app).post(`/api/v1/invites/${token}/accept`).set(h.user(userId));
  expect(res.status).toBe(200);
  return res.body as WorkspaceSummaryDto;
};

const roleByKey = async (key: string) => {
  const res = await request(h.app).get(`/api/v1/workspaces/${ws.id}/roles`).set(await h.member(ws.id, 'owner'));
  return (res.body.items as RoleDto[]).find((r) => r.key === key)!;
};

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

describe('workspaces', () => {
  it('creates a workspace with the creator as owner', async () => {
    const res = await request(h.app)
      .post('/api/v1/workspaces')
      .set(h.user('owner'))
      .send({ name: 'Itoje Dollar', slug: 'itoje-dollar' });
    expect(res.status).toBe(201);
    ws = res.body;
    expect(ws).toMatchObject({ slug: 'itoje-dollar', role: 'owner', ownerId: 'owner' });
    expect(h.events.ofType(EVENTS.WORKSPACE_CREATED)).toHaveLength(1);
  });

  it('rejects duplicate slugs and invalid input', async () => {
    const dup = await request(h.app).post('/api/v1/workspaces').set(h.user('ada')).send({ name: 'Other', slug: 'itoje-dollar' });
    expect(dup.status).toBe(409);
    const bad = await request(h.app).post('/api/v1/workspaces').set(h.user('ada')).send({ name: 'X', slug: 'Bad Slug' });
    expect(bad.status).toBe(422);
  });

  it('lists my workspaces and resolves by slug only for members', async () => {
    const mine = await request(h.app).get('/api/v1/workspaces').set(h.user('owner'));
    expect(mine.body.items).toHaveLength(1);
    expect((await request(h.app).get('/api/v1/workspaces/by-slug/itoje-dollar').set(h.user('owner'))).status).toBe(200);
    expect((await request(h.app).get('/api/v1/workspaces/by-slug/itoje-dollar').set(h.user('ada'))).status).toBe(404);
  });

  it('grants the owner every permission', async () => {
    const res = await request(h.app).get(`/internal/workspaces/${ws.id}/members/owner/access`).set(asService());
    expect(res.body.permissions).toContain('workspace:delete');
    expect(res.body.role).toBe('owner');
  });
});

describe('invites', () => {
  it('lets people join through an invite link', async () => {
    const joined = await join('ada');
    expect(joined.role).toBe('member');
    expect(h.events.ofType(EVENTS.MEMBER_JOINED).at(-1)?.data).toMatchObject({ userId: 'ada' });
  });

  it('shows a public preview', async () => {
    const link = await request(h.app).post(`/api/v1/workspaces/${ws.id}/invites/link`).set(await h.member(ws.id, 'owner')).send({ maxUses: 1 });
    const token = link.body.url.split('/').at(-1);
    const preview = await request(h.app).get(`/api/v1/invites/${token}`).set(asService('api-gateway'));
    expect(preview.body).toMatchObject({ valid: true, inviterName: 'Itoje Dollar', workspace: { slug: 'itoje-dollar' } });
  });

  it('enforces the invited email address', async () => {
    const res = await request(h.app)
      .post(`/api/v1/workspaces/${ws.id}/invites`)
      .set(await h.member(ws.id, 'owner'))
      .send({ emails: ['grace@example.com'] });
    expect(res.status).toBe(201);
    const token = res.body.items[0].url.split('/').at(-1);
    expect(h.events.ofType(EVENTS.INVITE_CREATED).at(-1)?.data).toMatchObject({ email: 'grace@example.com' });

    expect((await request(h.app).post(`/api/v1/invites/${token}/accept`).set(h.user('linus'))).status).toBe(403);
    expect((await request(h.app).post(`/api/v1/invites/${token}/accept`).set(h.user('grace'))).status).toBe(200);
  });

  it('rejects revoked invites', async () => {
    const owner = await h.member(ws.id, 'owner');
    const link = await request(h.app).post(`/api/v1/workspaces/${ws.id}/invites/link`).set(owner).send({});
    await request(h.app).delete(`/api/v1/workspaces/${ws.id}/invites/${link.body.id}`).set(owner).expect(204);
    const token = link.body.url.split('/').at(-1);
    const res = await request(h.app).post(`/api/v1/invites/${token}/accept`).set(h.user('linus'));
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITE_REVOKED');
  });

  it('stops members from inviting admins', async () => {
    const admin = await roleByKey('admin');
    const res = await request(h.app)
      .post(`/api/v1/workspaces/${ws.id}/invites/link`)
      .set(await h.member(ws.id, 'ada'))
      .send({ roleId: admin.id });
    expect(res.status).toBe(403);
  });
});

describe('member administration', () => {
  const memberIdOf = async (userId: string) => {
    const res = await request(h.app).get(`/api/v1/workspaces/${ws.id}/members?q=${PROFILES[userId]!.username}`).set(await h.member(ws.id, 'owner'));
    return (res.body.items as MemberDto[]).find((m) => m.userId === userId)!.id;
  };

  it('lists and searches members', async () => {
    const res = await request(h.app).get(`/api/v1/workspaces/${ws.id}/members?limit=2`).set(await h.member(ws.id, 'ada'));
    expect(res.body.items.map((m: MemberDto) => m.name)).toEqual(['Ada Lovelace', 'Grace Hopper']);
    const next = await request(h.app).get(`/api/v1/workspaces/${ws.id}/members?limit=2&cursor=${res.body.nextCursor}`).set(await h.member(ws.id, 'ada'));
    expect(next.body.items.map((m: MemberDto) => m.name)).toEqual(['Itoje Dollar']);
  });

  it('blocks role changes without members:manage', async () => {
    const admin = await roleByKey('admin');
    const res = await request(h.app)
      .patch(`/api/v1/workspaces/${ws.id}/members/${await memberIdOf('grace')}/role`)
      .set(await h.member(ws.id, 'ada'))
      .send({ roleId: admin.id });
    expect(res.status).toBe(403);
  });

  it('lets the owner promote, and protects owner and admins', async () => {
    const admin = await roleByKey('admin');
    const promoted = await request(h.app)
      .patch(`/api/v1/workspaces/${ws.id}/members/${await memberIdOf('ada')}/role`)
      .set(await h.member(ws.id, 'owner'))
      .send({ roleId: admin.id });
    expect(promoted.body.role.key).toBe('admin');
    expect(h.events.ofType(EVENTS.MEMBER_ROLE_CHANGED).at(-1)?.data).toMatchObject({ userId: 'ada', role: 'admin' });

    const adaCtx = await h.member(ws.id, 'ada');
    const touchOwner = await request(h.app).post(`/api/v1/workspaces/${ws.id}/members/${await memberIdOf('owner')}/deactivate`).set(adaCtx);
    expect(touchOwner.status).toBe(403);

    await request(h.app)
      .patch(`/api/v1/workspaces/${ws.id}/members/${await memberIdOf('grace')}/role`)
      .set(await h.member(ws.id, 'owner'))
      .send({ roleId: admin.id })
      .expect(200);
    const adminOnAdmin = await request(h.app).post(`/api/v1/workspaces/${ws.id}/members/${await memberIdOf('grace')}/deactivate`).set(adaCtx);
    expect(adminOnAdmin.status).toBe(403);
  });

  it('deactivates and reactivates members', async () => {
    await join('linus');
    const id = await memberIdOf('linus');
    const ada = await h.member(ws.id, 'ada');
    const off = await request(h.app).post(`/api/v1/workspaces/${ws.id}/members/${id}/deactivate`).set(ada);
    expect(off.body.deactivatedAt).not.toBeNull();
    const access = await request(h.app).get(`/internal/workspaces/${ws.id}/members/linus/access`).set(asService());
    expect(access.body.deactivated).toBe(true);
    await request(h.app).post(`/api/v1/workspaces/${ws.id}/members/${id}/reactivate`).set(ada).expect(200);
  });

  it('updates my status, away state and pause', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const res = await request(h.app)
      .patch(`/api/v1/workspaces/${ws.id}/me`)
      .set(await h.member(ws.id, 'linus'))
      .send({ status: { emoji: '📚', text: 'Studying' }, isAway: true, notificationsPausedUntil: until });
    expect(res.body).toMatchObject({ isAway: true, status: { emoji: '📚', text: 'Studying' } });
    expect(h.events.ofType(EVENTS.MEMBER_STATUS_CHANGED)).toHaveLength(1);
  });

  it('returns 404 for malformed ids', async () => {
    const res = await request(h.app).get(`/api/v1/workspaces/${ws.id}/members/not-a-uuid`).set(await h.member(ws.id, 'ada'));
    expect(res.status).toBe(404);
  });
});

describe('roles', () => {
  it('creates, updates and deletes custom roles', async () => {
    const owner = await h.member(ws.id, 'owner');
    const created = await request(h.app)
      .post(`/api/v1/workspaces/${ws.id}/roles`)
      .set(owner)
      .send({ name: 'Teaching Assistant', permissions: ['channels:manage', 'members:invite'] });
    expect(created.status).toBe(201);

    const forbidden = await request(h.app)
      .patch(`/api/v1/workspaces/${ws.id}/roles/${created.body.id}`)
      .set(owner)
      .send({ permissions: ['workspace:delete'] });
    expect(forbidden.status).toBe(400);

    const linusId = (await request(h.app).get(`/api/v1/workspaces/${ws.id}/members?q=linus`).set(owner)).body.items[0].id;
    await request(h.app).patch(`/api/v1/workspaces/${ws.id}/members/${linusId}/role`).set(owner).send({ roleId: created.body.id }).expect(200);
    expect((await request(h.app).get(`/internal/workspaces/${ws.id}/members/linus/access`).set(asService())).body.permissions).toEqual([
      'channels:manage',
      'members:invite',
    ]);

    await request(h.app).delete(`/api/v1/workspaces/${ws.id}/roles/${created.body.id}`).set(owner).expect(204);
    expect((await request(h.app).get(`/internal/workspaces/${ws.id}/members/linus/access`).set(asService())).body.role).toBe('member');
  });

  it('refuses to modify the owner role or delete system roles', async () => {
    const owner = await h.member(ws.id, 'owner');
    const ownerRole = await roleByKey('owner');
    const memberRole = await roleByKey('member');
    expect((await request(h.app).patch(`/api/v1/workspaces/${ws.id}/roles/${ownerRole.id}`).set(owner).send({ permissions: [] })).status).toBe(403);
    expect((await request(h.app).delete(`/api/v1/workspaces/${ws.id}/roles/${memberRole.id}`).set(owner)).status).toBe(403);
  });
});

describe('ownership, leaving and audit', () => {
  it('prevents the owner from leaving, allows members to leave', async () => {
    expect((await request(h.app).post(`/api/v1/workspaces/${ws.id}/leave`).set(await h.member(ws.id, 'owner'))).status).toBe(403);
    await request(h.app).post(`/api/v1/workspaces/${ws.id}/leave`).set(await h.member(ws.id, 'linus')).expect(204);
    expect((await request(h.app).get(`/internal/workspaces/${ws.id}/members/linus/access`).set(asService())).status).toBe(404);
  });

  it('transfers ownership', async () => {
    const owner = await h.member(ws.id, 'owner');
    const ada = (await request(h.app).get(`/api/v1/workspaces/${ws.id}/members?q=ada`).set(owner)).body.items[0];
    await request(h.app).post(`/api/v1/workspaces/${ws.id}/transfer-ownership`).set(owner).send({ memberId: ada.id }).expect(204);
    const access = await request(h.app).get(`/internal/workspaces/${ws.id}/members/ada/access`).set(asService());
    expect(access.body.role).toBe('owner');
    const previous = await request(h.app).get(`/internal/workspaces/${ws.id}/members/owner/access`).set(asService());
    expect(previous.body.role).toBe('admin');
  });

  it('records an audit trail', async () => {
    const res = await request(h.app).get(`/api/v1/workspaces/${ws.id}/audit-logs?limit=50`).set(await h.member(ws.id, 'ada'));
    const actions = res.body.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['workspace.created', 'member.role_changed', 'ownership.transferred', 'role.deleted']));
  });
});
