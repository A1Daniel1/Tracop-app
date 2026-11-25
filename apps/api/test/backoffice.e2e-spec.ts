import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../src/bootstrap/app.module.js';
import { configureHttp } from '../src/bootstrap/http.js';
import { DATABASE_POOL } from '../src/shared/infra/tokens.js';
import { PARAMETER_READER, type ParameterReader } from '../src/shared/ports/parameter-reader.js';
import { createStaffAccount } from './helpers/staff-account.js';
import { describePostgres, resetPostgresFixtures } from './postgres-suite.js';

describePostgres('backoffice parameters and audit log (Nest + PostgreSQL)', () => {
  let app: INestApplication;
  let pool: pg.Pool;
  let phone = 3070000001;

  const http = () => request(app.getHttpServer());
  const staff = (role: 'admin' | 'finance' | 'operator') =>
    createStaffAccount(app, pool, role, `+57${phone++}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    pool = app.get(DATABASE_POOL) as pg.Pool;
  });

  beforeEach(async () => {
    await resetPostgresFixtures(pool);
  });

  afterAll(async () => app.close());

  it('serves environment defaults until an admin stores a value, and audits the change', async () => {
    const admin = await staff('admin');
    const finance = await staff('finance');
    const reader = app.get<ParameterReader>(PARAMETER_READER);
    expect(await reader.get('payment.claim_window_hours')).toBe(48n);

    const listed = await http()
      .get('/backoffice/parameters')
      .set({ Authorization: `Bearer ${finance.token}` })
      .expect(200);
    expect(listed.body.items).toHaveLength(7);
    expect(
      listed.body.items.find((item: { key: string }) => item.key === 'payment.claim_window_hours'),
    ).toMatchObject({ value: '48', defaultValue: '48', provisional: true, updatedAt: null });

    await http()
      .put('/backoffice/parameters/payment.claim_window_hours')
      .set({ Authorization: `Bearer ${finance.token}` })
      .send({ value: '24' })
      .expect(403);
    await http()
      .put('/backoffice/parameters/payment.claim_window_hours')
      .set({ Authorization: `Bearer ${admin.token}` })
      .send({ value: '1000' })
      .expect(400);
    await http()
      .put('/backoffice/parameters/payment.unknown')
      .set({ Authorization: `Bearer ${admin.token}` })
      .send({ value: '1' })
      .expect(404);
    const updated = await http()
      .put('/backoffice/parameters/payment.claim_window_hours')
      .set({ Authorization: `Bearer ${admin.token}` })
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ value: '24' })
      .expect(200);
    expect(updated.body).toMatchObject({ value: '24', defaultValue: '48' });
    expect(await reader.get('payment.claim_window_hours')).toBe(24n);

    const audit = await http()
      .get('/backoffice/audit?entity=parameter')
      .set({ Authorization: `Bearer ${admin.token}` })
      .expect(200);
    expect(audit.body.items).toEqual([
      expect.objectContaining({
        actorId: admin.userId,
        actorRole: 'admin',
        action: 'parameter.update',
        entityId: 'payment.claim_window_hours',
        before: { value: '48' },
        after: { value: '24' },
      }),
    ]);
    expect(audit.body.items[0]).not.toHaveProperty('ipHash');
    await http()
      .get('/backoffice/audit')
      .set({ Authorization: `Bearer ${finance.token}` })
      .expect(403);
  });

  it('stores only an HMAC of the client IP and refuses to change or delete audit rows', async () => {
    const admin = await staff('admin');
    await http()
      .put('/backoffice/parameters/order.freight_cop')
      .set({ Authorization: `Bearer ${admin.token}` })
      .send({ value: '12000' })
      .expect(200);

    const [row] = (
      await pool.query<{ ip_hash: string | null; request_id: string | null }>(
        `SELECT ip_hash, request_id FROM backoffice.audit_log`,
      )
    ).rows;
    // Without TRUST_PROXY the address is the socket peer (127.0.0.1 or its IPv6 form).
    const secret = process.env.RATE_LIMIT_HMAC_SECRET!;
    const candidates = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].map((ip) =>
      createHmac('sha256', secret).update(ip).digest('hex'),
    );
    expect(candidates).toContain(row!.ip_hash);
    expect(row!.request_id).toMatch(/^[0-9a-f-]{36}$/);
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'backoffice' AND table_name = 'audit_log'`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).not.toContain('ip');

    await expect(
      pool.query(`UPDATE backoffice.audit_log SET action = 'x.y'`),
    ).rejects.toMatchObject({
      code: '23000',
    });
    await expect(pool.query(`DELETE FROM backoffice.audit_log`)).rejects.toMatchObject({
      code: '23000',
    });
  });

  it('serializes two admins changing the same parameter, even before it has a stored value', async () => {
    const admins = [await staff('admin'), await staff('admin')];
    for (let iteration = 0; iteration < 10; iteration += 1) {
      await pool.query(`TRUNCATE backoffice.audit_log, backoffice.parameters`);
      const responses = await Promise.all(
        admins.map((admin, index) =>
          http()
            .put('/backoffice/parameters/order.commission_rate_bps')
            .set({ Authorization: `Bearer ${admin.token}` })
            .send({ value: String((index + 1) * 100) }),
        ),
      );
      expect(responses.map(({ status }) => status)).toEqual([200, 200]);
      const audits = await pool.query<{ before: { value: string }; after: { value: string } }>(
        `SELECT before, after FROM backoffice.audit_log ORDER BY at, id`,
      );
      const stored = await pool.query<{ value: string }>(
        `SELECT value FROM backoffice.parameters WHERE key = 'order.commission_rate_bps'`,
      );
      // One change starts from the default, the other from the first one's value.
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows[0]!.before.value).toBe('0');
      expect(audits.rows[1]!.before.value).toBe(audits.rows[0]!.after.value);
      expect(stored.rows[0]!.value).toBe(audits.rows[1]!.after.value);
    }
  }, 120_000);
});
