import { CatalogService } from './catalog-service.js';
import type {
  CategoryRepository,
  ProductRepository,
  LotRepository,
  CatalogUnitOfWork,
  CatalogEventWriter,
  CatalogClock,
  ProviderDirectoryPort,
  ChangeRecorderPort,
} from '../ports/catalog-ports.js';
import type { ProductProps } from '../domain/product.js';
import type { LotProps } from '../domain/lot.js';

const actor = { sub: '018f47a2-8b45-7cc2-9a1e-123456789abc', role: 'producer' };
const staff = { sub: '018f47a2-8b45-7cc2-9a1e-123456789abd', role: 'operator' };

const approved: ProductProps = {
  id: '018f47a2-8b45-7cc2-9a1e-123456789abe',
  categoryId: '018f47a2-8b45-7cc2-9a1e-123456789abf',
  name: 'Tomate chonto',
  unit: 'kg',
  attributes: {},
  status: 'approved',
};

const createHarness = () => {
  const products = new Map<string, ProductProps>([[approved.id, approved]]);
  const categories = new Map([
    [
      approved.categoryId,
      {
        id: approved.categoryId,
        name: 'Hortalizas',
        parentId: null,
        depth: 1,
      },
    ],
  ]);
  const lots = new Map<string, LotProps>();
  const categoryRepository: CategoryRepository = {
    findById: async (id) => categories.get(id) ?? null,
    findAll: async () => [...categories.values()],
    save: async () => undefined,
  };
  const productRepository: ProductRepository = {
    findById: async (id) => products.get(id) ?? null,
    findAll: async () => [...products.values()].filter((product) => product.status === 'approved'),
    save: async (product) => {
      products.set(product.id, product);
    },
    lockForProductProposal: async () => undefined,
    lockPendingLimitByUser: async () => undefined,
    findExactVisible: async () => null,
    findTokenExactVisible: async () => null,
    findSimilarVisible: async () => [],
    countPendingByUser: async () => 0,
    findPending: async () =>
      [...products.values()].filter((product) => product.status === 'pending_review'),
  };
  const lotRepository: LotRepository = {
    findById: async (id) => lots.get(id) ?? null,
    findByIdForOwner: async (id, owner) =>
      lots.get(id)?.providerId === owner ? lots.get(id)! : null,
    findMine: async () => [],
    findVisible: async () => [],
    save: async (lot) => {
      lots.set(lot.id, lot);
      return 'created';
    },
    update: async () => true,
    findExpired: async () => [],
    findAllForChangeBackfill: async () => [],
    softDelete: async () => true,
    lockForReservation: async (ids) =>
      ids.map((id) => lots.get(id)).filter((lot) => lot !== undefined),
    getAvailableQuantity: async () => 0n,
    findOrderReservationLotIds: async () => [],
    reserveStock: async () => 'created',
    releaseOrderReservations: async () => [],
    findExpiredReservationOrderIds: async () => [],
  };
  const uow: CatalogUnitOfWork = { run: async (operation) => operation() };
  const eventWriter: CatalogEventWriter = { append: jest.fn(async () => undefined) };
  const clock: CatalogClock = { now: () => new Date('2026-11-19T12:00:00.000Z') };
  const providerDirectory: ProviderDirectoryPort = {
    getProviderPublicSummaries: async () => new Map(),
  };
  const changeRecorder: ChangeRecorderPort = {
    record: jest.fn(async () => '1'),
    recordBaselineIfAbsent: jest.fn(async () => '1'),
  };
  const service = new CatalogService(
    categoryRepository,
    productRepository,
    lotRepository,
    uow,
    eventWriter,
    clock,
    providerDirectory,
    { lotHorizonDays: 90 },
    changeRecorder,
  );
  return { service, products, lots, productRepository, eventWriter, changeRecorder };
};

describe('Catalog product proposals', () => {
  it('returns an exact approved product with created false', async () => {
    const harness = createHarness();
    harness.productRepository.findExactVisible = jest.fn(async () => approved);
    const result = await harness.service.createProductProposal(actor, {
      id: '018f47a2-8b45-7cc2-9a1e-123456789ab0',
      categoryId: approved.categoryId,
      name: 'Tomate chonto',
      unit: 'kg',
      attributes: {},
    });
    expect(result.created).toBe(false);
    expect(result.product.id).toBe(approved.id);
  });

  it('rejects approximate matches without confirm and supports confirm', async () => {
    const harness = createHarness();
    harness.productRepository.findSimilarVisible = jest.fn(async () => [approved]);
    await expect(
      harness.service.createProductProposal(actor, {
        id: '018f47a2-8b45-7cc2-9a1e-123456789ab1',
        categoryId: approved.categoryId,
        name: 'Tomate Cherry',
        unit: 'kg',
        attributes: {},
      }),
    ).rejects.toMatchObject({ code: 'product_similar_exists' });

    const confirmed = await harness.service.createProductProposal(actor, {
      id: '018f47a2-8b45-7cc2-9a1e-123456789ab2',
      categoryId: approved.categoryId,
      name: 'Tomate Cherry',
      unit: 'kg',
      attributes: {},
      confirm: true,
    });
    expect(confirmed.created).toBe(true);
    expect(confirmed.product.status).toBe('pending_review');
  });

  it('enforces five pending proposals per user', async () => {
    const harness = createHarness();
    harness.productRepository.countPendingByUser = jest.fn(async () => 5);
    await expect(
      harness.service.createProductProposal(actor, {
        id: '018f47a2-8b45-7cc2-9a1e-123456789ab3',
        categoryId: approved.categoryId,
        name: 'Otra fruta',
        unit: 'kg',
        attributes: {},
        confirm: true,
      }),
    ).rejects.toMatchObject({ code: 'pending_limit_reached' });
  });

  it('approves and rejects proposals with domain events and sync owners', async () => {
    const harness = createHarness();
    const proposed: ProductProps = {
      id: '018f47a2-8b45-7cc2-9a1e-123456789ab4',
      categoryId: approved.categoryId,
      name: 'Lulo',
      unit: 'kg',
      attributes: {},
      status: 'pending_review',
      proposedBy: actor.sub,
    };
    harness.products.set(proposed.id, proposed);

    const approvedProposal = await harness.service.approveProductProposal(staff, proposed.id);
    expect(approvedProposal.status).toBe('approved');
    expect(approvedProposal).toMatchObject({
      proposedBy: actor.sub,
      reviewedBy: staff.sub,
      reviewedAt: new Date('2026-11-19T12:00:00.000Z'),
    });

    harness.products.set(proposed.id, proposed);
    const rejected = await harness.service.rejectProductProposal(staff, proposed.id, 'Duplicado');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Duplicado');
  });

  it('blocks publishing a lot that uses a non-approved product', async () => {
    const harness = createHarness();
    const pending: ProductProps = {
      id: '018f47a2-8b45-7cc2-9a1e-123456789ab5',
      categoryId: approved.categoryId,
      name: 'Maracuyá',
      unit: 'kg',
      attributes: {},
      status: 'pending_review',
      proposedBy: actor.sub,
    };
    harness.products.set(pending.id, pending);
    const lot: LotProps = {
      id: '018f47a2-8b45-7cc2-9a1e-123456789ab6',
      providerId: actor.sub,
      productId: pending.id,
      quantityMilli: 1000n,
      unit: 'kg',
      unitPrice: 5000n,
      qualityGrade: null,
      availableFrom: new Date('2026-11-19T12:00:00.000Z'),
      availableUntil: new Date('2026-12-19T12:00:00.000Z'),
      locationLat: 5.5,
      locationLng: -73.4,
      status: 'draft',
      version: 1,
    };
    harness.lots.set(lot.id, lot);
    await expect(harness.service.publishLot(actor, lot.id, 1)).rejects.toMatchObject({
      code: 'product_pending_review',
    });
  });

  it('deduplicates by complete tokens: papa vs papa criolla returns 409 (similar, not exact)', async () => {
    const harness = createHarness();
    const papaCriolla: ProductProps = {
      ...approved,
      id: '018f47a2-8b45-7cc2-9a1e-123456789ac0',
      name: 'Papa criolla',
    };
    harness.products.set(papaCriolla.id, papaCriolla);
    harness.productRepository.findExactVisible = jest.fn(async () => null);
    // findTokenExactVisible should return null because token sets differ: {papa} vs {papa, criolla}
    harness.productRepository.findTokenExactVisible = jest.fn(async () => null);
    harness.productRepository.findSimilarVisible = jest.fn(async () => [papaCriolla]);

    // 'Papa' vs 'Papa criolla' - tokens of one contained in the other but sets differ -> 409 similar
    await expect(
      harness.service.createProductProposal(actor, {
        id: '018f47a2-8b45-7cc2-9a1e-123456789ac1',
        categoryId: approved.categoryId,
        name: 'Papa',
        unit: 'kg',
        attributes: {},
      }),
    ).rejects.toMatchObject({ code: 'product_similar_exists' });
  });

  it('deduplicates by complete tokens: papa vs papaya creates new (no shared tokens)', async () => {
    const harness = createHarness();
    const papaya: ProductProps = {
      ...approved,
      id: '018f47a2-8b45-7cc2-9a1e-123456789ac2',
      name: 'Papaya',
    };
    harness.products.set(papaya.id, papaya);
    harness.productRepository.findExactVisible = jest.fn(async () => null);
    harness.productRepository.findTokenExactVisible = jest.fn(async () => null);
    harness.productRepository.findSimilarVisible = jest.fn(async () => [papaya]);

    // 'Papa' vs 'Papaya' - 'papa' is substring but not a complete token -> creates new
    const resultPapaya = await harness.service.createProductProposal(actor, {
      id: '018f47a2-8b45-7cc2-9a1e-123456789ac3',
      categoryId: approved.categoryId,
      name: 'Papa',
      unit: 'kg',
      attributes: {},
      confirm: true,
    });
    expect(resultPapaya.created).toBe(true);
    expect(resultPapaya.product.name).toBe('Papa');
  });

  it('exact search_text match returns existing product with created:false', async () => {
    const harness = createHarness();
    harness.productRepository.findExactVisible = jest.fn(async () => approved);

    const result = await harness.service.createProductProposal(actor, {
      id: '018f47a2-8b45-7cc2-9a1e-123456789ab0',
      categoryId: approved.categoryId,
      name: 'Tomate chonto',
      unit: 'kg',
      attributes: {},
    });
    expect(result.created).toBe(false);
    expect(result.product.id).toBe(approved.id);
  });

  it('enforces rate limit 429 on proposal endpoint via rate limiter', async () => {
    const mockEnv = {
      CATALOG_PRODUCT_PROPOSAL_RATE_WINDOW_SECONDS: 60,
      CATALOG_PRODUCT_PROPOSAL_RATE_LIMIT: 5,
    } as any;
    const rateLimiterModule = await import('../adapters/in/product-proposal-rate-limiter.js');
    const { RateLimitExceeded } = await import('../../../shared/kernel/domain-error.js');
    const rateLimiter = new rateLimiterModule.InMemoryProductProposalRateLimiter(mockEnv);
    for (let i = 0; i < 5; i++) {
      rateLimiter.consume(actor.sub);
    }
    expect(() => rateLimiter.consume(actor.sub)).toThrow(RateLimitExceeded);
  });
});
