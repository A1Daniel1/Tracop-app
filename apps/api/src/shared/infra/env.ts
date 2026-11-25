import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');
const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default('tracop'),
  JWT_AUDIENCE: z.string().min(1).default('tracop-api'),
  JWT_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().max(60).default(5),
  OTP_HMAC_SECRET: z.string().min(32),
  RATE_LIMIT_HMAC_SECRET: z.string().min(32),
  PRIVACY_POLICY_VERSION: z.string().min(1).default('v0-draft'),
  ALLOWED_COUNTRY_CODES: z.string().default('57'),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  SUPPORTED_LOCALES: z.string().default('es-CO,en'),
  TRUST_PROXY: z.union([booleanFromString, z.coerce.number().int().nonnegative()]).default(false),
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_PHONE_LIMIT: z.coerce.number().int().positive().default(3),
  OTP_PHONE_WINDOW_SECONDS: z.coerce.number().int().positive().default(600),
  OTP_PHONE_COOLDOWN_LIMIT: z.coerce.number().int().positive().default(1),
  OTP_PHONE_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_IP_REQUEST_LIMIT: z.coerce.number().int().positive().default(30),
  OTP_IP_VERIFY_LIMIT: z.coerce.number().int().positive().default(60),
  OTP_IP_WINDOW_SECONDS: z.coerce.number().int().positive().default(600),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  OTP_SENDER: z.enum(['console', 'telegram']).default('console'),
  TELEGRAM_MODE: z.enum(['webhook', 'polling']).default('webhook'),
  TELEGRAM_BOT_TOKEN: optionalText(z.string().min(1)),
  TELEGRAM_WEBHOOK_SECRET: optionalText(z.string().regex(/^[A-Za-z0-9_-]{1,256}$/)),
  TELEGRAM_BOT_USERNAME: optionalText(z.string().regex(/^[A-Za-z0-9_]{5,32}$/)),
  TELEGRAM_API_ROOT: z.string().url().default('https://api.telegram.org'),
  TELEGRAM_WEBHOOK_PROCESS_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  TELEGRAM_RATE_LIMIT_PER_SENDER: z.coerce.number().int().positive().default(20),
  TELEGRAM_RATE_LIMIT_GLOBAL: z.coerce.number().int().positive().default(300),
  TELEGRAM_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  CATALOG_LOT_MAX_HORIZON_DAYS: z.coerce.number().int().positive().max(365).default(90),
  CATALOG_SEARCH_RADIUS_MAX_KM: z.coerce.number().positive().max(1000).default(500),
  CATALOG_SEARCH_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  CATALOG_SEARCH_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // PROVISIONAL: pending proposals per provider; validate with real producers.
  CATALOG_PRODUCT_PROPOSAL_PENDING_LIMIT: z.coerce.number().int().positive().max(50).default(5),
  CATALOG_PRODUCT_PROPOSAL_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  CATALOG_PRODUCT_PROPOSAL_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  CATALOG_PHOTO_MAX_COUNT: z.coerce.number().int().positive().max(5).default(5),
  CATALOG_PHOTO_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  CATALOG_PHOTO_MAX_INPUT_PIXELS: z.coerce.number().int().positive().default(25_000_000),
  CATALOG_PHOTO_MAX_INPUT_DIMENSION: z.coerce.number().int().positive().default(10_000),
  CATALOG_PHOTO_MAX_OUTPUT_DIMENSION: z.coerce.number().int().positive().default(2_048),
  CATALOG_PHOTO_PENDING_TTL_SECONDS: z.coerce.number().int().positive().default(1_800),
  CATALOG_PHOTO_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  CATALOG_PHOTO_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  CATALOG_PHOTO_PURGE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(3_600),
  CATALOG_PHOTO_WEBP_QUALITY: z.coerce.number().int().min(1).max(100).default(80),
  CATALOG_PHOTO_CONCURRENCY: z.coerce.number().int().positive().default(2),
  CATALOG_PHOTO_PROCESSING_LEASE_SECONDS: z.coerce.number().int().positive().default(300),
  CATALOG_PHOTO_UPLOAD_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  CATALOG_PHOTO_UPLOAD_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  SYNC_PUSH_MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(256 * 1024)
    .default(256 * 1024),
  SYNC_PUSH_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  SYNC_PULL_RATE_LIMIT: z.coerce.number().int().positive().default(120),
  SYNC_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  ORDER_QUOTE_TTL_HOURS: z.coerce.number().int().positive().default(24),
  ORDER_RESERVATION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  ORDER_SUBTOTAL_ROUNDING: z.enum(['half_up', 'floor', 'ceil']).default('half_up'),
  ORDER_COMMISSION_RATE_BPS: z
    .string()
    .regex(/^(0|[1-9]\d{0,4})$/)
    .default('0')
    .transform(BigInt),
  ORDER_FREIGHT_COP: z
    .string()
    .regex(/^(0|[1-9]\d{0,18})$/)
    .default('0')
    .transform(BigInt),
  ORDER_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  ORDER_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  ORDER_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
  ORDER_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // PROVISIONAL payment values (AGENTS §23): validate with the team before the pilot.
  PAYMENT_REJECTION_GRACE_HOURS: z.coerce.number().int().positive().max(168).default(4),
  PAYMENT_CLAIM_WINDOW_HOURS: z.coerce.number().int().positive().max(720).default(48),
  PAYMENT_PROOF_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  PAYMENT_PROOF_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  PAYMENT_PROOF_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // PROVISIONAL retention values; validate with the team and Ley 1581 obligations.
  OTP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PROCESSED_UPDATES_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  RATE_LIMIT_RETENTION_SECONDS: z.coerce.number().int().positive().default(86_400),
  // PROVISIONAL: how long a downloaded location pack may be kept by the app.
  LOGISTICS_LOCATION_MAX_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  LOGISTICS_LOCATION_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  LOGISTICS_LOCATION_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  JOB_EXPIRE_LOTS_CRON: z.string().trim().min(9).default('*/5 * * * *'),
  JOB_EXPIRE_ORDERS_CRON: z.string().trim().min(9).default('*/5 * * * *'),
  JOB_PURGE_PHOTOS_CRON: z.string().trim().min(9).default('17 * * * *'),
  JOB_RETENTION_CRON: z.string().trim().min(9).default('40 4 * * *'),
  JOB_OUTBOX_DISPATCH_CRON: z.string().trim().min(9).default('* * * * *'),
  JOB_ISSUE_SETTLEMENTS_CRON: z.string().trim().min(9).default('*/15 * * * *'),
  JOB_SEND_NOTIFICATIONS_CRON: z.string().trim().min(9).default('* * * * *'),
  NOTIFICATIONS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  NOTIFICATIONS_RETRY_BASE_SECONDS: z.coerce.number().int().positive().max(3600).default(30),
  NOTIFICATIONS_RETRY_MAX_SECONDS: z.coerce.number().int().positive().max(86_400).default(3600),
  NOTIFICATIONS_LEASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OUTBOX_RETRY_BASE_SECONDS: z.coerce.number().int().positive().max(3600).default(5),
  OUTBOX_RETRY_MAX_SECONDS: z.coerce.number().int().positive().max(86_400).default(300),
  S3_ENDPOINT: optionalText(z.string().url()),
  S3_PUBLIC_ENDPOINT: optionalText(z.string().url()),
  S3_BUCKET: optionalText(z.string().min(3).max(63)),
  S3_REGION: optionalText(z.string().min(1)),
  S3_API_ACCESS_KEY: optionalText(z.string().min(1)),
  S3_API_SECRET_KEY: optionalText(z.string().min(1)),
  S3_POLICY_ACCESS_KEY: optionalText(z.string().min(1)),
  S3_POLICY_SECRET_KEY: optionalText(z.string().min(1)),
});

const parsedEnvironmentSchema = envSchema.superRefine((value, ctx) => {
  const longestDatabaseRateWindow = Math.max(
    value.OTP_PHONE_WINDOW_SECONDS,
    value.OTP_PHONE_COOLDOWN_SECONDS,
    value.OTP_IP_WINDOW_SECONDS,
  );
  if (value.RATE_LIMIT_RETENTION_SECONDS < longestDatabaseRateWindow) {
    ctx.addIssue({
      code: 'custom',
      path: ['RATE_LIMIT_RETENTION_SECONDS'],
      message: 'RATE_LIMIT_RETENTION_SECONDS must cover the longest OTP rate-limit window.',
    });
  }
  const requiresTelegram = value.NODE_ENV === 'production' || value.OTP_SENDER === 'telegram';

  if (requiresTelegram && !value.TELEGRAM_BOT_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['TELEGRAM_BOT_TOKEN'], message: 'Required.' });
  }
  if (value.OTP_SENDER === 'console' && value.NODE_ENV === 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['OTP_SENDER'],
      message: 'Production requires OTP_SENDER=telegram.',
    });
  }
  if (value.NODE_ENV === 'production' && value.TELEGRAM_MODE !== 'webhook') {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_MODE'],
      message: 'Production requires TELEGRAM_MODE=webhook.',
    });
  }
  if (value.NODE_ENV === 'production') {
    for (const key of [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_REGION',
      'S3_API_ACCESS_KEY',
      'S3_API_SECRET_KEY',
      'S3_POLICY_ACCESS_KEY',
      'S3_POLICY_SECRET_KEY',
    ] as const) {
      if (!value[key])
        ctx.addIssue({ code: 'custom', path: [key], message: 'Required in production.' });
    }
    for (const key of ['S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT'] as const) {
      const endpoint = value[key] ?? (key === 'S3_PUBLIC_ENDPOINT' ? value.S3_ENDPOINT : undefined);
      if (endpoint && new URL(endpoint).protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Production requires an https URL.' });
      }
    }
  }
  if (value.TELEGRAM_MODE === 'polling' && value.NODE_ENV !== 'development') {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_MODE'],
      message: 'Polling is only available in development.',
    });
  }
  if (value.NODE_ENV === 'production' && !value.TELEGRAM_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_WEBHOOK_SECRET'],
      message: 'Required in production.',
    });
  }
  const corsOrigins = value.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'CORS_ALLOWED_ORIGINS contiene un origen inválido.',
      });
      continue;
    }
    if (origin !== parsedOrigin.origin) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'CORS_ALLOWED_ORIGINS solo admite orígenes, sin ruta.',
      });
    }
    if (origin.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'CORS_ALLOWED_ORIGINS no admite comodines.',
      });
    }
    if (value.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'Production requires HTTPS CORS origins.',
      });
    }
    if (
      value.NODE_ENV === 'development' &&
      parsedOrigin.hostname !== 'localhost' &&
      parsedOrigin.hostname !== '127.0.0.1'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'Development CORS origins must use localhost or 127.0.0.1.',
      });
    }
  }
});

export type AppEnvironment = z.infer<typeof envSchema> & {
  TELEGRAM_BOT_USERNAME: string;
  S3_REGION: string;
  S3_PUBLIC_ENDPOINT: string | undefined;
  allowedCountryCodes: readonly string[];
  supportedLocales: readonly string[];
  allowedCorsOrigins: readonly string[];
  telegramBotLink: string;
};

export const loadAppEnvironment = (cwd = process.cwd()): AppEnvironment => {
  const rootEnvPath = resolve(cwd, '../../.env');
  const fileEnvironment = existsSync(rootEnvPath)
    ? parseEnv(readFileSync(rootEnvPath, 'utf8'))
    : {};
  const parsed = parsedEnvironmentSchema.parse({ ...fileEnvironment, ...process.env });
  if (parsed.NODE_ENV === 'production' && !parsed.TELEGRAM_BOT_USERNAME) {
    throw new Error('TELEGRAM_BOT_USERNAME is required in production.');
  }
  const telegramBotUsername = parsed.TELEGRAM_BOT_USERNAME ?? 'tracop_demo_bot';

  const allowedCountryCodes = parsed.ALLOWED_COUNTRY_CODES.split(',')
    .map((countryCode) => countryCode.trim())
    .filter(Boolean);
  if (
    allowedCountryCodes.length === 0 ||
    allowedCountryCodes.some((code) => !/^\d{1,3}$/.test(code))
  ) {
    throw new Error(
      'ALLOWED_COUNTRY_CODES must be a comma-separated list of numeric calling codes.',
    );
  }

  const supportedLocales = parsed.SUPPORTED_LOCALES.split(',')
    .map((locale) => locale.trim())
    .filter(Boolean);
  if (
    supportedLocales.length === 0 ||
    supportedLocales.some((locale) => !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale))
  ) {
    throw new Error('SUPPORTED_LOCALES must be a comma-separated list of locales like es-CO.');
  }
  const allowedCorsOrigins = parsed.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    ...parsed,
    TELEGRAM_BOT_USERNAME: telegramBotUsername,
    allowedCountryCodes,
    supportedLocales,
    allowedCorsOrigins,
    telegramBotLink: `https://t.me/${telegramBotUsername}?start=link`,
    S3_PUBLIC_ENDPOINT: parsed.S3_PUBLIC_ENDPOINT ?? parsed.S3_ENDPOINT,
    S3_REGION: parsed.S3_REGION ?? 'us-east-1',
  };
};
