import { DomainError } from '../../../shared/kernel/domain-error.js';
import type { CheckinKind } from './trip-states.js';

export interface PickupCandidate {
  readonly orderId: string;
  readonly providerId: string;
  readonly pickupZone: string;
  readonly deliveryZone: string;
  readonly deliveryWindow: string | null;
}

export interface RecommendedStop {
  readonly orderId: string;
  readonly kind: CheckinKind;
  readonly sequence: number;
  readonly zone: string;
}

/** Normaliza una dirección de texto a una zona; nunca usa coordenadas. */
export const zoneFromAddress = (address: string): string => {
  const zone = address.split(',')[0]?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!zone) throw new DomainError('La dirección de entrega no tiene zona.', 'invalid_address');
  return zone;
};

/**
 * Recomendación básica: recogidas agrupadas por zona del proveedor y entregas
 * agrupadas por zona textual del destinatario, recogidas antes que entregas.
 * No calcula distancias geográficas ni optimiza rutas.
 */
export const recommendStops = (
  candidates: readonly PickupCandidate[],
): readonly RecommendedStop[] => {
  if (new Set(candidates.map((candidate) => candidate.orderId)).size !== candidates.length)
    throw new DomainError('Pedidos duplicados en la recomendación.', 'duplicate_order');

  const pickups = candidates
    .map((candidate) => ({
      orderId: candidate.orderId,
      kind: 'pickup' as const,
      zone: candidate.pickupZone,
    }))
    .sort(compareStops);
  const deliveries = candidates
    .map((candidate) => ({
      orderId: candidate.orderId,
      kind: 'delivery' as const,
      zone: candidate.deliveryZone,
    }))
    .sort(compareStops);

  return [...pickups, ...deliveries].map((stop, index) => ({ ...stop, sequence: index + 1 }));
};

const compareStops = (
  left: { readonly orderId: string; readonly zone: string },
  right: { readonly orderId: string; readonly zone: string },
): number => left.zone.localeCompare(right.zone) || left.orderId.localeCompare(right.orderId);
