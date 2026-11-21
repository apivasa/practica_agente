# F-15 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. No hay endpoints, tablas, permisos ni workflows nuevos. El cambio endurece `assessDeploy` (check `deploy-main` de `salud.yml`, `scripts/health/lib.js`): el orden de los runs y el cálculo de `stuck` usan `parseApiTime`; un completado no omitido con `created_at` inválido o futuro da `fail`; un pendiente con fecha inválida se descarta. Corrige H-F14-01.

## Pruebas de seguridad añadidas

`tests/security/health-deploy-f15.test.js`: 16 casos, todos de la categoría 5 (automatizaciones). Corren con `node --test` y en CI en el job de pruebas de seguridad de `seguridad.yml`.

- **Completado con fecha inválida o futura (10 casos).**
  - Reproducción de H-F14-01 (success +10 h sobre dos failure) en 30 permutaciones: siempre `fail` y cita el run.
  - Para cada conclusión (`success`, `failure`, `cancelled`, `timed_out`, null) y 13 valores malos (null, vacío, espacios, número, `Date` en ms, objeto, arreglo, texto ilegible, +6 min, +10 h, +1 año) al inicio, en medio y al final: `fail`.
  - No queda oculto tras un pendiente que cubriría un fallo aislado ni tras un último cancelado (que daría `warn`).
  - Frontera del margen `FUTURE_SKEW_MIN`. Los omitidos (`skipped`/`neutral`) y los runs de otro evento con fecha mala no deciden.
- **Pendientes con fecha inválida (3 casos).** No cubren un fallo aislado (`created_at` o `run_started_at` malos), no convierten en `ok` una cadena de fallos y no tapan un atascado real con fechas válidas.
- **Orden y fuzz (2 casos).** El resultado no depende del orden de entrada (4 escenarios × 25 permutaciones). Fuzz determinista de 3000 listas: si el resultado es `ok`, no hay completados con fecha inválida y el completado válido más reciente es `success`.

Regresión local (`node --test`): `health-deploy-f15`, `health-deploy-f14`, `health-deploy-f13`, `health-deploy-v04b`, `tests/scripts/qa-v04b` y `tests/scripts/f15-fixes`: 164 casos, 0 fallos.

## Resultados del pipeline

Runs sobre `cedc123` (en curso al escribir este informe; el orquestador confirma antes del merge):

- Seguridad (gitleaks, semgrep, npm audit, ZAP baseline, pruebas `tests/security`, pentest RLS/API): https://github.com/apivasa/practica_agente/actions/runs/44903115931
- CI: https://github.com/apivasa/practica_agente/actions/runs/44903115977

Base anterior (`14e0496`): Seguridad y CI en `success`.

## Hallazgos

Intenté forzar un falso `ok`/`warn` con runs manipulados. H-F14-01 queda corregido para fechas futuras, nulas, vacías y de otro tipo, en cualquier orden. Quedan tres casos de severidad Baja/Info. Todos exigen que la API de GitHub devuelva datos que no genera (siempre manda ISO 8601 UTC con `Z`), así que no son explotables sin controlar la propia API:

- **H-F15-01 · Baja · 5 · `scripts/health/lib.js` (`parseApiTime`).** El comentario dice «texto ISO», pero solo se exige que sea string y lo lee `Date.parse`, que es permisivo. Un `failure` reciente con `created_at: '1'` o `'March 1 2001'` se lee como del año 2001, se ordena detrás de un `success` viejo y da `ok`. Repro: `assessDeploy(DEPLOY_RULE, { workflow: { state: 'active' }, runs: [{ event: 'push', status: 'completed', conclusion: 'failure', created_at: '1' }, { event: 'push', status: 'completed', conclusion: 'success', created_at: <ISO hace 2 h> }], now })` → `ok`. Corrección: exigir formato ISO 8601 con zona (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/`) antes de `Date.parse`. También aplica a `newerPendingRun`.
- **H-F15-02 · Info · 5 · `assessDeploy` (orden).** Si dos completados tienen el mismo `created_at`, el orden lo decide la entrada (sort estable): `[success, failure]` con la misma fecha da `ok`. Corrección: desempatar por `id` descendente (o por `run_number`).
- **H-F15-03 · Info · 5 · `assessDeploy` (`stuck`).** Un pendiente con `created_at` válido y antiguo pero `run_started_at` ilegible o futuro se descarta y no cuenta como atascado (antes de F-15 pasaba lo mismo con `Date.parse`, así que no es una regresión). Corrección opcional: si `run_started_at` es inválido y `created_at` es válido, medir la espera con `created_at`. Es compatible con qa-v04b, que solo cubre el caso en que ninguna fecha es válida.

## Verificado sin hallazgos

- 5 (automatizaciones): `salud.yml` sin permisos ni disparadores nuevos. Ningún run con fecha inválida o futura produce `ok`/`warn` (fuzz incluido).
- 6 (secretos): el diff no contiene literales con forma de clave o token.
- 1–4, 7, 8: el ítem no los toca. La regresión completa corre en `seguridad.yml`.
