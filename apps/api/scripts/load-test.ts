/**
 * Basic load test of the two hot paths: lot search and sync push. Self-contained: it starts a
 * disposable PostgreSQL 16 (Testcontainers), applies the migrations, seeds synthetic data, boots
 * the API in this process on a free port and drives it over HTTP. Never touches .env or a real
 * database. Rate limits are raised for the run (they would otherwise be what is measured).
 *
 *   pnpm --filter @tracop/api load:test
 *   LOAD_SEARCH_WORKERS, LOAD_SEARCH_REQUESTS, LOAD_PUSH_WORKERS, LOAD_PUSH_BATCHES, LOAD_LOTS
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { createId as uuidv7 } from '../src/shared/kernel/ids.js';

const number = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const SEARCH_WORKERS = number('LOAD_SEARCH_WORKERS', 20);
const SEARCH_REQUESTS = number('LOAD_SEARCH_REQUESTS', 50);
const PUSH_WORKERS = number('LOAD_PUSH_WORKERS', 10);
const PUSH_BATCHES = number('LOAD_PUSH_BATCHES', 20);
const PUSH_BATCH_SIZE = 10;
const LOTS = number('LOAD_LOTS', 1000);

type Sample = {
  readonly ms: number;
  readonly ok: boolean;
  readonly status: number;
  readonly applied?: number;
};

const summarize = (name: string, samples: readonly Sample[], elapsedMs: number): string => {
  const sorted = samples.map(({ ms }) => ms).sort((left, right) => left - right);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const errors = samples.filter(({ ok }) => !ok).length;
  return [
    `${name}: ${samples.length} requests in ${(elapsedMs / 1000).toFixed(1)} s → ${(samples.length / (elapsedMs / 1000)).toFixed(1)} req/s`,
    `  latency ms  p50 ${at(0.5).toFixed(1)}  p95 ${at(0.95).toFixed(1)}  p99 ${at(0.99).toFixed(1)}  max ${(sorted.at(-1) ?? 0).toFixed(1)}`,
    `  errors ${errors} (${((errors / Math.max(samples.length, 1)) * 100).toFixed(2)} %) · statuses ${JSON.stringify(
      samples.reduce<Record<number, number>>(
        (counts, { status }) => ({ ...counts, [status]: (counts[status] ?? 0) + 1 }),
        {},
      ),
    )}`,
    ...(samples.some(({ applied }) => applied !== undefined)
      ? [`  operations applied ${samples.reduce((sum, { applied = 0 }) => sum + applied, 0)}`]
      : []),
  ].join('\n');
};

const timed = async (operation: () => Promise<Response>): Promise<Sample> => {
  const startedAt = performance.now();
  try {
    const response = await operation();
    const text = await response.text();
    const ms = performance.now() - startedAt;
    let applied: number | undefined;
    try {
      const body = JSON.parse(text) as { results?: { status: string }[] };
      if (Array.isArray(body.results))
        applied = body.results.filter(({ status }) => status === 'applied').length;
    } catch {
      // not JSON
    }
    return {
      ms,
      ok: response.status < 400,
      status: response.status,
      ...(applied === undefined ? {} : { applied }),
    };
  } catch {
    return { ms: performance.now() - startedAt, ok: false, status: 0 };
  }
};

const main = async (): Promise<void> => {
  if (process.env.CI === 'true')
    throw new Error('load:test is a manual measurement; it does not run in CI.');
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const databaseUrl = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // The container is stopped at the end; idle connections then error out harmlessly.
  pool.on('error', () => undefined);
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS shared');
    await pool.query(
      'CREATE TABLE IF NOT EXISTS shared.schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of (await readdir(resolve('drizzle')))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      await pool.query(await readFile(resolve('drizzle', file), 'utf8'));
      await pool.query('INSERT INTO shared.schema_migrations (id) VALUES ($1)', [file]);
    }

    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'load-test-jwt-secret-not-for-real-use-0000000',
      OTP_HMAC_SECRET: 'load-test-otp-hmac-secret-not-for-real-use-0',
      RATE_LIMIT_HMAC_SECRET: 'load-test-rate-limit-secret-not-for-real-00',
      OTP_SENDER: 'console',
      TELEGRAM_MODE: 'webhook',
      CATALOG_SEARCH_RATE_LIMIT: '1000000',
      SYNC_PUSH_RATE_LIMIT: '1000000',
      OTP_IP_REQUEST_LIMIT: '100000',
      OTP_IP_VERIFY_LIMIT: '100000',
    });
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../src/bootstrap/app.module.js');
    const { configureHttp } = await import('../src/bootstrap/http.js');
    const { InMemoryOtpSender } =
      await import('../src/modules/identity/adapters/out/otp-senders.js');
    const { OTP_SENDER } = await import('../src/modules/identity/ports/tokens.js');
    const otp = new InMemoryOtpSender();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .compile();
    const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    configureHttp(app, 256 * 1024);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const json = (path: string, body: unknown, token?: string) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

    let phone = 3_150_000_000;
    const account = async (role: 'buyer' | 'supplier') => {
      const number = String(phone++);
      const deviceId = uuidv7();
      await json('/auth/register', {
        phone: number,
        role,
        fullName: 'Persona sintética',
        deviceId,
        platform: 'web',
        consent: { accepted: true, version: 'v0-draft' },
      });
      const verified = await json('/auth/otp/verify', {
        phone: number,
        deviceId,
        platform: 'web',
        code: [...otp.sent].reverse().find((sent) => sent.phone.endsWith(number))?.code,
      });
      const body = (await verified.json()) as { accessToken: string; user: { id: string } };
      return { token: body.accessToken, userId: body.user.id };
    };

    // Synthetic catalog: one category, three products, LOTS published lots across the corridor.
    const categoryId = randomUUID();
    await pool.query(
      `INSERT INTO catalog.categories (id, name, parent_id, depth, created_at, updated_at) VALUES ($1, 'Tubérculos', NULL, 1, now(), now())`,
      [categoryId],
    );
    const products: string[] = [];
    for (const name of ['Papa criolla', 'Papa pastusa', 'Arracacha']) {
      const id = randomUUID();
      products.push(id);
      await pool.query(
        `INSERT INTO catalog.products (id, category_id, name, search_text, unit, attributes, created_at, updated_at) VALUES ($1, $2, $3, lower($3), 'kg', '{}', now(), now())`,
        [id, categoryId, name],
      );
    }
    const suppliers: { token: string; userId: string }[] = [];
    for (let index = 0; index < PUSH_WORKERS; index += 1) {
      const supplier = await account('supplier');
      // Publishing requires a provider profile; the seeded lots need one too.
      await fetch(`${base}/me/provider-profile`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${supplier.token}` },
        body: JSON.stringify({
          displayName: 'Finca sintética',
          municipality: 'Tunja',
          department: 'Boyacá',
          lat: 5.53,
          lng: -73.36,
          description: 'Sintético',
        }),
      });
      suppliers.push(supplier);
    }
    await pool.query(
      `INSERT INTO catalog.lots (id, provider_id, product_id, quantity, unit, unit_price, available_from, available_until,
         location_lat, location_lng, status, version, created_at, updated_at)
       SELECT gen_random_uuid(), ($1::uuid[])[1 + (i % $2)], ($3::uuid[])[1 + (i % 3)], 100, 'kg', 2000 + (i % 500),
         now() - interval '1 hour', now() + interval '20 days', 4.5 + (i % 100) / 100.0, -74.2 + (i % 100) / 100.0,
         'published', 1, now(), now()
       FROM generate_series(1, $4) AS i`,
      [suppliers.map(({ userId }) => userId), suppliers.length, products, LOTS],
    );
    const buyers: { token: string; userId: string }[] = [];
    for (let index = 0; index < SEARCH_WORKERS; index += 1) buyers.push(await account('buyer'));

    // Search: plain text, and text near a point with distance sort.
    const queries = [
      '/lots?q=papa&limit=20',
      '/lots?q=papa&lat=4.65&lng=-74.08&radiusKm=50&sort=distance&limit=20',
      '/lots?limit=50',
    ];
    const searchSamples: Sample[] = [];
    let startedAt = performance.now();
    await Promise.all(
      buyers.map(async ({ token }, worker) => {
        for (let index = 0; index < SEARCH_REQUESTS; index += 1)
          searchSamples.push(
            await timed(() =>
              fetch(`${base}${queries[(worker + index) % queries.length]}`, {
                headers: { authorization: `Bearer ${token}` },
              }),
            ),
          );
      }),
    );
    const searchElapsed = performance.now() - startedAt;

    // Sync push: each supplier pushes batches of lot creations.
    const pushSamples: Sample[] = [];
    startedAt = performance.now();
    await Promise.all(
      suppliers.map(async ({ token }) => {
        for (let batch = 0; batch < PUSH_BATCHES; batch += 1) {
          const operations = Array.from({ length: PUSH_BATCH_SIZE }, (_, index) => {
            const id = uuidv7();
            return {
              opId: uuidv7(),
              entity: 'lot',
              entityId: id,
              type: 'create',
              payload: {
                id,
                productId: products[index % products.length],
                quantityMilli: '10000',
                unit: 'kg',
                unitPrice: 2400,
                qualityGrade: null,
                availableFrom: new Date().toISOString(),
                availableUntil: new Date(Date.now() + 86_400_000).toISOString(),
                locationLat: 5.5,
                locationLng: -73.4,
              },
            };
          });
          pushSamples.push(await timed(() => json('/sync/push', { operations }, token)));
        }
      }),
    );
    const pushElapsed = performance.now() - startedAt;

    process.stdout.write(
      [
        `Node ${process.version} · PostgreSQL 16 (Testcontainers) · ${LOTS} lots`,
        summarize(`Search (${SEARCH_WORKERS} concurrent buyers)`, searchSamples, searchElapsed),
        summarize(
          `Sync push (${PUSH_WORKERS} concurrent suppliers, ${PUSH_BATCH_SIZE} operations per request)`,
          pushSamples,
          pushElapsed,
        ),
      ].join('\n') + '\n',
    );
    await app.close();
  } catch (error) {
    process.stderr.write(
      `load:test step failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'Error'}\n`,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
    await container.stop();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`load:test failed: ${error instanceof Error ? error.message : 'Error'}\n`);
  process.exit(1);
});
