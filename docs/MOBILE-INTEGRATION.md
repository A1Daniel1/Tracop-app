# Integración con la app móvil

Guía para el equipo de la app móvil. El contrato vinculante es [`docs/openapi.json`](openapi.json) junto con `packages/contracts`; este documento resume el comportamiento que importa al cliente y se amplía en la pasada de documentación.

## Política de contratos

- Los cambios compatibles solo añaden (rutas, campos opcionales, códigos nuevos documentados).
- Un cambio incompatible (quitar o renombrar campos, cambiar el estado HTTP o el `code` de un error) se marca con la etiqueta **BREAKING** en el PR y se anota en la sección siguiente antes de integrarse.

## Cambios BREAKING

### 409 para conflictos al crear o asignar viajes

| Situación                                                                               | Antes                                                                | Ahora                          |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| `POST /logistics/trips` con un pedido que no está pagado                                | 400 `invalid_order_status`                                           | **409** `invalid_order_status` |
| `POST /logistics/trips` con un pedido que ya está en otro viaje                         | 400 `assignment_conflict`                                            | **409** `assignment_conflict`  |
| Dos transportistas crean a la vez un viaje con el mismo pedido (la petición que pierde) | 409 `version_conflict` o 400 `assignment_conflict`, según el momento | **409**                        |

`POST /logistics/trips/{id}/assign` y `/reassign` también responden 409 con `assignment_conflict`. El cuerpo de error y el `code` no cambian; el cliente debe tratar estos casos como conflicto (409), no como solicitud inválida (400).

## Comportamientos a tener en cuenta

### Un lote totalmente reservado responde 404 a los compradores

La visibilidad pública depende de la **cantidad disponible** (cantidad del lote menos las reservas activas y vigentes), no solo del estado:

- `GET /lots` lista lotes `published` o `reserved` vigentes **con cantidad disponible mayor que 0**.
- `GET /lots/{id}` responde **404** a compradores y terceros si el lote no está vigente o su cantidad disponible es 0. Su dueño lo sigue viendo siempre (por ejemplo, `status: reserved` y `availableQuantityMilli: "0"` cuando pedidos aceptados reservaron todo).

Un lote reservado solo en parte sigue siendo visible con la cantidad restante. Si una reserva se libera (cancelación o vencimiento), la cantidad vuelve a estar disponible y el lote reaparece.
