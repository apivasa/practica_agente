# Despliegue a producción (V-05)

Workflow: `.github/workflows/deploy.yml` (nombre en Actions: **Despliegue**).
Destino: Supabase del proyecto de P-02 (migraciones) y GitHub Pages (`https://apivasa.github.io/practica_agente/`).

**Estado (2026-11-20).** Primer despliegue hecho (run 44838844787): migraciones aplicadas y sitio publicado. Pentest fase B en modo `anonimo` en VERDE (S-05b, run 44839422473), sin hallazgos altos ni críticos. Las evaluaciones programadas siguen apagadas hasta P-05. La fase B en modo `roles` está pendiente.
Decisiones: ADR 0015 (manual primero, orden de jobs, Auth fuera de `db push`).

El primer despliegue a producción es **compuerta del usuario** (CLAUDE.md §3). El workflow solo se dispara a mano y exige escribir `desplegar`.

## Requisitos previos (una sola vez, los hace el usuario)

1. **Secretos** (P-02), en el environment `produccion` (recomendado, H-C03-02) o en los secretos del repositorio:
   `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.
   `deploy.yml` usa cinco de ellos. `SUPABASE_SECRET_KEY` no la lee ningún job del despliegue (H-S05-06): la usan solo `evaluacion-mensual.yml` y `ritmo-diario.yml`, que ya declaran `environment: produccion`.
   `SUPABASE_URL` debe ser exactamente `PRODUCTION_SUPABASE_ORIGIN` de `src/security/csp.js` (ADR 0011); si no, `verify` falla antes de migrar.
2. **Environment `produccion`** (Settings → Environments): regla de ramas de despliegue = `main`, **sin revisor requerido**, con los 6 secretos del punto 1. Lo usan también los crons de evaluación (`evaluacion-mensual.yml` y `ritmo-diario.yml`): con revisor, cada run programado quedaría esperando aprobación y los candados y las alertas dejarían de ser automáticos (ADR 0015 punto 6).
   Borra los secretos de repositorio **solo después** de una corrida manual de `ritmo-diario` (Actions → *Run workflow*) que ejecute el paso «Evaluar». Así compruebas que el environment entrega los secretos.
3. **GitHub Pages** (P-03): Settings → Pages → Source = **GitHub Actions**. Esto crea el environment `github-pages`.
4. **Auth del proyecto Supabase** (H-S05-01). `supabase db push` aplica solo `supabase/migrations/`, no `supabase/config.toml`, y un proyecto nuevo trae el registro abierto. En el panel de Supabase:
   - Authentication → Sign In / Providers: desactivar **Allow new users to sign up** (las cuentas las crea la gestora). `verify` lo comprueba con `GET /auth/v1/settings` y falla si `disable_signup` no es `true`.
   - Authentication → URL Configuration: **Site URL** = `https://apivasa.github.io/practica_agente/` (y la misma en *Redirect URLs*).
   - Authentication → Providers → Email: contraseña mínima de **12** caracteres con complejidad (minúsculas, mayúsculas y dígitos) (H-S03-02).
   - Database → Extensions: desactivar **pg_graphql** si no se usa (la app usa solo PostgREST) (H-S05-03).
   No se usa `supabase config push`: llevaría al proyecto real los valores locales (por ejemplo `site_url = http://127.0.0.1:3000`).
5. **Respaldo** antes de cada despliegue con migraciones nuevas: ver `docs/operacion.md` › Restaurar (volcado lógico en el equipo del usuario, nunca en el repo).

## Qué hace el workflow

Orden: `verify` → `build-pages` → `migrate-plan` → `migrate` → `deploy-pages` → `smoke`. Lo barato y reversible falla antes de lo irreversible: si el build o la verificación de `dist/` fallan, la base no se toca.

| Job | Environment | Qué hace |
|---|---|---|
| `verify` | `produccion` | Falla si `confirm` no es `desplegar`, si la rama no es `main` o si falta algún secreto que usa (lista los nombres, nunca los valores). Comprueba el prefijo `sb_publishable_`, que `SUPABASE_URL` corresponde a `SUPABASE_PROJECT_REF` y que es el origen de producción de `src/security/csp.js`. Lee `GET $SUPABASE_URL/auth/v1/settings` con la clave publicable y falla si el registro está abierto. |
| `build-pages` | `produccion` | `npm ci --ignore-scripts`, build con la URL y la clave publicable. Verifica que la CSP de `dist/index.html` no contiene `127.0.0.1` ni `localhost` e incluye `upgrade-insecure-requests` (ADR 0011), y que `dist/` no contiene una clave `sb_secret_…` ni apunta a Supabase local. Sube el artefacto de Pages (aún no publica). |
| `migrate-plan` | `produccion` | `supabase link` y `supabase db push --dry-run`: deja en el log la lista de migraciones que se aplicarán. No cambia nada. |
| `migrate` | `produccion` | `supabase link`, otro dry-run (por si pasó tiempo desde el plan), `supabase db push` y `supabase migration list` como evidencia de lo aplicado. Nunca aplica `seed.sql` (H-F03-07). |
| `deploy-pages` | `github-pages` | Publica el artefacto cuando `build-pages` y `migrate` terminaron bien. Es el único job con `pages: write` e `id-token: write`. |
| `smoke` | — | GET a la URL publicada (hasta 6 intentos): exige HTTP 200 con el título `App de control de capacidad RUN` y HTTP 200 en el JS principal (`/practica_agente/assets/…js`), para detectar una `base` rota. |

Los jobs están encadenados: si falla uno, los siguientes no corren. El grupo de concurrencia `despliegue-produccion` impide dos despliegues a la vez.

## Puntos de parada

- **Fase 1 (hoy):** la parada es el disparo manual con `confirm` = `desplegar`. `produccion` no tiene revisor, así que los jobs corren seguidos. El dry-run de `migrate-plan` queda en el log como registro de lo que se aplicó; no hay tiempo práctico para cancelar entre `migrate-plan` y `migrate`.
- **Fase 2 (opcional):** si se quiere aprobar antes de `db push`, se crea un environment aparte, `produccion-migraciones`, con regla `main` y revisor. Solo lo declara `migrate` y lleva solo `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` y `SUPABASE_PROJECT_REF` (ADR 0015 punto 6). Hoy no existe.

## Primer despliegue (manual)

1. Cumplir los requisitos previos (en especial el punto 4: sin registro cerrado, `verify` falla).
2. Actions → **Despliegue** → *Run workflow*, rama `main`, `confirm` = `desplegar`.
   También por REST: `gh api -X POST repos/apivasa/practica_agente/actions/workflows/deploy.yml/dispatches -f ref=main -f inputs[confirm]=desplegar`.
3. Los jobs corren seguidos, sin aprobaciones por job. Revisa después en el log de `migrate-plan` la lista del dry-run y en el de `migrate` lo aplicado. La aprobación previa a `db push` queda para la fase 2 (`produccion-migraciones`, ver "Puntos de parada").

## Qué verificar después

- El job `smoke` en verde y la URL abre la pantalla de inicio de sesión.
- En el log de `migrate`, la salida de `supabase migration list`; o Supabase → Database → Migrations: todas las de `supabase/migrations/` aplicadas.
- Supabase → Authentication → Users: **sin** las cuentas de `seed.sql`.
- Registro cerrado: `verify` lo comprobó; a mano, `GET https://<ref>.supabase.co/auth/v1/settings` con la clave publicable devuelve `"disable_signup": true`.
- En el navegador (DevTools → Network): las peticiones van solo a `https://<ref>.supabase.co`.
- Después de validar, activar los workflows programados: variable de repositorio `EVALUATION_ENABLED = true` (P-05). Basta la fase B en modo `anonimo` en VERDE (ADR 0015, enmienda S-05b). Lista de pasos: `docs/operacion.md` › Activación de producción (P-05).
- Antes de dar de alta usuarios reales o anunciar la URL: fase B en modo `roles` en VERDE, Site URL, redirecciones y política de contraseñas en el panel de Supabase (H-S05-01), y sin copias de `SUPABASE_SECRET_KEY` a nivel de repositorio (H-C03-02).

## Despliegue continuo (después de la primera publicación aprobada)

En `deploy.yml`, descomentar `push: branches: [main]` y permitir `github.event_name == 'push'` en la comprobación de `confirm`. Condiciones previas en ADR 0015 punto 5. `deploy.yml` ya no lee `SUPABASE_SECRET_KEY`, así que la regla de `tests/security/workflows.test.js` que limita esa clave a workflows `schedule` / `workflow_dispatch` no se ve afectada.

## Cómo revertir

- **Front:** el workflow solo despliega desde `main`, así que no se relanza sobre un commit anterior; se hace `git revert` del commit problemático en `main` mediante PR y nuevo despliegue. Para retirar el sitio de inmediato: Settings → Pages → *Unpublish*.
- **Migraciones:** `db push` no tiene "deshacer". Se escribe una migración nueva que revierte el cambio (PR revisado) y se despliega. Si la reversión borra tablas o columnas con datos, es compuerta del usuario (CLAUDE.md §3). Ante un daño de datos, seguir `docs/operacion.md` › Restaurar: en el plan gratuito no hay que contar con los backups del panel; se usa el volcado lógico previo al despliegue.
- **Automatizaciones:** poner `EVALUATION_ENABLED` a `false` detiene la evaluación mensual y el ritmo diario.
