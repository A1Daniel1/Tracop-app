export const NOTIFICATIONS_SERVICE = Symbol('NOTIFICATIONS_SERVICE');
export const NOTIFICATIONS_MAINTENANCE = Symbol('NOTIFICATIONS_MAINTENANCE');
export const NOTIFICATIONS_OUTBOX_SUBSCRIBER = Symbol('NOTIFICATIONS_OUTBOX_SUBSCRIBER');

/** What the worker runs for notifications. */
export interface NotificationsMaintenanceApi {
  sendDueNotifications(): Promise<{
    readonly sent: number;
    readonly retried: number;
    readonly failed: number;
  }>;
}
