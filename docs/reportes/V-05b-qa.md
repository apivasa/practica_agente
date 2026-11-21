# V-05b — Informe QA

Veredicto: **VERDE**

Rama `item/V-05b` (commit del desarrollador ae7de7c). Fuentes del criterio: `docs/plan-maestro.md` (V-05b), ADR 0015 punto 5, H-V05-01 (`docs/reportes/V-05-seguridad.md`) y H-S03-02.

## Criterio de aceptación

| Punto | Estado | Evidencia |
|---|---|---|
| Un merge a main despliega sin input manual | Cumplido (estático y bash) | `on.push.branches: [main]`. `verify` exime de `confirm` solo cuando `GITHUB_EVENT_NAME = push`. `paths-ignore` no excluye `src/`, `engine/`, `supabase/`, `scripts/`, `index.html`, `package*.json`, `vite.config.js` ni el propio workflow; sí excluye los cambios que solo tocan `docs/**` o `*.md` (candado y latido). La prueba real es la primera corrida en `main` después del merge (ver H-QA-V05b-01). |
| El dispatch manual con confirm=desplegar sigue funcionando | Cumplido | `workflow_dispatch` con `confirm` obligatorio. Con `desplegar` pasa. `""`, `Desplegar`, `desplegar `, `si` y `desplegarr` se rechazan. Cualquier evento distinto de `push` (vacío, `Push`, `push `, `schedule`, `pull_request`, etc.) también exige `confirm`. |
| Pruebas de workflow actualizadas | Cumplido | Las 13 pruebas de `tests/workflows/deploy.test.js` que exigían el diseño de la fase 1 se adaptaron sin perder su intención, y se añadió `tests/workflows/qa-v05b.test.js`. |
| H-V05-01: `db push --db-url` sin token de cuenta | Cumplido | Ni `SUPABASE_ACCESS_TOKEN`, ni `sbp_`, ni `supabase link/login/projects`. Los 4 comandos de BD usan `--db-url "$SUPABASE_DB_URL"`. La CLI simulada recibe `postgresql://postgres.<ref>:<pass codificada>@<pooler>:5432/postgres`. |
| H-S03-02: contraseña mínima 12 con complejidad | Cumplido (local/CI) | En `[auth]`: `minimum_password_length = 12` y `password_requirements = "lower_upper_letters_digits"`, con `enable_signup` todavía en `false`. Las contraseñas de prueba que se envían a Auth cumplen la política. En producción la política se fija en el panel (P-06), porque `config.toml` no se aplica allí. |

## Pruebas añadidas o modificadas

- `tests/workflows/deploy.test.js`: ahora tiene 109 casos.
  - **Adaptadas, misma intención:**
    - disparadores: exactamente `push` y `workflow_dispatch`, sin PR, schedule ni workflow_run;
    - 4 secretos (`SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_PASSWORD`) más `vars.SUPABASE_DB_POOLER_HOST`;
    - fixture `GOOD` sin token y con host del pooler, en modo dispatch;
    - migrate-plan y migrate sin `link` ni token, y solo leen `secrets.SUPABASE_DB_PASSWORD` y `secrets.SUPABASE_PROJECT_REF`;
    - líneas exactas de dry-run, push real y `migration list` con `--db-url "$SUPABASE_DB_URL"`;
    - `--yes` solo en el push real de migrate;
    - destino remoto explícito: todo comando `supabase db|migration` lleva `--db-url` y ninguno lleva `--local`, `--linked`, `--password`, `-p`, `--include-seed`, `--include-all` ni `--debug`;
    - la documentación exige los 4 secretos en uso.
  - **Nuevas:**
    - `push` limitado a `branches: [main]` con solo `paths-ignore`;
    - grupo de concurrencia fijo y sin concurrencia por job;
    - ningún `env:` redefine `GITHUB_EVENT_NAME` ni `GITHUB_REF`;
    - sin `if:` en verify, build-pages, migrate-plan ni migrate;
    - push a main sin confirm pasa;
    - 7 nombres de evento distintos de `push` sin confirm se rechazan;
    - ramas distintas de main (incluida `refs/pull/1/merge`) se rechazan tanto en push como en dispatch;
    - falta cada secreto, también en push;
    - falta la variable del pooler;
    - 11 hosts del pooler maliciosos (sufijo, subdominio, puerto 6543, `@`, `#`, espacio, salto de línea, conexión directa `db.<ref>`, `.co`) se rechazan sin filtrar la contraseña;
    - se aceptan hosts reales de varias regiones;
    - no hay `postgres://` literal en el workflow;
    - orden `set -euo pipefail` → `. db-url.sh` → `supabase_db_url` → CLI en cada paso de BD;
    - ningún `echo`/`printf` imprime `SUPABASE_DB_PASSWORD` ni `SUPABASE_DB_URL`, y no hay `set -x`.
- `tests/workflows/qa-v05b.test.js` (nuevo, 43 casos, 1 de ellos `todo`):
  - semántica de `paths-ignore` con `path.matchesGlob`: 13 rutas de app, BD, build y workflow disparan el despliegue; 5 rutas de docs no lo disparan; un merge mixto sí despliega;
  - los 4 pasos de BD de migrate-plan y migrate se ejecutan en bash con la CLI `supabase` sustituida por un stub:
    - la URL que llega a la CLI tiene el host del pooler, puerto 5432 (modo sesión), usuario `postgres.<ref>` y la contraseña codificada que se decodifica a la original;
    - la contraseña en claro nunca sale, y la codificada sale solo en líneas `::add-mask::`;
    - con un host ajeno o sin contraseña, ref o host, el paso falla y la CLI **nunca se llama**;
    - el dry-run lleva `--dry-run` sin `--yes` y solo «Aplicar migraciones» lleva `--yes`;
    - si la CLI falla en el push real, el paso falla;
  - política de contraseñas en `[auth]`, con `enable_signup` todavía en `false`, y contraseñas de prueba compatibles;
  - `todo`: `docs/despliegue.md` debe documentar el push a main y `SUPABASE_DB_POOLER_HOST` (ver H-QA-V05b-02).

Verificación de que las pruebas detectan regresiones: se aplicaron 8 mutaciones sobre una copia del repo y las 8 fallaron.
- `src/**` en `paths-ignore`;
- exención de confirm para cualquier evento distinto de dispatch;
- `--yes` en el dry-run de migrate-plan;
- puerto 6543;
- URL impresa en lugar de enmascarada;
- `cancel-in-progress: true`;
- regex del host sin ancla final;
- `branches` con `item/**`.

## Resultado

- `node --test 'tests/**/*.test.js'` en local: 1854 pruebas, 1850 pasan, 0 fallan, 2 omitidas, 2 `todo` (una es la de docs de este ítem).
- CI de la rama: queda para el run de este push (las pruebas `node:test` no necesitan dependencias). El job `deploy.yml` solo corre en `main`, así que el camino `--db-url` contra el pooler real no se puede ejecutar antes del merge.

## Cobertura engine/

99,96 % de líneas (97,87 % de ramas), medida con `node --test --experimental-test-coverage --test-coverage-include='engine/**'`. Este ítem no cambia `engine/`.

## Hallazgos

- **H-QA-V05b-01 · Media · operación, antes del merge.**
  - El propio merge de V-05b dispara el primer despliegue por push, porque cambia `.github/workflows/deploy.yml`, `scripts/` y `supabase/config.toml`.
  - `verify` falla si no existe la variable `SUPABASE_DB_POOLER_HOST`, en el environment `produccion` o en el repositorio. Desde la sesión no se puede comprobar si existe: `GET .../actions/variables` y `.../environments/produccion/variables` devuelven 403 del proxy.
  - Falla de forma segura, antes de cualquier `db push`, pero deja `main` con el despliegue en rojo.
  - Cómo reproducir: merge sin la variable → run `push` de **Despliegue** → `verify` con el error «Falta la variable SUPABASE_DB_POOLER_HOST».
  - Acción del orquestador: antes del merge, pedir a la usuaria que cree la variable con el host de Supabase → Connect → Session pooler (para el proyecto us-east-2, del tipo `aws-N-us-east-2.pooler.supabase.com`).
- **H-QA-V05b-02 · Baja · documentación.** `docs/despliegue.md` sigue describiendo la fase 1: dice que el workflow «solo se dispara a mano», que usa `SUPABASE_ACCESS_TOKEN` y que `deploy.yml` usa cinco secretos. No menciona `SUPABASE_DB_POOLER_HOST` ni el push a main. Le corresponde al documentador (paso 8). Queda una prueba `todo` en `qa-v05b.test.js` para convertirla en prueba normal cuando se actualice.
- **H-QA-V05b-03 · Baja · validación pendiente de CI real.**
  - Que `supabase db push --db-url ... --dry-run|--yes` y `supabase migration list --db-url` funcionen con la CLI 3.2.0 contra el pooler de sesión solo se comprueba en el primer run en `main`. Aquí la CLI está simulada.
  - Si falla, lo hace en `migrate-plan` (dry-run), antes del push real.
  - Recomendación: tras el merge, revisar en el log que el dry-run lista migraciones y que el URL aparece como `***`.
- **Observación · Baja.**
  - `paths-ignore: '**/*.md'` también ignora cambios que solo toquen `.md` dentro de `src/` o `public/`. Hoy no existen ni se publican, así que no afecta.
  - Cambios solo en `tests/**` sí despliegan: es inocuo, porque el despliegue es idempotente, pero gasta un run.
- **Observación · Baja.** La URL con la contraseña viaja como argumento de la CLI (`--db-url`), así que es visible en la lista de procesos del runner. El runner es efímero y la URL está enmascarada en el log: aceptable. Se deja anotado para seguridad.
