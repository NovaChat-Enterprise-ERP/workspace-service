import { z } from 'zod';
import { baseEnvSchema, loadEnv, serviceUrl } from '@novachat-enterprise-erp/common';

const schema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(4002),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  AUTH_SERVICE_URL: serviceUrl('http://localhost:4001'),
});

export type Env = z.infer<typeof schema>;

export const loadWorkspaceEnv = (): Env => loadEnv(schema);
