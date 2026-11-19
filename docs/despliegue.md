# Despliegue a producción (V-05)

Workflow: `.github/workflows/deploy.yml` (nombre en Actions: **Despliegue**).
Destino: Supabase del proyecto de P-02 (migraciones) y GitHub Pages (`https://apivasa.github.io/practica_agente/`).

El primer despliegue a producción es **compuerta del usuario** (CLAUDE.md §3). El workflow solo se dispara a mano y exige escribir `desplegar`.

## Requisitos previos (una sola vez, los hace el usuario)

1. **Secretos** (P-02), en el environment `produccion` (recomendado, H-C03-02) o en los secretos del repositorio:
   `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.
2. **Environment `produccion`** (Settings → Environments): regla de ramas de despliegue = `main`. Opcional: revisor requerido (el workflow pide la aprobación en cada job que usa el environment: `verify`, `migrate` y `build-pages`).
3. **GitHub Pages** (P-03): Settings → Pages → Source = **GitHub Actions**. Esto crea el environment `github-pages`.

## Qué hace el workflow

| Job | Environment | Qué hace |
|---|---|---|
| `verify` | `produccion` | Falla si `confirm` no es `desplegar`, si la rama no es `main` o si falta algún secreto (lista los nombres que faltan, nunca los valores). Comprueba los prefijos `sb_publishable_` / `sb_secret_` y que `SUPABASE_URL` corresponde a `SUPABASE_PROJECT_REF`. |
| `migrate` | `produccion` | `supabase link`, `supabase db push --dry-run` (muestra las migraciones que se aplicarán) y `supabase db push`. Nunca aplica `seed.sql` (H-F03-07). |
| `build-pages` | `produccion` | `npm ci --ignore-scripts`, build con la URL y la clave publicable. Verifica que la CSP de `dist/index.html` no contiene `127.0.0.1` ni `localhost` e incluye `upgrade-insecure-requests` (ADR 0011), y que `dist/` no contiene una clave `sb_secret_…` ni apunta a Supabase local. Sube el artefacto de Pages. |
| `deploy-pages` | `github-pages` | Publica el artefacto. Es el único job con `pages: write` e `id-token: write`. |
| `smoke` | — | GET a la URL publicada (hasta 6 intentos): espera HTTP 200 y el título `App de control de capacidad RUN`. |

Los jobs están encadenados: si falla uno, los siguientes no corren. El grupo de concurrencia `despliegue-produccion` impide dos despliegues a la vez.

## Primer despliegue (manual)

1. Actions → **Despliegue** → *Run workflow*, rama `main`, `confirm` = `desplegar`.
   También por REST: `gh api -X POST repos/apivasa/practica_agente/actions/workflows/deploy.yml/dispatches -f ref=main -f inputs[confirm]=desplegar`.
2. Aprueba los jobs si el environment tiene revisor.
3. En el log de `migrate`, revisa la lista del dry-run antes de que se aplique (si algo no cuadra, cancela el run: el dry-run va en un paso previo).

## Qué verificar después

- El job `smoke` en verde y la URL abre la pantalla de inicio de sesión.
- Supabase → Database → Migrations: todas las de `supabase/migrations/` aplicadas.
- Supabase → Authentication → Users: **sin** las cuentas de `seed.sql`.
- En el navegador (DevTools → Network): las peticiones van solo a `https://<ref>.supabase.co`.
- Después de validar, activar los workflows programados: variable de repositorio `EVALUATION_ENABLED = true`.

## Despliegue continuo (después de la primera publicación aprobada)

En `deploy.yml`, descomentar `push: branches: [main]` y permitir `github.event_name == 'push'` en la comprobación de `confirm`. Antes, seguridad debe revisar la regla de `tests/security/workflows.test.js` que limita `SUPABASE_SECRET_KEY` a workflows `schedule` / `workflow_dispatch` (la opción más simple: que `verify` deje de comprobar esa clave en el modo push).

## Cómo revertir

- **Front:** el workflow solo despliega desde `main`, así que no se relanza sobre un commit anterior; se hace `git revert` del commit problemático en `main` mediante PR y nuevo despliegue. Para retirar el sitio de inmediato: Settings → Pages → *Unpublish*.
- **Migraciones:** `db push` no tiene "deshacer". Se escribe una migración nueva que revierte el cambio (PR revisado) y se despliega. Si la reversión borra tablas o columnas con datos, es compuerta del usuario (CLAUDE.md §3). Ante un daño de datos, restaurar desde los backups del proyecto Supabase (Database → Backups).
- **Automatizaciones:** poner `EVALUATION_ENABLED` a `false` detiene la evaluación mensual y el ritmo diario.
