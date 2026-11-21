# V-04b — Informe QA
Veredicto: VERDE

Rama `item/V-04b` (commit 7d6b056). Revisado contra el ítem de `docs/plan-maestro.md` (H-ARQ-V05b-02) y el criterio del orquestador.

## Criterio de aceptación
| Punto | Estado | Evidencia |
|---|---|---|
| Vigila el último run de `Despliegue` (deploy.yml) en main | cumplido | `checkDeploy` pide `deploy.yml/runs?branch=main&per_page=20` sin filtro de evento; respeta `DEFAULT_BRANCH`; `runAll` y `check.js --only=workflows` lo incluyen una vez |
| Último completado en failure → falla con enlace | cumplido | failure, timed_out, startup_failure, action_required fallan con `html_url`; el más reciente se decide por `created_at`, no por el orden del arreglo |
| Más de 60 min en queued/in_progress → falla con enlace | cumplido | 60 min exactos pasa; 60 min + 1 s falla; sin `run_started_at` usa `created_at`; una re-ejecución con `run_started_at` reciente no cuenta como atascada; fechas inválidas no lanzan |
| Sin runs o success → pasa | cumplido | `runs` vacío o `undefined`, o solo eventos ajenos: ok; failure seguido de success: ok |
| Cancelled solo → warning sin fallar | cumplido | `warn`, `::warning::aviso deploy-main`, código 0, `failures=` vacío, fila `warn` en el resumen |
| Eventos schedule / pull_request / workflow_run ignorados | cumplido | también cuando están atascados |
| Error de API | cumplido | error de red, HTTP 403/500 y 404 de deploy.yml → `deploy-main` falla sin lanzar y sin el token en el detalle |
| qa-v04 y health.test.js siguen pasando | cumplido | 59/59 |

Decisiones del desarrollador, juzgadas:
- **Cancelado tras un fallo sigue fallando**: correcta. Cancelar no repara producción; si no, una cancelación taparía un despliegue roto. Probado también con varios cancelados seguidos.
- **`waiting` > 60 min falla**: aceptable. Ver H-QA-V04b-02.
- **Solo 20 runs**: suficiente. Con 20 cancelados seguidos tras un failure, el failure queda fuera de la ventana y el resultado baja a `warn`. Es improbable (`cancel-in-progress: false`) y deja visible una advertencia de todos modos.

## Pruebas añadidas
- `tests/scripts/qa-v04b.test.js`: 32 casos (umbral de 60 min, `run_started_at`, eventos y orden, conclusiones, API simulada, código de salida de check.js, que el token no aparezca en logs).

## Resultado local
`node --test 'tests/**/*.test.js'`: 1811 pruebas, 1808 pasan, 0 fallan (2 skipped y 1 todo, que ya existían). Las pruebas no necesitan red ni Supabase. El CI de la rama corre tras el push.

## Cobertura
- `engine/`: 100 % de líneas en todos los archivos menos `commitment.js` (99,35 %). El ítem no toca `engine/`.
- `scripts/health/lib.js`: 99,17 % de líneas (sin cubrir: `defaultSleep`, 77-79).

## Hallazgos
- **H-QA-V04b-01 (baja, documentación).** La tabla de checks y la lista «Qué hacer si falla» de `docs/operacion.md` § «Salud del sistema» no mencionan `deploy-main`. Tampoco el comentario de cabecera de `.github/workflows/salud.yml`. Para reproducirlo: `grep -n deploy-main docs/operacion.md .github/workflows/salud.yml` no encuentra nada. Corresponde al documentador o al arquitecto-SRE (dueño de `salud.yml`). No bloquea.
- **H-QA-V04b-02 (baja, operación).** `deploy.yml` usa el environment `produccion`. Si se configuran revisores obligatorios, un despliegue que espera aprobación más de 60 min queda en `waiting` y abre el issue `salud`. Es coherente con la decisión, pero conviene anotarlo en el runbook (aprobar o cancelar el run). No bloquea.
