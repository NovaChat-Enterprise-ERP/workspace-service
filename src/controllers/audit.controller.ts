import type { Request, Response } from 'express';
import { paginationQuerySchema } from '@novachat-enterprise-erp/contracts';
import { memberContext, parse } from '@novachat-enterprise-erp/common';
import type { AuditService } from '../services/audit.service.js';

export class AuditController {
  constructor(private readonly audit: AuditService) {}

  list = async (req: Request, res: Response) => {
    const { cursor, limit } = parse(paginationQuerySchema, req.query);
    res.json(await this.audit.list(memberContext(req).workspaceId, cursor, limit));
  };
}
