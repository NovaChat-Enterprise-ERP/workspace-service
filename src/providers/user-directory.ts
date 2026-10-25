import type { UserDto } from '@novachat-enterprise-erp/contracts';
import type { InternalHttpClient } from '@novachat-enterprise-erp/common';

export type UserProfile = Pick<UserDto, 'id' | 'name' | 'username' | 'email' | 'image'>;

export interface UserDirectory {
  getProfile(userId: string): Promise<UserProfile | null>;
}

export class AuthServiceUserDirectory implements UserDirectory {
  constructor(private readonly authClient: InternalHttpClient) {}

  getProfile(userId: string): Promise<UserProfile | null> {
    return this.authClient.request<UserProfile>(`/internal/users/${encodeURIComponent(userId)}`);
  }
}
