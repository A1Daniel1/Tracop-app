import { Global, Module } from '@nestjs/common';
import { CatalogModule } from '../modules/catalog/index.js';
import {
  LOT_QUOTE_PORT,
  LOT_RESERVATION_PORT,
  type LotQuotePort,
  type LotReservationPort,
  type LotQuoteSnapshot,
} from '../modules/ordering/index.js';
import { CATALOG_ORDERING_API, type CatalogOrderingApi } from '../modules/catalog/index.js';
import { DomainError } from '../shared/kernel/domain-error.js';

export class CatalogLotQuoteAdapter implements LotQuotePort {
  constructor(private readonly api: CatalogOrderingApi) {}

  async getQuote(lotId: string): Promise<LotQuoteSnapshot> {
    try {
      return await this.api.getLotQuote(lotId);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'not_found') {
        throw new DomainError('Lote no encontrado.', 'not_found');
      }
      throw error;
    }
  }
}

export class CatalogLotReservationAdapter implements LotReservationPort {
  constructor(private readonly api: CatalogOrderingApi) {}

  async reserve(
    orderId: string,
    lines: readonly { lotId: string; quantityMilli: bigint }[],
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.api.reserveLots({ orderId, lines, expiresAt });
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError('Error al reservar lotes.', 'reservation_failed');
    }
  }

  async release(orderId: string): Promise<void> {
    await this.api.releaseOrderReservations(orderId);
  }

  async findExpiredOrderIds(now: Date, limit: number): Promise<readonly string[]> {
    return this.api.findExpiredReservationOrderIds(now, limit);
  }
}

@Global()
@Module({
  imports: [CatalogModule],
  providers: [
    {
      provide: LOT_QUOTE_PORT,
      inject: [CATALOG_ORDERING_API],
      useFactory: (api: CatalogOrderingApi) => new CatalogLotQuoteAdapter(api),
    },
    {
      provide: LOT_RESERVATION_PORT,
      inject: [CATALOG_ORDERING_API],
      useFactory: (api: CatalogOrderingApi) => new CatalogLotReservationAdapter(api),
    },
  ],
  exports: [LOT_QUOTE_PORT, LOT_RESERVATION_PORT],
})
export class OrderingBridgeModule {}
