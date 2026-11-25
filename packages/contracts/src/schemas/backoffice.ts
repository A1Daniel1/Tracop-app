import { z } from 'zod';

const integerString = z.string().regex(/^-?(0|[1-9]\d{0,18})$/);

export const parameterKeySchema = z.enum([
  'order.commission_rate_bps',
  'order.freight_cop',
  'order.quote_ttl_hours',
  'order.reservation_ttl_hours',
  'payment.claim_window_hours',
  'payment.rejection_grace_hours',
  'catalog.product_proposal_pending_limit',
]);

export const parameterResponseSchema = z
  .object({
    key: parameterKeySchema,
    unit: z.enum(['bps', 'cop', 'hours', 'count']),
    value: integerString,
    defaultValue: integerString,
    min: integerString,
    max: integerString,
    provisional: z.boolean(),
    description: z.string(),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();

export const parameterListResponseSchema = z
  .object({ items: z.array(parameterResponseSchema) })
  .strict();

export const updateParameterSchema = z.object({ value: integerString }).strict();

export const auditQuerySchema = z
  .object({
    entity: z.string().min(1).max(64).optional(),
    entityId: z.string().min(1).max(128).optional(),
    actorId: z.string().uuid().optional(),
    action: z.string().min(1).max(64).optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const auditEntryResponseSchema = z
  .object({
    id: z.string().uuid(),
    actorId: z.string().uuid().nullable(),
    actorRole: z.string(),
    action: z.string(),
    entity: z.string(),
    entityId: z.string(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    at: z.string().datetime(),
  })
  .strict();

export const auditPageResponseSchema = z
  .object({ items: z.array(auditEntryResponseSchema), nextCursor: z.string().optional() })
  .strict();
