import type { Request, Response } from 'express';
import { z } from 'zod';
import { NotFoundError, isUuid, parse, stringParam } from '@novachat-enterprise-erp/common';
import type { MemberService } from '../services/member.service.js';

const batchSchema = z.object({ userIds: z.array(z.string().min(1)).min(1).max(500) });

export class InternalController {
  constructor(private readonly members: MemberService) {}

  access = async (req: Request, res: Response) => {
    const workspaceId = stringParam(req, 'workspaceId');
    const access = isUuid(workspaceId) ? await this.members.access(workspaceId, stringParam(req, 'userId')) : null;
    if (!access) throw new NotFoundError('Membership');
    res.json(access);
  };

  member = async (req: Request, res: Response) => {
    const workspaceId = stringParam(req, 'workspaceId');
    if (!isUuid(workspaceId)) throw new NotFoundError('Member');
    res.json(await this.members.findByUser(workspaceId, stringParam(req, 'userId')));
  };

  batch = async (req: Request, res: Response) => {
    const workspaceId = stringParam(req, 'workspaceId');
    if (!isUuid(workspaceId)) throw new NotFoundError('Workspace');
    const { userIds } = parse(batchSchema, req.body);
    res.json({ items: await this.members.findByUsers(workspaceId, userIds) });
  };
}
