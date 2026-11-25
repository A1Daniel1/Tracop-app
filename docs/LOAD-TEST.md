# Prueba de carga básica

`pnpm --filter @tracop/api load:test` levanta un PostgreSQL 16 desechable con Testcontainers, aplica las migraciones y siembra datos sintéticos. Después arranca la API en el mismo proceso y la carga por HTTP. No usa `.env` ni ninguna base real. Durante la prueba sube los límites de tasa, porque si no serían lo único que se mediría. Se niega a correr con `CI=true`.

| Variable                                       | Por defecto | Qué es                                                                                |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `LOAD_LOTS`                                    | 1000        | Lotes publicados sembrados (3 productos, 10 proveedores)                              |
| `LOAD_SEARCH_WORKERS` / `LOAD_SEARCH_REQUESTS` | 20 / 50     | Compradores concurrentes y búsquedas por comprador                                    |
| `LOAD_PUSH_WORKERS` / `LOAD_PUSH_BATCHES`      | 10 / 20     | Proveedores concurrentes y peticiones de push por proveedor (10 operaciones cada una) |

## Resultado (2026-11-25)

Máquina de desarrollo (Linux), Node v22.23.4, con la API, PostgreSQL y el generador de carga en la misma máquina:

```
Node v22.23.4 · PostgreSQL 16 (Testcontainers) · 1000 lots
Search (20 concurrent buyers): 1000 requests in 13.5 s → 73.8 req/s
  latency ms  p50 268.1  p95 300.1  p99 349.7  max 595.0
  errors 0 (0.00 %) · statuses {"200":1000}
Sync push (10 concurrent suppliers, 10 operations per request): 200 requests in 3.0 s → 66.2 req/s
  latency ms  p50 147.8  p95 174.0  p99 183.7  max 186.2
  errors 0 (0.00 %) · statuses {"201":200}
  operations applied 2000
```

Las búsquedas mezclan texto, texto con distancia y orden por distancia, y listado sin filtro.

## Lectura

- **Búsqueda:** unas 74 búsquedas por segundo con 1000 lotes, con p95 de 300 ms. La búsqueda filtra en memoria antes de paginar ([ADR-010](adr/ADR-010.md)), así que la latencia crece con el número de lotes visibles. Para el piloto (un corredor, pocos productos) alcanza. Con decenas de miles de lotes habría que llevar el filtro y la paginación a SQL.
- **Push de sync:** unas 660 operaciones por segundo (66 peticiones de 10), con p95 de 174 ms y todas aplicadas. El lock global de secuencia del change log ([ADR-012](adr/ADR-012.md)) serializa las escrituras: es el techo conocido.
- No mide la red real, varias instancias ni un PostgreSQL gestionado.
