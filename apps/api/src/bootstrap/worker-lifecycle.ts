import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type pino from 'pino';
import { CATALOG_MAINTENANCE, type CatalogMaintenanceApi } from '../modules/catalog/index.js';
import { IDENTITY_MAINTENANCE, type IdentityMaintenanceApi } from '../modules/identity/index.js';
import { MESSAGING_MAINTENANCE, type MessagingMaintenanceApi } from '../modules/messaging/index.js';
import { ORDERING_MAINTENANCE, type OrderingMaintenanceApi } from '../modules/ordering/index.js';
import { PAYMENTS_MAINTENANCE, type PaymentsMaintenanceApi } from '../modules/payments/index.js';
import type { AppEnvironment } from '../shared/infra/env.js';
import { APP_ENVIRONMENT, APP_LOGGER } from '../shared/infra/tokens.js';
import { JOB_SCHEDULER, type JobSchedulerPort } from '../shared/ports/job-scheduler.js';
import { OUTBOX_DISPATCHER, type OutboxDispatcher } from '../shared/ports/outbox-dispatcher.js';
import { workerJobs } from './worker-jobs.js';

/** Starts the scheduler and registers every job on boot; stops it on shutdown. */
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
    @Inject(PAYMENTS_MAINTENANCE) private readonly payments: PaymentsMaintenanceApi,
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
        payments: this.payments,
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
