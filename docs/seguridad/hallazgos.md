# Hallazgos de seguridad (medios y bajos)

Registro de hallazgos que no bloquean el merge. Cada uno se propone como ítem o se asigna a un ítem `S-xx` existente.

| ID | Origen | Severidad | Categoría | Ubicación | Descripción | Corrección sugerida | Ítem propuesto | Estado |
|---|---|---|---|---|---|---|---|---|
| H-001 | F-01+F-02 | Media | 5 · Actions | `.github/workflows/ci.yml`, `lockfile.yml` (`uses:`) | Acciones de terceros fijadas por etiqueta móvil (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `supabase/setup-cli@v1`), no por SHA de commit. Una etiqueta re-apuntada ejecutaría código ajeno con `contents: write` en `lockfile.yml`. No se pudieron consultar los SHA (la API de GitHub devolvió 403 para repos externos en esta sesión). | Fijar cada `uses:` por SHA completo con comentario de versión (`@<sha> # v4.x.y`) y activar Dependabot para `github-actions`. | S-01 | Abierto |
| H-002 | F-01+F-02 | Baja | 5 · Actions | `.github/workflows/ci.yml` job `db` | `supabase/setup-cli` con `version: latest`: la versión de la CLI cambia sin revisión. | Fijar una versión concreta de la CLI y actualizarla vía Dependabot/PR. | S-01 | Abierto |
| H-003 | F-01+F-02 | Baja | 5 · Actions | `.github/workflows/lockfile.yml` `on.push` | El workflow con `contents: write` y `actions: write` corre en push a **cualquier** rama, incluida `main`, y empuja commits con `GITHUB_TOKEN`. No es explotable desde forks (los forks no disparan `push` en este repo y `pull_request` no está en sus disparadores), pero amplía el radio de un push con `package.json` alterado. | Limitar `on.push.branches` a `['item/**', 'fix/**']` y mover los permisos de escritura al nivel de job. | S-01 | Abierto |
| H-004 | F-01+F-02 | Baja | 6 · Cadena de suministro | `ci.yml` (`npm ci` / `npm install`) | La instalación en CI ejecuta scripts de ciclo de vida (en el lockfile actual: `esbuild` y `fsevents`, legítimos). Un paquete comprometido ejecutaría código en CI (con token de solo lectura). | Usar `npm ci --ignore-scripts` y, si hace falta, `npm rebuild esbuild` explícito; añadir `npm audit --omit=dev` y revisión de paquetes nuevos en `seguridad.yml`. | S-01 | Abierto |
| H-005 | F-01+F-02 | Baja | 5 · Actions | `ci.yml`, `lockfile.yml` (`actions/checkout`) | `persist-credentials` por defecto (`true`) deja el token en `.git/config` durante todo el job, accesible a scripts de npm. En `ci.yml` no es necesario. | `with: persist-credentials: false` en `ci.yml`; en `lockfile.yml` mantenerlo solo si se usa para el push. | S-01 | Abierto |
| H-006 | F-01+F-02 | Media | 4 · Front estático | `index.html` | Sin Content Security Policy ni script anti-framing (esperado en esta fase; GitHub Pages no admite cabeceras). | Implementar la meta CSP propuesta en `docs/reportes/F-01-F-02-seguridad.md` y el anti-framing. | S-04 | Abierto |

## Motor de color (M-01)

| ID | Ítem | Severidad | Categoría | Ubicación | Resumen | Corrección sugerida | Estado |
|---|---|---|---|---|---|---|---|
| H-M01-01 | M-01 | Baja | 3 Entradas | `engine/color.js:19,27` | `sampleSize` no se valida: `NaN`, `'x'` o negativo hacen falsa la comparación `sampleSize < minSample` y se evalúa color en vez de `not_evaluated`. Repro: `evaluateColor({...minSample:3}, {value:10, sampleSize:NaN})` → `red`. | Tratar `sampleSize` no entero ≥ 0 como error o como `not_evaluated`. | Corregido (M-01 intento 2) |
| H-M01-02 | M-01 | Baja | 3 Entradas | `engine/measure.js:83,111` | Sin límites de rango: sumas que desbordan (`1e308`×2) dan `value: Infinity` y `evaluateColor` lanza (un custodio puede romper la evaluación de un indicador); valores negativos se aceptan (`cumulative_target` = -5000 %). | CHECK de rango en BD y validación en CSV/formulario; en Actions, capturar el error por indicador y registrarlo en auditoría; opcionalmente que `measure` devuelva error explícito si el resultado no es finito. | Parcial: `measure` neutraliza no finitos y negativos (M-01 intento 2); falta CHECK en BD y CSV (F-03, M-04) |
| H-M01-03 | M-01 | Baja | 3 Entradas | `engine/indicator.js:124-127` | Una categoría llamada `__proto__` (posible vía `JSON.parse`) pasa la validación pero se descarta en silencio: la asignación cambia el prototipo del objeto local (sin contaminación global) y la categoría usa los umbrales generales. | Construir `byCategory` con `Object.create(null)` o `Map`, o rechazar claves reservadas en `validateIndicator`. | Corregido (M-01 intento 2, Object.create(null)) |
| H-M01-04 | M-01 | Informativo | 3 XSS | `engine/color.js:37`, `engine/indicator.js:94` | `reason` y los mensajes de error incluyen el nombre de categoría tal cual (`<img src=x onerror=...>` llega intacto). No es explotable en el motor; sí lo sería si el front usa `innerHTML`. | El front renderiza con `textContent`; prueba XSS almacenado cuando exista UI. | Abierto |

## Motor de escalada (C-01)

| ID | Ítem | Severidad | Categoría | Descripción | Propuesta |
