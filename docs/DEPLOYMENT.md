# Despliegue, demo y copias de seguridad

## Perfiles (`APP_PROFILE`)

| Perfil                      | `NODE_ENV`               | Datos                       | Para qué                                                                      |
| --------------------------- | ------------------------ | --------------------------- | ----------------------------------------------------------------------------- |
| `development` (por defecto) | `development` o `test`   | Sintéticos (`pnpm db:seed`) | Trabajo local; Swagger en `/docs`                                             |
| `demo`                      | nunca `production`       | Solo sintéticos             | Mostrar el producto: OTP en el log de la API, sin Swagger y sin Telegram real |
| `production`                | `production` obligatorio | Reales                      | El piloto: exige Telegram, HTTPS, S3 y todos los secretos (`env.ts`)          |

La aplicación no arranca con `APP_PROFILE=production` sin `NODE_ENV=production`, ni con `APP_PROFILE=demo` y `NODE_ENV=production`. `db:seed` se niega fuera de `development` y `demo`.

## Demo local

```bash
pnpm demo:up      # construye la imagen, genera .env.demo con secretos aleatorios la primera vez,
                  # migra, siembra datos sintéticos, crea el bucket y su ciclo de vida, y arranca todo
pnpm demo:check   # salud y disponibilidad, puertos publicados, Swagger apagado, solo usuarios
                  # sintéticos, y una copia de seguridad restaurada con los mismos recuentos
pnpm demo:down    # detiene; DEMO_WIPE=1 pnpm demo:down también borra los volúmenes
```

- Corre como proyecto `tracop-demo` (`docker-compose.demo.yml`) y **nunca lee `.env`**: usa `.env.demo`, que `demo:up` genera con secretos aleatorios y permisos `600`, y que git ignora.
- **Solo se publican la API y el S3 público** en `DEMO_BIND` (por defecto `127.0.0.1`): la API en `DEMO_API_PORT` (3100) y el S3 en `DEMO_S3_PORT` (9100). PostgreSQL, el trabajador y la consola de MinIO quedan dentro de la red de compose.
- Los códigos OTP se leen con `docker compose -f docker-compose.demo.yml --env-file .env.demo logs api`.
- Usuarios sintéticos del seed: `+57300000000{01..07}`, uno por rol.

## Imagen

`Dockerfile` en dos etapas sobre `node:22.23.1-bookworm-slim`. Construye contracts y la API, y en ejecución corre como el usuario `node`, nunca como root. La imagen **no contiene secretos**: todo llega por el entorno. La misma imagen sirve para:

| Proceso     | Comando                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| API         | `node dist/main.js` (puerto 3000)                                                       |
| Trabajador  | `node dist/worker.js` (uno o más; latido en `shared.worker_heartbeats`)                 |
| Migraciones | `npx tsx drizzle/migrate.ts`, antes de cada versión, desde una base vacía o la anterior |

## Producción (lista de comprobación)

1. **PostgreSQL 16 gestionado**, con TLS. `DATABASE_URL` con un usuario sin permisos de superusuario.
2. **Secretos** en el gestor de secretos de la plataforma, nunca en el repositorio ni en la imagen:
   - `JWT_SECRET`, `OTP_HMAC_SECRET` y `RATE_LIMIT_HMAC_SECRET`, de 32 bytes o más;
   - `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET`;
   - las claves `S3_API_*` y `S3_POLICY_*`, con los permisos mínimos de `.env.example`;
   - `METRICS_TOKEN`;
   - `LLM_API_KEY`, solo si `AI_ENABLED=true`.
3. **Rotación de secretos:**
   - `JWT_SECRET` cierra todas las sesiones; hay que avisar antes.
   - `OTP_HMAC_SECRET` invalida los OTP en curso.
   - `RATE_LIMIT_HMAC_SECRET` reinicia los contadores e invalida los seudónimos de los registros expirados. Conviene rotarlo solo ante una filtración.
   - Las claves de S3 y de Telegram se rotan en su proveedor y luego se reinicia.
4. **Despliegue en orden:**
   1. Migrar: las migraciones van solo hacia adelante.
   2. Desplegar la API, que debe responder `GET /ready`.
   3. Desplegar el trabajador.
   4. `pnpm telegram:set-webhook`, que registra `message` y `callback_query`.
   5. `pnpm storage:configure-lifecycle`.
   6. `pnpm storage:configure-cors` si el S3 lo admite.
5. **Comprobaciones:**
   - el balanceador usa `GET /health` como comprobación de vida y `GET /ready` como disponibilidad;
   - Prometheus raspa `GET /metrics` con `Authorization: Bearer <METRICS_TOKEN>`.
6. **`TRUST_PROXY`** según el proxy de la plataforma, para que el límite por IP y el HMAC del audit log vean la IP real.

## Copias de seguridad

- **Programadas:** en la demo, el servicio `backup` ejecuta `scripts/backup/pg-backup.sh` al arrancar y cada `BACKUP_INTERVAL_SECONDS` (86 400 s). El script hace `pg_dump --format=custom` y escribe en `./backups`, conservando las `BACKUP_KEEP` (7) copias más recientes. En producción, el mismo script se ejecuta desde un cron de la plataforma con las variables `PG*`, y las copias se guardan **fuera** del servidor de base de datos, en un bucket privado con cifrado y su propia retención. Si el PostgreSQL gestionado tiene copias del proveedor, este volcado lógico es la copia independiente.
- **Prueba de restauración:**
  - `pnpm backup:restore-check <archivo.dump>` restaura la copia en un PostgreSQL 16 desechable y muestra los recuentos; con `SOURCE_COUNTS`, falla si no coinciden con el origen.
  - `pnpm demo:check` lo hace con una copia recién tomada.
  - En CI, `test/backup-restore.spec.ts` restaura un volcado de la base migrada y comprueba las migraciones, los datos, que la secuencia de `server_seq` continúa y que los triggers append-only siguen activos.
- **Recuperación:**
  1. Detener la API y el trabajador.
  2. `pg_restore --no-owner --exit-on-error -d <base vacía> <archivo.dump>`.
  3. `npx tsx drizzle/migrate.ts`, que no aplica nada si la copia ya es de esa versión.
  4. Arrancar.
  5. Comprobar `GET /ready`.

  Las operaciones de sync posteriores a la copia se pierden; los clientes las reenvían desde su outbox, y la idempotencia por `opId` evita duplicados.

## NO verificado

- El despliegue en una plataforma real: PostgreSQL gestionado, balanceador, gestor de secretos y S3 de producción.
- El cron de copias en producción y la copia fuera del servidor.
