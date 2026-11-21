# V-05b — Informe QA

Veredicto: **ROJO** (re-revisión V-05b + V-05c, 2026-11-21; la revisión inicial de abajo fue VERDE)

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

---

## Re-revisión 2026-11-21: V-05c e integración de main

Veredicto: **ROJO**

Rama `item/V-05b` en 86b447c. Incluye V-05c (`scripts/ci/wait-ci.sh`, `{ set +x; }` en `scripts/ci/db-url.sh`), la integración de main (b267345: V-07, C-05, grants) y H-ARQ-V04b-02 (f708741). A main solo le falta 010877b, que es un latido de docs.

### Criterio de aceptación

| Punto | Estado | Evidencia |
|---|---|---|
| V-05c: en push, `verify` espera al CI del mismo SHA y exige success | Cumplido (bash) | Es el último paso de `verify` y bloquea build, migraciones y Pages. Consulta `head_sha`, `event=push` y `branch=main` y toma el run de `ci.yml` con el id mayor. Si la conclusión es `failure`, `cancelled`, `timed_out` o `null`, falla. También falla si el run no aparece o no termina antes del tope. Con dispatch no espera. |
| V-05c: `actions: read`, tope 20 min | Cumplido | `verify` tiene `contents: read` y `actions: read`, sin permisos de escritura. El tope por defecto es 1200 s y el `timeout-minutes` del job es 25. En main, CI tarda 3-5 min. |
| V-05c: `{ set +x; }` en `supabase_db_url` | Cumplido | Es la primera instrucción. Con `set -x` en el paso, la traza no muestra ni la contraseña ni la URL (prueba del desarrollador, verificada). |
| V-05b: un merge a main despliega | **No cumplido en el flujo real** | Ver H-QA-V05c-01. |
| V-05b: dispatch con confirm, `--db-url` sin token, contraseña ≥ 12 | Cumplido | Sin cambios desde la revisión inicial. Las pruebas siguen en verde. |
| Docs en fase 2 (H-QA-V05b-02) | Cerrado | `docs/despliegue.md` documenta el push a main y `SUPABASE_DB_POOLER_HOST`. La prueba `todo` de `qa-v05b.test.js` pasa a ser una prueba normal. |

### Pruebas añadidas o modificadas

- `tests/workflows/qa-v05c.test.js` (nuevo, 6 casos):
  - `ci.yml` corre en todo push a main sin filtro de rutas, así que cada despliegue por push tiene un CI de su SHA que esperar. Pasa.
  - El CI de un merge a main no se cancela cuando llega el commit siguiente (concurrencia de `ci.yml`). **Falla**: es H-QA-V05c-01.
  - Bordes de `wait-ci.sh`: rutas parecidas (`ci.yml-old`, `ci.yaml`) no cuentan como el CI; la ruta con sufijo `@ref` sí cuenta; `completed` con conclusión `null` no despliega; `cancelled` no despliega. Pasan.
- `tests/workflows/qa-v05b.test.js`: la prueba `todo` de docs pasa a ser una prueba normal.

### Resultado

- `node --test 'tests/**/*.test.js'` en local: 2370 pruebas, 2365 pasan, **1 falla** (H-QA-V05c-01), 2 omitidas, 2 `todo` (no son de este ítem).
- CI de la rama en 86b447c: CI y Seguridad en `success`, runs 44868418987 y 44868418993. El run de este push mostrará la falla de la prueba nueva.

### Cobertura engine/

99,97 % de líneas (96,44 % de ramas). Este ítem no cambia `engine/`.

### Hallazgos

- **H-QA-V05c-01 · Alta · funcional, bloquea el merge.** Con V-05c, un merge a main normalmente no se despliega.
  - `ci.yml` tiene `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`. Cuando llega otro commit a main, se cancela el CI del commit anterior.
  - Después de cada merge, el orquestador sube un commit de docs (estado o latido) en menos de 4 minutos.
  - Ese commit cancela el CI del merge. `wait-ci.sh` falla con `cancelled`, `verify` queda en rojo y no se despliega.
  - El commit de docs no redespliega, porque `paths-ignore` de deploy.yml excluye `docs/**`. El código fusionado queda sin publicar, y `deploy-main` de salud.yml lo informa como **failure** (no como aviso, porque el run falla en lugar de cancelarse) y abre el issue `salud`.
  - El mensaje de `wait-ci.sh` («el despliegue de ese commit lo reemplaza») es falso cuando el commit siguiente solo toca docs.
  - Evidencia en main (API de Actions): los CI de los merges #52 (7b4579d), #50 (f0b7108) y #49 (4604747) terminaron `cancelled` por el commit de docs siguiente: 3 de los últimos 4 merges.
  - Cómo reproducir: `node --test tests/workflows/qa-v05c.test.js`, caso 2. En real: merge de un PR y push de un latido antes de que termine el CI del merge.
  - Corrección sugerida (desarrollador): que `ci.yml` no cancele en main, por ejemplo `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`. Así se mantiene la cancelación en las ramas `item/**`. La prueba acepta esa forma, `false`, o un grupo por `github.sha` o `github.run_id`.
  - Revisar también el texto del error de `wait-ci.sh` para el caso `cancelled`.
- **H-QA-V05c-02 · Baja · diagnóstico.** Si `gh api` devuelve siempre un error (por ejemplo, 403 por falta de `actions: read`), `wait-ci.sh` reintenta durante 20 min y termina con «No apareció ningún run de CI». Falla de forma segura, pero el mensaje apunta a la causa equivocada. Sugerencia: si el último intento fue un error de la API, indicarlo en el mensaje final.
- **Observación · Baja.** `wait-ci.sh` confía en el filtro `head_sha` del servidor y no vuelve a comprobar `.head_sha` en la respuesta. Con la API de GitHub es suficiente; volver a comprobarlo sería defensa en profundidad.
- H-QA-V05b-01 (variable del pooler): resuelto por P-07 según `docs/pendientes-usuario.md`. H-QA-V05b-03 (CLI real contra el pooler) sigue pendiente de la primera corrida en main.
