import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { describePostgres } from './postgres-suite.js';

const EXPECTED_JOBS = [
  'catalog.expire-lots',
  'catalog.purge-orphan-photos',
  'identity.purge-otp-codes',
  'identity.purge-rate-limit-windows',
  'identity.purge-sessions',
  'messaging.purge-processed-updates',
  'ordering.expire-reservations-and-quotes',
  'shared.dispatch-outbox',
];

/** Starts the real worker (tsx, real pg-boss) and resolves once it reports ready. */
const startWorker = () =>
  new Promise<{ child: ChildProcessWithoutNullStreams; output: () => string; jobs: string[] }>(
    (resolveStart, rejectStart) => {
      const child = spawn(resolve('node_modules/.bin/tsx'), ['src/worker.ts'], {
        env: { ...process.env, NODE_ENV: 'test' },
        cwd: resolve('.'),
      });
      let output = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        rejectStart(new Error(`Worker did not become ready:\n${output}`));
      }, 60_000);
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        const ready = /Worker ready\. Registered jobs: (.*)\n/.exec(output);
        if (ready) {
          clearTimeout(timer);
          resolveStart({ child, output: () => output, jobs: ready[1]!.split(', ') });
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', (code) => {
        clearTimeout(timer);
        rejectStart(new Error(`Worker exited early (${code}):\n${output}`));
      });
    },
  );

const stopWorker = (child: ChildProcessWithoutNullStreams) =>
  new Promise<number | null>((resolveStop) => {
    child.once('exit', (code) => resolveStop(code));
    child.kill('SIGTERM');
  });

describePostgres('worker process (real pg-boss on PostgreSQL)', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => pool.end());

  it('starts, registers the eight jobs, and stops gracefully on SIGTERM; twice in a row', async () => {
    for (let run = 0; run < 2; run += 1) {
      const worker = await startWorker();
      expect(worker.jobs).toEqual(EXPECTED_JOBS);
      const schedules = await pool.query<{ name: string; timezone: string }>(
        `SELECT name, timezone FROM pgboss.schedule ORDER BY name`,
      );
      expect(schedules.rows).toEqual(EXPECTED_JOBS.map((name) => ({ name, timezone: 'UTC' })));
      expect(await stopWorker(worker.child)).toBe(0);
      expect(worker.output()).toContain('Worker stopped.');
    }
  }, 180_000);
});
