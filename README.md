# practica_agente

**App de control de capacidad por indicadores RUN** (versión académica del curso IA).

Las unidades de delivery manejan su capacidad con libertad, pero se controlan con indicadores de RUN (disponibilidad, MTTR, vulnerabilidades, observabilidad, etc.). Cada indicador tiene umbrales verde, amarillo y rojo. Según el color del mes y su historial, la app aplica candados sobre lo que la unidad puede hacer con su capacidad.

La construye un orquestador con cinco subagentes en modo autónomo (ver [`CLAUDE.md`](CLAUDE.md)).

## Estado actual (2026-11-19)

Lo que existe hoy en `main` y pasó CI:

- **Base de datos** (F-03, F-04, F-06): 9 tablas del diseño más `audit_log`, con RLS por rol, auditoría por trigger y datos semilla ficticios. Ver [`docs/modelo-datos.md`](docs/modelo-datos.md).
- **Login y rutas por rol** (F-05): correo y contraseña con Supabase Auth. Sin registro abierto. Cada rol llega a su pantalla.
- **Pantallas por rol:**
  - Gestora: alta y edición de indicadores (M-02), tablero de completitud por custodio (V-03) y metas mensuales de los indicadores de meta acumulada sin categorías, con "Proponer un tercio" (M-07).
  - Custodio: compromisos con umbral negociado (M-03) y captura manual o CSV de mediciones (M-04).
  - Comité: matriz unidad × indicador con alertas (V-02) y aprobación y revocación de excepciones (C-02).
  - Líder: sus indicadores, color, meta, ritmo, restricciones y alertas (V-01).
- **Motor** (`engine/`): color (M-01), escalada y excepciones (C-01, C-02), vulnerabilidades: paquete, ritmo y metas (M-05) y color mensual por criticidad, P0/P1 y P2/P3 (M-06).
- **Evaluación programada y alertas** (C-03, C-04): workflows mensual y diario. Hoy no hacen nada en producción: esperan el despliegue (ver "Workflows").
- **Seguridad** (S-01 a S-04): pipeline de seguridad, modelo de amenazas, pentest de API y RLS, CSP, anti-framing y DAST con ZAP.
- **Salud del sistema** (V-04): `salud.yml` corre cada 6 h, revisa la web, Supabase y los workflows programados, y abre o actualiza un issue si algo falla. Ver [`docs/operacion.md`](docs/operacion.md).
- **Despliegue manual** (V-05): `deploy.yml` aplica migraciones y publica en GitHub Pages solo cuando el usuario lo dispara a mano. La app **todavía no está publicada**. Ver [`docs/despliegue.md`](docs/despliegue.md).

Todavía **no** existen: la primera publicación en GitHub Pages y las migraciones en Supabase real (el usuario dispara `deploy.yml`), la fase B del pentest previo a producción (S-05, tras el primer despliegue), correo u otro canal externo de alertas (C-05, espera Q-04) y fuentes automáticas de mediciones (V-07, espera Q-02). Ver [`docs/plan-maestro.md`](docs/plan-maestro.md).

## Manuales por rol

- [Gestora de KPIs](docs/manual-gestora.md)
- [Custodio de indicador](docs/manual-custodio.md)
- [Comité de delivery](docs/manual-comite.md)
- [Líder de unidad](docs/manual-lider.md)
- [Cómo configurar indicadores, compromisos y mediciones](docs/indicadores.md)

## Requisitos

- **Node 22** o superior. Las pruebas unitarias usan opciones de `node --test` que no existen en Node 20 ([ADR 0002](docs/adr/0002-pruebas-node-test.md)).
- **Supabase CLI** (CI fija la 3.2.0) y **Docker**, para la base local, las pruebas de BD, e2e e integración.

## Correr en local

```bash
npm ci                                  # instala dependencias (usa package-lock.json)
supabase start                          # Postgres, Auth y API locales; aplica migraciones y supabase/seed.sql
supabase status -o env                  # muestra API_URL y PUBLISHABLE_KEY
```

Crea `.env` a partir de `.env.example`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321        # API_URL de supabase status
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... # PUBLISHABLE_KEY de supabase status
```

Nunca pongas la clave secreta (`sb_secret_...`) en una variable `VITE_*`: termina en el navegador.

```bash
npm run dev     # http://localhost:5173/practica_agente/
```

Usuarios de la semilla (solo local). Contraseña de todos: `Local-Only-Pass-2026`.

| Correo | Rol |
|---|---|
| `gestora@example.test` | Gestora de KPIs |
| `custodio1@example.test` | Custodio de VULN |
| `custodio2@example.test` | Custodio de AVAIL, MTTR y OBS |
| `custodio3@example.test` | Custodio de CHG (inactivo) |
| `comite@example.test` | Comité de delivery |
| `lider1@example.test` / `lider2` / `lider3` | Líder de Unidad Alfa / Beta / Gamma |
| `multirol@example.test` | Gestora y custodio de LAT (inactivo) |
| `sinrol@example.test` | Sin rol (ve "Sin acceso") |

La semilla trae mediciones de enero y febrero de 2027, pero no evaluaciones. Para ver colores y alertas en los tableros, corre la misma evaluación que usa CI:

```bash
bash scripts/ci/seed-evaluations.sh     # cierra 2027-01 y 2027-02 y corre el ritmo del 2027-02-10
```

El script solo acepta Supabase local (`127.0.0.1` o `localhost`).

Para volver a la semilla limpia: `supabase db reset`.

## Comandos

```bash
npm run dev         # servidor de desarrollo Vite (sin CSP)
npm run build       # genera dist/ con la CSP inyectada; falla si VITE_SUPABASE_URL no es local ni el proyecto del repo
npm run preview     # sirve dist/ en local (puerto 4173)
npm run lint        # ESLint
```

### Pruebas

| Tipo | Comando | Necesita |
|---|---|---|
| Unitarias (motor, front, scripts, seguridad estática) | `npm run test:unit` | Nada. Muestra cobertura. |
| Base de datos (pgTAP: esquema, RLS por rol, auditoría, privilegios) | `npm run test:db` | `supabase db start` o `supabase start` |
| e2e (Playwright, una prueba por pantalla) | `npm run build && npm run test:e2e` | `supabase start`, `.env` local, `bash scripts/ci/seed-evaluations.sh` y `npx playwright install chromium` |
| Integración de la evaluación | `bash scripts/ci/integration.sh` | `supabase start` y `psql` |
| Seguridad estática | `node --test 'tests/security/*.test.js'` | `npm run build` antes, para revisar `dist/` |
| Pentest de API (PostgREST y Auth) | `node --test --test-concurrency=1 'tests/security/api/*.test.js'` | `supabase start` y las variables `PENTEST_*` (ver `seguridad.yml`). Sin ellas se omiten. |
| e2e de seguridad (XSS, CSV, CSP, framing) | `npx playwright test e2e/security` | Igual que e2e |

Las pruebas de `tests/security/api/` se omiten en `test:unit` a propósito. En CI corren en el job `pentest-api`.

## Workflows

| Workflow | Cuándo corre | Qué hace |
|---|---|---|
| `ci.yml` | PR; push a `main`, `item/**`, `fix/**`; manual | `build`: lint, unitarias y build. `db`: pgTAP sobre Postgres local. `integration`: corre `evaluate.js` mensual y diario dos veces contra Supabase local y verifica que no duplica. `e2e`: Supabase local, evalúa la semilla, build y Playwright. |
| `seguridad.yml` | PR; push a `main`, `item/**`, `fix/**`, `ensayo/**`; lunes 01:17 Guayaquil; manual | gitleaks, semgrep, `npm audit`, CodeQL, pruebas de seguridad, pentest de API contra Supabase local y DAST (e2e de seguridad y ZAP baseline). |
| `evaluacion-mensual.yml` | Día 1 de cada mes, 06:07 Guayaquil; manual con `as_of` y `reprocess` | Cierra el mes anterior: colores, candados, auditoría y alertas `color_change` y de excepciones. |
| `ritmo-diario.yml` | Cada día, 06:23 Guayaquil; manual con `as_of` | Ritmo de vulnerabilidades, ingreso de P0/P1 y vencimiento de excepciones. Genera alertas. |
| `salud.yml` | Cada 6 h (00:41, 06:41, 12:41 y 18:41 UTC); manual | Comprueba Pages, Supabase, los workflows programados y CI de `main`. Si algo falla, abre o comenta un issue con la etiqueta `salud`. Sin producción activa, los checks de Pages y Supabase salen como omitidos. |
| `deploy.yml` | Solo manual, desde `main`, con `confirm` = `desplegar` | `verify`, `build-pages`, `migrate-plan`, `migrate`, `deploy-pages` y `smoke`. Ver [`docs/despliegue.md`](docs/despliegue.md). |
| `lockfile.yml` | Push a `item/**` o `fix/**` que cambie `package.json`; manual (nunca en `main`) | Regenera y sube `package-lock.json` y relanza CI y Seguridad. |

Los dos workflows de evaluación solo actúan si existen los secretos `SUPABASE_URL` y `SUPABASE_SECRET_KEY` y la variable de repositorio `EVALUATION_ENABLED=true`. Si falta algo, terminan en verde con un aviso y no escriben nada. Detalle, reprocesos y qué hacer si fallan: [`docs/operacion.md`](docs/operacion.md).

## Estructura del repo

```
engine/                 Lógica pura compartida por el front y las Actions
  indicator.js          Validación de un indicador (7 atributos)
  measure.js, color.js  Valor en la ventana y color
  escalation.js         Candados, color de la unidad y arrastre
  exceptions.js         Vigencia, tope de 90 días y validación de excepciones
  commitment.js         Compromisos y umbral efectivo
  measurements-input.js Validación de mediciones y parser CSV
  vulnerabilities.js    Paquete trimestral, ritmo y metas mensuales
  rows.js, calendar.js  Filas de la BD -> entradas del motor; meses y trimestres
  dates.js              Fecha de negocio (America/Guayaquil)
src/
  main.js               Arranque, sesión y mapa de vistas
  lib/                  Rutas (route-logic.js), sesión, formularios y lógica de tableros (sin DOM)
  data/                 Único acceso a Supabase (una función por consulta)
  views/<rol>/          Una pantalla por archivo
  security/             CSP y anti-framing
supabase/
  migrations/           Esquema, RLS, auditoría, endurecimiento, alertas y excepciones
  seed.sql              Datos ficticios para local y CI
  tests/                pgTAP (y tests/security/)
scripts/
  evaluate.js           Evaluación mensual o diaria (Actions)
  lib/                  Lectura de BD, armado de entradas, alertas y escritura
  ci/                   integration.sh, seed-evaluations.sh, verify-evaluate.sql
tests/                  node:test: engine/, front/, scripts/, security/ (y security/api/)
e2e/                    Playwright por pantalla; e2e/security/
.github/workflows/      ci, seguridad, evaluacion-mensual, ritmo-diario, salud, deploy, lockfile
docs/                   Diseño, plan, ADR, manuales, modelo de datos, operación, seguridad
```

## Documentación

- Diseño: [`docs/diseno.md`](docs/diseno.md)
- Modelo de datos y RLS: [`docs/modelo-datos.md`](docs/modelo-datos.md)
- Indicadores, compromisos, CSV y candados: [`docs/indicadores.md`](docs/indicadores.md)
- API del motor: [`engine/README.md`](engine/README.md) y [`engine/ESCALATION.md`](engine/ESCALATION.md)
- Operación y runbook: [`docs/operacion.md`](docs/operacion.md)
- Despliegue a producción: [`docs/despliegue.md`](docs/despliegue.md)
- Decisiones técnicas: [`docs/adr/`](docs/adr/)
- Seguridad: [`docs/seguridad/`](docs/seguridad/)
- Cambios por ítem: [`CHANGELOG.md`](CHANGELOG.md)
- Plan maestro: [`docs/plan-maestro.md`](docs/plan-maestro.md)
- Estado y log de ciclos: [`docs/estado.md`](docs/estado.md)
- Lo que necesita tu decisión: [`docs/pendientes-usuario.md`](docs/pendientes-usuario.md)
- Subagentes: [`.claude/agents/`](.claude/agents/)

Stack: GitHub Pages (front estático) · Supabase (BD, login, RLS) · GitHub Actions (cálculo mensual, alertas, CI/CD).
