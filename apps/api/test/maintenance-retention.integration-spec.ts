import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import pg from 'pg';
import { AppModule } from '../src/bootstrap/app.module.js';
import {
  IDENTITY_MAINTENANCE,
  type IdentityMaintenanceApi,
} from '../src/modules/identity/index.js';
import { APP_CLOCK, APP_ENVIRONMENT, DATABASE_POOL } from '../src/shared/infra/tokens.js';
import { loadAppEnvironment } from '../src/shared/infra/env.js';
import { createId } from '../src/shared/kernel/ids.js';
import { describePostgres, resetPostgresFixtures } from './postgres-suite.js';

const DAY = 86_400_000;

describePostgres('retention jobs keep what they must keep (PostgreSQL)', () => {
  const now = new Date('2026-11-20T12:00:00.000Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const ahead = (days: number) => new Date(now.getTime() + days * DAY);
  let app: INestApplicationContext;
  let pool: pg.Pool;
  let identity: IdentityMaintenanceApi;

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CLOCK)
      .useValue({ now: () => new Date(now) })
      .overrideProvider(APP_ENVIRONMENT)
      .useValue({
        ...loadAppEnvironment(),
        OTP_RETENTION_DAYS: 7,
        SESSION_RETENTION_DAYS: 30,
        RATE_LIMIT_RETENTION_SECONDS: 86_400,
      })
      .compile();
    await app.init();
    pool = app.get(DATABASE_POOL) as pg.Pool;
    identity = app.get(IDENTITY_MAINTENANCE);
  });
  afterAll(async () => app.close());

  const seedIdentity = async () => {
    await resetPostgresFixtures(pool);
    const userId = createId();
    await pool.query(
      `INSERT INTO identity.users (id, role, full_name, phone, status, locale, created_at, updated_at)
       VALUES ($1, 'producer', 'Persona sintética', '+573009990001', 'active', 'es-CO', $2, $2)`,
      [userId, ago(90)],
    );
    const otp = async (label: string, expiresAt: Date, consumedAt: Date | null = null) => {
      const id = createId();
      await pool.query(
        `INSERT INTO identity.otp_codes
           (id, user_id, code_hash, purpose, max_attempts, expires_at, consumed_at, created_at)
         VALUES ($1, $2, $3, 'login', 5, $4, $5, $6)`,
        [
          id,
          userId,
          `hash-${label}`,
          expiresAt,
          consumedAt,
          new Date(expiresAt.getTime() - 300_000),
        ],
      );
      return id;
    };
    const session = async (
      label: string,
      values: { expiresAt: Date; revokedAt?: Date; createdAt: Date },
    ) => {
      const id = createId();
      const deviceId = createId();
      await pool.query(
        `INSERT INTO identity.devices (id, user_id, platform, created_at) VALUES ($1, $2, 'web', $3)`,
        [deviceId, userId, values.createdAt],
      );
      await pool.query(
        `INSERT INTO identity.sessions
           (id, user_id, device_id, family_id, refresh_hash, expires_at, revoked_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          userId,
          deviceId,
          createId(),
          `refresh-${label}`,
          values.expiresAt,
          values.revokedAt ?? null,
          values.createdAt,
        ],
      );
      return id;
    };
    const window = async (label: string, start: Date) => {
      await pool.query(
        `INSERT INTO identity.rate_limit_counters (key_hash, window_start, count) VALUES ($1, $2, 1)`,
        [`key-${label}`, start],
      );
      return `key-${label}`;
    };
    return {
      deleted: {
        otp: [await otp('expired-8d', ago(8)), await otp('consumed-expired-9d', ago(9), ago(9))],
        sessions: [
          await session('expired-31d', { expiresAt: ago(31), createdAt: ago(61) }),
          await session('revoked-31d', {
            expiresAt: ahead(5),
            revokedAt: ago(31),
            createdAt: ago(40),
          }),
        ],
        windows: [await window('2d', ago(2))],
      },
      kept: {
        otp: [
          await otp('expired-6d', ago(6)),
          await otp('live', ahead(0.002)),
          await otp('consumed-recent', ago(1), ago(1)),
        ],
        sessions: [
          await session('revoked-10d', {
            expiresAt: ahead(5),
            revokedAt: ago(10),
            createdAt: ago(20),
          }),
          await session('live-but-old', { expiresAt: ahead(10), createdAt: ago(60) }),
          await session('expired-29d', { expiresAt: ago(29), createdAt: ago(59) }),
        ],
        windows: [await window('1h', new Date(now.getTime() - 3_600_000))],
      },
    };
  };

  const remaining = async () => ({
    otp: (await pool.query<{ id: string }>('SELECT id FROM identity.otp_codes')).rows
      .map((r) => r.id)
      .sort(),
    sessions: (await pool.query<{ id: string }>('SELECT id FROM identity.sessions')).rows
      .map((r) => r.id)
      .sort(),
    windows: (
      await pool.query<{ key_hash: string }>('SELECT key_hash FROM identity.rate_limit_counters')
    ).rows
      .map((r) => r.key_hash)
      .sort(),
  });

  it('deletes only expired identity data and is idempotent in series', async () => {
    const fixture = await seedIdentity();
    expect(await identity.purgeExpired()).toEqual({
      otpCodes: 2,
      sessions: 2,
      rateLimitWindows: 1,
    });
    const expected = {
      otp: [...fixture.kept.otp].sort(),
      sessions: [...fixture.kept.sessions].sort(),
      windows: [...fixture.kept.windows].sort(),
    };
    expect(await remaining()).toEqual(expected);
    expect(await identity.purgeExpired()).toEqual({
      otpCodes: 0,
      sessions: 0,
      rateLimitWindows: 0,
    });
    expect(await remaining()).toEqual(expected);
  });

  it('gives the same result when two purges run in parallel', async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const fixture = await seedIdentity();
      const [first, second] = await Promise.all([identity.purgeExpired(), identity.purgeExpired()]);
      expect({
        iteration,
        otp: first.otpCodes + second.otpCodes,
        sessions: first.sessions + second.sessions,
        windows: first.rateLimitWindows + second.rateLimitWindows,
      }).toEqual({ iteration, otp: 2, sessions: 2, windows: 1 });
      expect(await remaining()).toEqual({
        otp: [...fixture.kept.otp].sort(),
        sessions: [...fixture.kept.sessions].sort(),
        windows: [...fixture.kept.windows].sort(),
      });
    }
  });
});
