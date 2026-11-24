import {
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type pino from 'pino';
import { CATALOG_MAINTENANCE, type CatalogMaintenanceApi } from '../modules/catalog/index.js';
import { IDENTITY_MAINTENANCE, type IdentityMaintenanceApi } from '../modules/identity/index.js';
import { MESSAGING_MAINTENANCE, type MessagingMaintenanceApi } from '../modules/messaging/index.js';
import { ORDERING_MAINTENANCE, type OrderingMaintenanceApi } from '../modules/ordering/index.js';
import type { AppEnvironment } from '../shared/infra/env.js';
import { PostgresOutboxDispatcher } from '../shared/infra/outbox-dispatcher.js';
import { PgBossJobScheduler } from '../shared/infra/pg-boss-job-scheduler.js';
import { APP_ENVIRONMENT, APP_LOGGER } from '../shared/infra/tokens.js';
import { JOB_SCHEDULER, type JobSchedulerPort } from '../shared/ports/job-scheduler.js';
import {
  OUTBOX_DISPATCHER,
  OUTBOX_DISPATCHER_SETTINGS,
  type OutboxDispatcher,
  type OutboxDispatcherSettings,
} from '../shared/ports/outbox-dispatcher.js';
import { OUTBOX_SUBSCRIBERS } from '../shared/ports/outbox-subscriber.js';
import { APPLICATION_MODULES } from './app.module.js';
import { workerJobs } from './worker-jobs.js';

@Injectable()
export class WorkerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(JOB_SCHEDULER) private readonly scheduler: JobSchedulerPort,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(APP_LOGGER) private readonly logger: pino.Logger,
    @Inject(CATALOG_MAINTENANCE) private readonly catalog: CatalogMaintenanceApi,
    @Inject(ORDERING_MAINTENANCE) private readonly ordering: OrderingMaintenanceApi,
    @Inject(IDENTITY_MAINTENANCE) private readonly identity: IdentityMaintenanceApi,
    @Inject(MESSAGING_MAINTENANCE) private readonly messaging: MessagingMaintenanceApi,
    @Inject(OUTBOX_DISPATCHER) private readonly outbox: OutboxDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.scheduler.start();
    const jobs = workerJobs(
      {
        catalog: this.catalog,
        ordering: this.ordering,
        identity: this.identity,
        messaging: this.messaging,
        outbox: this.outbox,
      },
      this.environment,
    );
    for (const job of jobs) await this.scheduler.schedule(job);
    this.logger.info(
      { event: 'worker_started', jobs: this.scheduler.registered() },
      'Worker started.',
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.scheduler.stop();
    this.logger.info({ event: 'worker_stopped' }, 'Worker stopped.');
  }
}

@Module({
  imports: APPLICATION_MODULES,
  providers: [
    {
      provide: OUTBOX_DISPATCHER_SETTINGS,
      inject: [APP_ENVIRONMENT],
      useFactory: (environment: AppEnvironment): OutboxDispatcherSettings => ({
        leaseSeconds: environment.OUTBOX_LEASE_SECONDS,
        maxAttempts: environment.OUTBOX_MAX_ATTEMPTS,
        retryBaseSeconds: environment.OUTBOX_RETRY_BASE_SECONDS,
        retryMaxSeconds: environment.OUTBOX_RETRY_MAX_SECONDS,
      }),
    },
    // No module consumes outbox events yet; notifications will register the first subscriber.
    { provide: OUTBOX_SUBSCRIBERS, useValue: [] },
    PostgresOutboxDispatcher,
    { provide: OUTBOX_DISPATCHER, useExisting: PostgresOutboxDispatcher },
    {
      provide: JOB_SCHEDULER,
      inject: [APP_ENVIRONMENT, APP_LOGGER],
      useFactory: (environment: AppEnvironment, logger: pino.Logger) =>
        new PgBossJobScheduler(environment.DATABASE_URL, logger),
    },
    WorkerLifecycle,
  ],
})
export class WorkerModule {}
