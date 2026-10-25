import type { Request, Response } from 'express';
import { createRoleSchema, updateRoleSchema } from '@novachat-enterprise-erp/contracts';
import { memberContext, parse, uuidParam } from '@novachat-enterprise-erp/common';
import type { RoleService } from '../services/role.service.js';

export class RoleController {
  constructor(private readonly roles: RoleService) {}

  list = async (req: Request, res: Response) => {
    res.json({ items: await this.roles.list(memberContext(req).workspaceId) });
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.roles.create(memberContext(req), parse(createRoleSchema, req.body)));
  };

  update = async (req: Request, res: Response) => {
    const input = parse(updateRoleSchema, req.body);
    res.json(await this.roles.update(memberContext(req), uuidParam(req, 'roleId', 'Role'), input));
  };

  delete = async (req: Request, res: Response) => {
    await this.roles.delete(memberContext(req), uuidParam(req, 'roleId', 'Role'));
    res.status(204).end();
  };
}
