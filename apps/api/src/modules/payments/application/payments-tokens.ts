export const PAYMENTS_SERVICE = Symbol('PAYMENTS_SERVICE');
export const PAYMENTS_MAINTENANCE = Symbol('PAYMENTS_MAINTENANCE');
export const PAYMENTS_OUTBOX_SUBSCRIBER = Symbol('PAYMENTS_OUTBOX_SUBSCRIBER');

/** What the worker runs for payments. */
export interface PaymentsMaintenanceApi {
  issueDueSettlements(): Promise<number>;
}
