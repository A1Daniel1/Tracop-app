import type { CatalogMaintenanceApi } from '../modules/catalog/index.js';
import type { IdentityMaintenanceApi } from '../modules/identity/index.js';
import type { MessagingMaintenanceApi } from '../modules/messaging/index.js';
import type { NotificationsMaintenanceApi } from '../modules/notifications/index.js';
import type { OrderingMaintenanceApi } from '../modules/ordering/index.js';
import type { PaymentsMaintenanceApi } from '../modules/payments/index.js';
import type { AppEnvironment } from '../shared/infra/env.js';
import type { OutboxDispatcher } from '../shared/ports/outbox-dispatcher.js';
import type { ScheduledJob } from '../shared/ports/job-scheduler.js';

export interface WorkerJobDependencies {
  readonly catalog: CatalogMaintenanceApi;
  readonly ordering: OrderingMaintenanceApi;
  readonly identity: IdentityMaintenanceApi;
  readonly messaging: MessagingMaintenanceApi;
  readonly payments: PaymentsMaintenanceApi;
  readonly notifications: NotificationsMaintenanceApi;
  readonly outbox: OutboxDispatcher;
}

export type WorkerJobSchedule = Pick<
  AppEnvironment,
  | 'JOB_EXPIRE_LOTS_CRON'
  | 'JOB_EXPIRE_ORDERS_CRON'
  | 'JOB_PURGE_PHOTOS_CRON'
  | 'JOB_RETENTION_CRON'
  | 'JOB_OUTBOX_DISPATCH_CRON'
  | 'JOB_ISSUE_SETTLEMENTS_CRON'
  | 'JOB_SEND_NOTIFICATIONS_CRON'
>;

/**
 * The periodic jobs of the worker. Every job delegates to a public use case of its module,
 * and every use case is idempotent, so a repeated or overlapping run changes nothing twice.
 * sync.change_log and sync.processed_operations are deliberately not compacted (AGENTS §23).
 */
export const workerJobs = (
  dependencies: WorkerJobDependencies,
  schedule: WorkerJobSchedule,
): readonly ScheduledJob[] => {
  const job = (
    name: string,
    cron: string,
    run: () => Promise<unknown>,
    timeoutSeconds = 240,
  ): ScheduledJob => ({ name, cron, run, timeoutSeconds, retryLimit: 3 });
  return [
    job('catalog.expire-lots', schedule.JOB_EXPIRE_LOTS_CRON, () =>
      dependencies.catalog.expireLots(),
    ),
    job('ordering.expire-reservations-and-quotes', schedule.JOB_EXPIRE_ORDERS_CRON, () =>
      dependencies.ordering.expireReservationsAndQuotes(),
    ),
    job(
      'catalog.purge-orphan-photos',
      schedule.JOB_PURGE_PHOTOS_CRON,
      () => dependencies.catalog.purgeOrphanPhotos(),
      900,
    ),
    job('identity.purge-otp-codes', schedule.JOB_RETENTION_CRON, () =>
      dependencies.identity.purgeExpiredOtpCodes(),
    ),
    job('identity.purge-rate-limit-windows', schedule.JOB_RETENTION_CRON, () =>
      dependencies.identity.purgeRateLimitWindows(),
    ),
    job('identity.purge-sessions', schedule.JOB_RETENTION_CRON, () =>
      dependencies.identity.purgeEndedSessions(),
    ),
    job('messaging.purge-processed-updates', schedule.JOB_RETENTION_CRON, () =>
      dependencies.messaging.purgeProcessedUpdates(),
    ),
    job('payments.issue-settlements', schedule.JOB_ISSUE_SETTLEMENTS_CRON, () =>
      dependencies.payments.issueDueSettlements(),
    ),
    job(
      'notifications.send-due',
      schedule.JOB_SEND_NOTIFICATIONS_CRON,
      () => dependencies.notifications.sendDueNotifications(),
      50,
    ),
    job(
      'shared.dispatch-outbox',
      schedule.JOB_OUTBOX_DISPATCH_CRON,
      () => dependencies.outbox.dispatch(),
      50,
    ),
  ];
};
