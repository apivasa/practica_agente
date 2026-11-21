# F-16 — Informe QA
Veredicto: VERDE

Rama `item/F-16` (SHA revisado `80c8d16`). Alcance: `scripts/health/lib.js` (`parseApiTime`, `API_TIME_RE`, `assessDeploy`, `newerPendingRun`).

## Criterio de aceptación (plan-maestro, fila 28h)
| Punto | Estado | Evidencia (qa-f16) |
|---|---|---|
| H-F15-01: `parseApiTime` exige ISO 8601 con zona | cumplido | acepta `Z`, `-05:00`, fracción; rechaza `'1'`, `'March 1 2001'`, solo fecha, sin zona, espacio en vez de `T`, sin segundos, `+0500`, espacios alrededor, basura delante o detrás, mes 13, vacío y no-strings; el margen `FUTURE_SKEW_MIN` se mantiene |
| H-F15-01 también en `newerPendingRun` | cumplido | pendiente con `created_at` no ISO no cubre; fallo con `created_at` no ISO da `null`; `run_started_at` no ISO no cubre |
| H-F15-02: desempate por `id` con el mismo `created_at` | cumplido | repro `[success 1, failure 2]` → `fail`; resultado igual con cualquier orden de entrada; `[failure 1, success 2]` → `ok`; cancelado con id mayor sobre failure → `fail`; la fecha manda sobre el id; cadena de fallos empatada no da `warn` |
| H-F15-03 / QA-F15-01: atasco medido con `created_at` si `run_started_at` es ilegible o futuro | cumplido | futuro, ilegible, sin zona, número, vacío y `null` → `fail` con «200 min en in_progress»; borde `maxPendingMin` exacto no, +1 min sí; con `run_started_at` válido sigue mandando él |
| Sigue sin cubrir un fallo | cumplido | failure aislado + pendiente reciente con `run_started_at` ilegible → `fail`, sin «lo cubre» (control con fecha válida → `warn`) |
| Compatible con qa-v04b (`created_at` inválido se descarta) | cumplido | `created_at` inválido con `run_started_at` viejo válido → no atasca; ambas inválidas → `ok` |

## Pruebas del desarrollador
`git diff origin/main...origin/item/F-16 --stat`: solo `scripts/health/lib.js`, `tests/scripts/f15-fixes.test.js` (propia del desarrollador) y `tests/scripts/f16-fixes.test.js` (nueva). No se tocaron pruebas de QA (`qa-*`) ni de seguridad (`tests/security/`). Las dos aserciones cambiadas en `f15-fixes` fijaban el comportamiento que H-F15-03 pide cambiar (antes `ok`, ahora `fail`) y se añadió un control con `created_at` reciente (`ok`). Correcto.

## Pruebas añadidas
- `tests/scripts/qa-f16.test.js`: 39 casos (23 de H-F15-01, 6 de H-F15-02, 10 de H-F15-03).

## Resultado local
- `node --test tests/scripts/qa-f16.test.js`: 39 pass, 0 fail.
- `node --test tests/scripts/*.test.js`: 729 pruebas, 728 pass, 0 fail, 1 TODO previo (H-C04-QA-01, ajeno).
- CI de la rama: el run de `80c8d16` (Seguridad) en verde; CI y Seguridad de los commits de revisores en curso al cerrar este informe. El orquestador lo confirma antes del merge.

## Cobertura
- `engine/` (no tocado por F-16): 99,60 % de líneas con `tests/engine`, `tests/front` y `tests/scripts` (meta ≥ 95 % cumplida).

## Hallazgos
- **QA-F16-01 (info)**: `API_TIME_RE` valida la forma, no el calendario; `Date.parse('2027-02-30T00:00:00Z')` se lee como 2 de marzo y `T24:00:00Z` como el día siguiente. La API de GitHub no produce esas fechas y el límite de futuro sigue aplicándose, así que no hay impacto práctico. No bloquea.
- **QA-F16-02 (info)**: `compareIdDesc` devuelve empate si a uno de los dos le falta un id entero. Si se mezclan runs con y sin id y la misma fecha, el comparador no es transitivo y el orden depende del motor. La API siempre da un `id` entero, así que no hay impacto práctico. No bloquea.
