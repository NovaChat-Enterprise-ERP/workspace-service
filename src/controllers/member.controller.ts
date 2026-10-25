import type { Request, Response } from 'express';
import { changeMemberRoleSchema, listMembersQuerySchema, updateMyMembershipSchema } from '@novachat-enterprise-erp/contracts';
import { memberContext, parse, uuidParam } from '@novachat-enterprise-erp/common';
import type { MemberService } from '../services/member.service.js';

export class MemberController {
  constructor(private readonly members: MemberService) {}

  me = async (req: Request, res: Response) => {
    res.json(await this.members.getMe(memberContext(req)));
  };

  updateMe = async (req: Request, res: Response) => {
    res.json(await this.members.updateMe(memberContext(req), parse(updateMyMembershipSchema, req.body)));
  };

  list = async (req: Request, res: Response) => {
    res.json(await this.members.list(memberContext(req).workspaceId, parse(listMembersQuerySchema, req.query)));
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.members.get(memberContext(req).workspaceId, uuidParam(req, 'memberId', 'Member')));
  };

  changeRole = async (req: Request, res: Response) => {
    const { roleId } = parse(changeMemberRoleSchema, req.body);
    res.json(await this.members.changeRole(memberContext(req), uuidParam(req, 'memberId', 'Member'), roleId));
  };

  deactivate = async (req: Request, res: Response) => {
    res.json(await this.members.deactivate(memberContext(req), uuidParam(req, 'memberId', 'Member')));
  };

  reactivate = async (req: Request, res: Response) => {
    res.json(await this.members.reactivate(memberContext(req), uuidParam(req, 'memberId', 'Member')));
  };

  remove = async (req: Request, res: Response) => {
    await this.members.remove(memberContext(req), uuidParam(req, 'memberId', 'Member'));
    res.status(204).end();
  };
}
