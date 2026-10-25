import { Router } from 'express';
import { PERMISSIONS } from '@novachat-enterprise-erp/contracts';
import { requireMember, requirePermission, requireService, requireUser } from '@novachat-enterprise-erp/common';
import type { Container } from '../container.js';

export const publicRoutes = ({ controllers: c }: Container): Router => {
  const router = Router();

  router.get('/invites/:token', c.invites.preview);
  router.post('/invites/:token/accept', requireUser, c.invites.accept);

  router.get('/workspaces', requireUser, c.workspaces.listMine);
  router.post('/workspaces', requireUser, c.workspaces.create);
  router.get('/workspaces/by-slug/:slug', requireUser, c.workspaces.getBySlug);

  const ws = Router({ mergeParams: true });
  ws.use(requireMember);
  ws.get('/', c.workspaces.get);
  ws.patch('/', requirePermission(PERMISSIONS.WORKSPACE_MANAGE), c.workspaces.update);
  ws.delete('/', requirePermission(PERMISSIONS.WORKSPACE_DELETE), c.workspaces.delete);
  ws.post('/leave', c.workspaces.leave);
  ws.post('/transfer-ownership', c.workspaces.transferOwnership);

  ws.get('/me', c.members.me);
  ws.patch('/me', c.members.updateMe);
  ws.get('/members', c.members.list);
  ws.get('/members/:memberId', c.members.get);
  ws.patch('/members/:memberId/role', requirePermission(PERMISSIONS.MEMBERS_MANAGE), c.members.changeRole);
  ws.post('/members/:memberId/deactivate', requirePermission(PERMISSIONS.MEMBERS_MANAGE), c.members.deactivate);
  ws.post('/members/:memberId/reactivate', requirePermission(PERMISSIONS.MEMBERS_MANAGE), c.members.reactivate);
  ws.delete('/members/:memberId', requirePermission(PERMISSIONS.MEMBERS_MANAGE), c.members.remove);

  ws.get('/roles', c.roles.list);
  ws.post('/roles', requirePermission(PERMISSIONS.ROLES_MANAGE), c.roles.create);
  ws.patch('/roles/:roleId', requirePermission(PERMISSIONS.ROLES_MANAGE), c.roles.update);
  ws.delete('/roles/:roleId', requirePermission(PERMISSIONS.ROLES_MANAGE), c.roles.delete);

  ws.get('/invites', requirePermission(PERMISSIONS.MEMBERS_INVITE), c.invites.list);
  ws.post('/invites', requirePermission(PERMISSIONS.MEMBERS_INVITE), c.invites.createEmail);
  ws.post('/invites/link', requirePermission(PERMISSIONS.MEMBERS_INVITE), c.invites.createLink);
  ws.delete('/invites/:inviteId', requirePermission(PERMISSIONS.MEMBERS_INVITE), c.invites.revoke);

  ws.get('/audit-logs', requirePermission(PERMISSIONS.AUDIT_VIEW), c.audit.list);

  router.use('/workspaces/:workspaceId', ws);
  return router;
};

export const internalRoutes = ({ controllers: c }: Container): Router => {
  const router = Router();
  router.use(requireService);
  router.get('/workspaces/:workspaceId/members/:userId/access', c.internal.access);
  router.get('/workspaces/:workspaceId/members/:userId', c.internal.member);
  router.post('/workspaces/:workspaceId/members/batch', c.internal.batch);
  return router;
};
