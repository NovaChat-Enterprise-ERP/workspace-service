import type { Request, Response } from 'express';
import { createInviteLinkSchema, createInvitesSchema } from '@novachat-enterprise-erp/contracts';
import { memberContext, parse, stringParam, userContext, uuidParam } from '@novachat-enterprise-erp/common';
import type { InviteService } from '../services/invite.service.js';

export class InviteController {
  constructor(private readonly invites: InviteService) {}

  list = async (req: Request, res: Response) => {
    res.json({ items: await this.invites.list(memberContext(req).workspaceId) });
  };

  createEmail = async (req: Request, res: Response) => {
    const input = parse(createInvitesSchema, req.body);
    res.status(201).json({ items: await this.invites.createEmailInvites(memberContext(req), input) });
  };

  createLink = async (req: Request, res: Response) => {
    const input = parse(createInviteLinkSchema, req.body ?? {});
    res.status(201).json(await this.invites.createLink(memberContext(req), input));
  };

  revoke = async (req: Request, res: Response) => {
    await this.invites.revoke(memberContext(req), uuidParam(req, 'inviteId', 'Invite'));
    res.status(204).end();
  };

  preview = async (req: Request, res: Response) => {
    res.json(await this.invites.preview(stringParam(req, 'token')));
  };

  accept = async (req: Request, res: Response) => {
    res.json(await this.invites.accept(stringParam(req, 'token'), userContext(req)));
  };
}
