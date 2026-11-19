import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { AppModule } from '../src/bootstrap/app.module.js';
import { CatalogService } from '../src/modules/catalog/application/catalog-service.js';
import { DATABASE_POOL } from '../src/shared/infra/tokens.js';
import { describePostgres, resetPostgresFixtures } from './postgres-suite.js';
import { v7 as uuidv7 } from 'uuid';
import { SyncService } from '../src/modules/sync/application/sync-service.js';

describePostgres('Product proposals PostgreSQL concurrency', () => {
  let app: INestApplication;
  let pool: pg.Pool;
  let catalog: CatalogService;
  let categoryId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    pool = app.get(DATABASE_POOL) as pg.Pool;
    catalog = app.get(CatalogService);
    await resetPostgresFixtures(pool);
  });

  beforeEach(async () => {
    await resetPostgresFixtures(pool);
    categoryId = uuidv7();
    await pool.query(
      `INSERT INTO catalog.categories (id,name,parent_id,depth,created_at,updated_at)
       VALUES ($1,'Verduras',NULL,1,NOW(),NOW())`,
      [categoryId],
    );
  });

  afterAll(async () => app.close());

  it('deduplicates 20 concurrent proposals for the same normalized product', async () => {
    const userId = uuidv7();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        catalog.createProductProposal(
          { sub: userId, role: 'producer' },
          {
            id: uuidv7(),
            categoryId,
            name: 'Tomate Cherry',
            unit: 'kg',
            attributes: { color: 'rojo' },
            confirm: true,
          },
        ),
      ),
    );
    expect(results.filter((result) => result.created).length).toBe(1);
    expect(results.filter((result) => !result.created).length).toBe(19);
  });

  it('allows exactly five pending proposals per user under concurrent calls', async () => {
    const userId = uuidv7();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        catalog.createProductProposal(
          { sub: userId, role: 'supplier' },
          {
            id: uuidv7(),
            categoryId,
            name: `Producto sintético ${index}`,
            unit: 'kg',
            attributes: {},
            confirm: true,
          },
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled').length).toBe(5);
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof Error &&
          'code' in result.reason &&
          result.reason.code === 'pending_limit_reached',
      ).length,
    ).toBe(15);
  });

  it('keeps pending proposals visible only to their proposer or staff', async () => {
    const proposer = uuidv7();
    const thirdParty = uuidv7();
    const proposal = await catalog.createProductProposal(
      { sub: proposer, role: 'producer' },
      {
        id: uuidv7(),
        categoryId,
        name: 'Aguacate Hass',
        unit: 'kg',
        attributes: {},
        confirm: true,
      },
    );
    expect(proposal.created).toBe(true);
    expect(
      (await catalog.listProductProposals({ sub: proposer, role: 'producer' })).map((p) => p.id),
    ).toContain(proposal.product.id);
    expect(
      (await catalog.listProductProposals({ sub: thirdParty, role: 'producer' })).map((p) => p.id),
    ).not.toContain(proposal.product.id);
    expect(
      (await catalog.listProductProposals({ sub: thirdParty, role: 'operator' })).map((p) => p.id),
    ).toContain(proposal.product.id);
  });

  it('publishes pending, approved and rejected product changes with owner visibility', async () => {
    const proposer = uuidv7();
    const thirdParty = uuidv7();
    const sync = app.get(SyncService);
    const proposal = await catalog.createProductProposal(
      { sub: proposer, role: 'producer' },
      {
        id: uuidv7(),
        categoryId,
        name: 'Pitahaya',
        unit: 'kg',
        attributes: {},
        confirm: true,
      },
    );
    const proposerPending = await sync.pull(
      { sub: proposer, role: 'producer', did: uuidv7() },
      '0',
      500,
    );
    expect(
      proposerPending.changes.some(
        (change) =>
          change.entity === 'product' &&
          change.entityId === proposal.product.id &&
          change.op === 'upsert',
      ),
    ).toBe(true);
    const thirdPending = await sync.pull(
      { sub: thirdParty, role: 'buyer', did: uuidv7() },
      '0',
      500,
    );
    expect(
      thirdPending.changes.some(
        (change) => change.entity === 'product' && change.entityId === proposal.product.id,
      ),
    ).toBe(false);

    await catalog.approveProductProposal({ sub: uuidv7(), role: 'operator' }, proposal.product.id);
    const thirdApproved = await sync.pull(
      { sub: thirdParty, role: 'buyer', did: uuidv7() },
      '0',
      500,
    );
    expect(
      thirdApproved.changes.some(
        (change) =>
          change.entity === 'product' &&
          change.entityId === proposal.product.id &&
          change.op === 'upsert',
      ),
    ).toBe(true);

    const rejected = await catalog.createProductProposal(
      { sub: proposer, role: 'producer' },
      {
        id: uuidv7(),
        categoryId,
        name: 'Fruta rechazada',
        unit: 'kg',
        attributes: {},
        confirm: true,
      },
    );
    await catalog.rejectProductProposal(
      { sub: uuidv7(), role: 'admin' },
      rejected.product.id,
      'Motivo sintético',
    );
    const proposerRejected = await sync.pull(
      { sub: proposer, role: 'producer', did: uuidv7() },
      '0',
      500,
    );
    expect(
      proposerRejected.changes.some(
        (change) =>
          change.entity === 'product' &&
          change.entityId === rejected.product.id &&
          change.op === 'delete',
      ),
    ).toBe(true);
  });
});
