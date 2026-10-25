import { SYSTEM_ROLES } from '@novachat-enterprise-erp/contracts';
import { ForbiddenError } from '@novachat-enterprise-erp/common';
import type { MemberWithRole, RoleRow } from '../db/schema.js';

const isOwner = (m: MemberWithRole) => m.role.key === SYSTEM_ROLES.OWNER;
const isAdmin = (m: MemberWithRole) => m.role.key === SYSTEM_ROLES.ADMIN;

export class MemberPolicy {
  assertCanManage(actor: MemberWithRole, target: MemberWithRole): void {
    if (actor.id === target.id) throw new ForbiddenError('You cannot perform this action on yourself');
    if (isOwner(target)) throw new ForbiddenError('The workspace owner cannot be changed');
    if (isAdmin(target) && !isOwner(actor)) throw new ForbiddenError('Only the owner can manage admins');
  }

  assertCanAssign(actor: MemberWithRole, role: RoleRow): void {
    if (role.key === SYSTEM_ROLES.OWNER) throw new ForbiddenError('Use transfer ownership to change the owner');
    if (role.key === SYSTEM_ROLES.ADMIN && !isOwner(actor) && !isAdmin(actor)) {
      throw new ForbiddenError('Only owners and admins can grant the admin role');
    }
  }
}
