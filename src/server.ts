import { InternalHttpClient, createLogger, startServer } from '@novachat-enterprise-erp/common';
import { RedisStreamEventPublisher, RedisStreamEventSubscriber } from '@novachat-enterprise-erp/events';
import { loadWorkspaceEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { DrizzleUnitOfWork } from './repositories/unit-of-work.js';
import { AuthServiceUserDirectory } from './providers/user-directory.js';
import { registerConsumers } from './events/consumers.js';
import { buildContainer } from './container.js';
import { createApp } from './app.js';

const env = loadWorkspaceEnv();
const logger = createLogger('workspace-service', env.LOG_LEVEL);
const { db, pool } = createDatabase(env.DATABASE_URL, (err) =>
  logger.warn({ err }, 'Idle database connection failed; the pool will reconnect'),
);
const events = new RedisStreamEventPublisher({ redisUrl: env.REDIS_URL, source: 'workspace-service' });

const container = buildContainer({
  logger,
  internalSecret: env.INTERNAL_SECRET,
  publicAppUrl: env.PUBLIC_APP_URL,
  uow: new DrizzleUnitOfWork(db),
  users: new AuthServiceUserDirectory(new InternalHttpClient(env.AUTH_SERVICE_URL, env.INTERNAL_SECRET, 'workspace-service')),
  events,
  readiness: { database: async () => void (await pool.query('select 1')) },
});

const subscriber = new RedisStreamEventSubscriber({
  redisUrl: env.REDIS_URL,
  source: 'workspace-service',
  group: 'workspace-service',
  logger,
});
registerConsumers(subscriber, container.services.members);
await subscriber.start();

startServer({
  app: createApp(container),
  port: env.PORT,
  logger,
  onShutdown: [() => subscriber.stop(), () => events.close(), () => pool.end()],
});
