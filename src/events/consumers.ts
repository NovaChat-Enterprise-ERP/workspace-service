import { EVENTS, type UserDto } from '@novachat-enterprise-erp/contracts';
import type { EventSubscriber } from '@novachat-enterprise-erp/events';
import type { MemberService } from '../services/member.service.js';

export const registerConsumers = (subscriber: EventSubscriber, members: MemberService): void => {
  subscriber.on<UserDto>(EVENTS.USER_UPDATED, (event) => members.syncProfile(event.data));
};
