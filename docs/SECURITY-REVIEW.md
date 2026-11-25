# Revisión de seguridad (fase 9)

Fecha: 2026-11-25. Alcance: la API (`apps/api`) y los paquetes del monorepo. Complementa [SECURITY.md](../SECURITY.md) y [AGENTS §16](../AGENTS.md).

## Secretos

| Comprobación                                                                                                                                       | Resultado                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archivos `.env` en git                                                                                                                             | Solo `.env.example`                                                                                                                                                                               |
| Valores en `.env.example`                                                                                                                          | Todas las variables secretas vacías (`JWT_SECRET`, `OTP_HMAC_SECRET`, `RATE_LIMIT_HMAC_SECRET`, `TELEGRAM_*`, `LLM_API_KEY`, `S3_*`, `MINIO_ROOT_PASSWORD`, `POSTGRES_PASSWORD`, `METRICS_TOKEN`) |
| Patrones de claves en los archivos versionados (AWS `AKIA…`, claves privadas PEM, `sk-ant-…`, tokens de Slack y GitHub, tokens de bot de Telegram) | Ninguno                                                                                                                                                                                           |
| Validación al arrancar                                                                                                                             | `env.ts` (zod): longitud mínima de los secretos; en producción exige Telegram, HTTPS y S3; con `AI_ENABLED=true` exige el modelo, la clave y la versión del consentimiento                        |
| Logs                                                                                                                                               | Redacción de pino para `authorization`, `apiKey`, `x-api-key`, tokens, OTP, teléfono, IP, URL firmadas, `text`, `prompt` y `comment`; no hay `console.log` en `apps/api/src`                      |

## Cabeceras

`helmet@8.3.0` (MIT) en `configureHttp`, para todas las respuestas, incluidos los errores (probado en `test/security-headers.spec.ts`):

- **Respuestas de la API:**
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`: la API solo devuelve JSON.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
  - `X-Content-Type-Options: nosniff`.
  - `X-Frame-Options: SAMEORIGIN`.
  - `Referrer-Policy: no-referrer`.
  - `Cross-Origin-Opener-Policy: same-origin`.
  - Sin `X-Powered-By`.
- **`/docs` (Swagger, solo fuera de producción):** la CSP por defecto de helmet, para que la interfaz cargue sus scripts, y sin HSTS.
- **CORS:** lista explícita (`CORS_ALLOWED_ORIGINS`), sin comodines. El webhook de Telegram queda fuera de CORS.

## Límites

| Límite          | Valor                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuerpo JSON     | 64 KB, salvo `/sync/push`, que tiene `SYNC_PUSH_MAX_BODY_BYTES`                                                                                                                                             |
| Push de sync    | De 1 a 50 operaciones; el pull, hasta 500                                                                                                                                                                   |
| Límites de tasa | OTP por teléfono e IP (en base de datos). En memoria: búsqueda, propuestas, fotos, sync, pedidos, calificaciones, verificación, ubicación, recomendaciones, IA (por minuto y por día) y webhook de Telegram |
| Archivos        | Fotos y comprobantes con URL prefirmada de vida corta, tipo y tamaño validados; las fotos se recodifican a WebP                                                                                             |
| Consultas       | `lock_timeout` y `statement_timeout` por transacción; el timeout de la base responde 503                                                                                                                    |

Los límites en memoria son por proceso. Con varias instancias de la API se multiplican; está anotado como deuda.

## Dependencias

`pnpm audit --audit-level=high` no reporta ninguna vulnerabilidad alta ni crítica. Hay 3 moderadas, todas en dependencias de desarrollo y pruebas que no llegan a producción:

| Paquete                    | Aviso                                                                    | Por dónde llega                                              |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `glob` 10.5.0              | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | `@testcontainers/minio` → `testcontainers` → `archiver`      |
| `minimatch` 9.0.9 y 10.2.6 | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `@typescript-eslint/*` y la misma cadena de `testcontainers` |

Acción: Dependabot las actualizará cuando las dependencias directas publiquen versiones corregidas. Ninguna está en el paquete que se despliega.

Dependencias nuevas de esta fase: `helmet@8.3.0` (MIT, sin dependencias) y `eslint-import-resolver-typescript@4.4.5` (ISC, solo desarrollo).

## Autenticación y autorización

Ya cubiertas por pruebas en fases anteriores:

- JWT HS256 de 15 min, refresh rotativo por dispositivo con detección de reutilización y ventana de gracia de 30 s.
- RBAC por rol en cada caso de uso, y propiedad en la capa de aplicación: un tercero recibe 404.
- El webhook de Telegram verifica su secreto y es idempotente por `update_id`.
- `/metrics` exige un token y lo compara en tiempo constante.
- El personal (`operator`, `finance`, `admin`) solo se crea por CLI, y sus acciones quedan en `audit_log` con la IP como HMAC.

## Pendiente

- Revisión externa (pentest) antes de producción.
- Límites de tasa compartidos entre instancias, por ejemplo en PostgreSQL como los de OTP.
- Rotación de secretos documentada en la guía de despliegue, que llega en el PR D2.
