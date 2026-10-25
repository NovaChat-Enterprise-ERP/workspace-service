import type { Request, Response } from 'express';
import { createWorkspaceSchema, transferOwnershipSchema, updateWorkspaceSchema } from '@novachat-enterprise-erp/contracts';
import { memberContext, parse, stringParam, userContext } from '@novachat-enterprise-erp/common';
import type { WorkspaceService } from '../services/workspace.service.js';

export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  listMine = async (req: Request, res: Response) => {
    res.json({ items: await this.workspaces.listMine(userContext(req).userId) });
  };

  create = async (req: Request, res: Response) => {
    const input = parse(createWorkspaceSchema, req.body);
    res.status(201).json(await this.workspaces.create(userContext(req), input));
  };

  getBySlug = async (req: Request, res: Response) => {
    res.json(await this.workspaces.getBySlugForUser(stringParam(req, 'slug'), userContext(req).userId));
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.workspaces.get(memberContext(req).workspaceId));
  };

  update = async (req: Request, res: Response) => {
    const input = parse(updateWorkspaceSchema, req.body);
    res.json(await this.workspaces.update(memberContext(req), input));
  };

  delete = async (req: Request, res: Response) => {
    await this.workspaces.delete(memberContext(req));
    res.status(204).end();
  };

  leave = async (req: Request, res: Response) => {
    await this.workspaces.leave(memberContext(req));
    res.status(204).end();
  };

  transferOwnership = async (req: Request, res: Response) => {
    const { memberId } = parse(transferOwnershipSchema, req.body);
    await this.workspaces.transferOwnership(memberContext(req), memberId);
    res.status(204).end();
  };
}
