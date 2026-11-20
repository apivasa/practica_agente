# practica_agente

**App de control de capacidad por indicadores RUN** (versión académica del curso IA).

Las unidades de delivery manejan su capacidad con libertad, pero se controlan con indicadores de RUN (disponibilidad, MTTR, vulnerabilidades, observabilidad, etc.). Cada indicador tiene umbrales verde, amarillo y rojo. Según el color del mes y su historial, la app aplica candados sobre lo que la unidad puede hacer con su capacidad.

La construye un orquestador con cinco subagentes en modo autónomo (ver [`CLAUDE.md`](CLAUDE.md)).

## Estado actual (2026-11-19)

Lo que existe hoy en `main`:

- **Estructura del proyecto** (F-01): front Vite estático con una pantalla mínima de inicio, carpeta `supabase/` (sin migraciones todavía), `engine/`, `scripts/`, pruebas.
- **CI** (F-02): `ci.yml` corre lint, pruebas unitarias, build, pruebas de base de datos (pgTAP sobre Supabase local) y e2e (Playwright). `lockfile.yml` regenera `package-lock.json` cuando cambia `package.json`.
- **Motor de color** (M-01): funciones puras en `engine/` que validan un indicador genérico, calculan su valor en la ventana y devuelven su color.
- **Motor de escalada** (C-01): funciones puras en `engine/` que calculan el candado de una unidad (normal, restringido, congelado, excepción) y el arrastre del paquete de vulnerabilidades.

- **Salud del sistema** (V-04): `salud.yml` corre cada 6 h, revisa la web, Supabase y los workflows programados, y abre o actualiza un issue si algo falla. Ver [`docs/operacion.md`](docs/operacion.md).
- **Despliegue manual** (V-05): `deploy.yml` aplica migraciones y publica en GitHub Pages solo cuando el usuario lo dispara a mano. La app **todavía no está publicada**. Ver [`docs/despliegue.md`](docs/despliegue.md).

Todavía **no** existen: tablas en Supabase, login, pantallas por rol, captura de mediciones, cálculo programado, alertas ni publicación en GitHub Pages. Ver el orden de trabajo en [`docs/plan-maestro.md`](docs/plan-maestro.md).

## Requisitos

- **Node 22** o superior. Las pruebas unitarias usan opciones de `node --test` que no existen en Node 20 (ver [ADR 0002](docs/adr/0002-pruebas-node-test.md)). CI usa Node 22.
- Supabase CLI y Docker, solo para las pruebas de base de datos.

## Comandos

```bash
npm ci              # instala dependencias (usa package-lock.json)
npm run dev         # servidor de desarrollo Vite
npm run build       # genera dist/ (sitio estático para GitHub Pages)
npm run preview     # sirve dist/ en local
npm run lint        # ESLint
```

### Pruebas

```bash
npm run test:unit   # unitarias y de seguridad del motor (node:test) con cobertura
npm run test:e2e    # e2e con Playwright; antes: npm run build y npx playwright install chromium
npm run test:db     # pgTAP; antes: supabase db start (o supabase start)
```

`test:unit` ejecuta `tests/**/*.test.js` con el runner nativo de Node y muestra la cobertura de `engine/`. No necesita dependencias instaladas.

### Variables de build

Copia `.env.example` a `.env` y rellena `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (clave publicable `sb_publishable_...`). Nunca pongas la clave secreta en el front. Hoy el front todavía no se conecta a Supabase.

## Estructura del repo

```
engine/                 Lógica pura compartida por el front y las Actions
  indicator.js          Validación y valores por defecto de un indicador
  measure.js            Valor del indicador en su ventana
  color.js              Color verde / amarillo / rojo / sin evaluar
  escalation.js         Candados, color de la unidad y arrastre
  README.md             API del motor de color
  ESCALATION.md         API y tabla de verdad del motor de escalada
src/main.js             Front (pantalla mínima)
index.html              Entrada del front
supabase/               config.toml, migrations/ (vacía), seed.sql, tests/ (pgTAP)
scripts/                Scripts para las Actions (vacía)
tests/engine/           Pruebas unitarias del motor
tests/security/         Pruebas de seguridad del motor
tests/smoke.test.js     Prueba mínima del front
e2e/                    Pruebas Playwright
.github/workflows/      ci.yml, lockfile.yml
docs/                   Diseño, plan, ADR, informes y guías
```

## Documentación

- Diseño: [`docs/diseno.md`](docs/diseno.md)
- Cómo se configura un indicador y cómo funcionan los candados: [`docs/indicadores.md`](docs/indicadores.md)
- API del motor: [`engine/README.md`](engine/README.md) y [`engine/ESCALATION.md`](engine/ESCALATION.md)
- Decisiones técnicas: [`docs/adr/`](docs/adr/)
- Seguridad: [`docs/seguridad/`](docs/seguridad/)
- Cambios por ítem: [`CHANGELOG.md`](CHANGELOG.md)
- Plan maestro: [`docs/plan-maestro.md`](docs/plan-maestro.md)
- Estado y log de ciclos: [`docs/estado.md`](docs/estado.md)
- Lo que necesita tu decisión: [`docs/pendientes-usuario.md`](docs/pendientes-usuario.md)
- Subagentes: [`.claude/agents/`](.claude/agents/)

Stack: GitHub Pages (front estático) · Supabase (BD, login, RLS) · GitHub Actions (cálculo mensual, alertas, CI/CD).
