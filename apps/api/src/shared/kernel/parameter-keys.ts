/** Business values the staff may change at run time (AGENTS §23). */
export const PARAMETER_KEYS = [
  'order.commission_rate_bps',
  'order.freight_cop',
  'order.quote_ttl_hours',
  'order.reservation_ttl_hours',
  'payment.claim_window_hours',
  'payment.rejection_grace_hours',
  'catalog.product_proposal_pending_limit',
] as const;
export type ParameterKey = (typeof PARAMETER_KEYS)[number];
