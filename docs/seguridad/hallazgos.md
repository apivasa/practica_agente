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
|---|---|---|---|---|---|
| H-C01-01 | C-01 | Baja | 3 Entradas | **Corregido** (89c762b). `DATE_RE` aceptaba fechas imposibles (`2026-02-31`). La vigencia indebida no pasa del mes indicado. | Validar la fecha real (ida y vuelta con `Date.UTC`). |
| H-C01-02 | C-01 | Baja | 5 Automatizaciones | **Parcialmente corregido** (89c762b). Ya se rechazan los huecos entre meses y los meses posteriores a `asOf`. Falta rechazar un historial de un trimestre anterior que no contiene `asOf`. | Resto en C-03: el último mes del historial debe ser el de `asOf` o el anterior. |
| H-C01-03 | C-01 | Info | 1 RLS | El motor no vincula la excepción con la unidad ni limita su duración. | Controlarlo con RLS y pgTAP en la tabla `exceptions`. |

## Modelo de datos, RLS y auditoría (F-03+F-04+F-06)

Detalle y reproducción en `docs/reportes/F-03-F-04-F-06-seguridad.md`.

| ID | Ítem | Severidad | Categoría | Ubicación | Resumen | Corrección sugerida | Ítem propuesto | Estado |
|---|---|---|---|---|---|---|---|---|
| H-F03-01 | F-04 | Media | 1/8 | `rls_policies.sql` `measurements_update`, `commitments_update` | El custodio, al actualizar, puede falsificar `created_by`, marcar `source='automatic'` y cambiar `unit_id`/`measured_on`. En el INSERT también puede declarar `source='automatic'`. | WITH CHECK `created_by = auth.uid()`; grants de columna; `source='automatic'` solo para el backend. | M-04 (carga de mediciones) o fix inmediato | Abierto |
| H-F03-02 | F-04 | Media | 8 | `audit_triggers.sql` | Sin trigger de auditoría en `measurements` (ni en `targets`, `units` ni `alerts`): las mediciones se pueden reescribir sin dejar rastro. | `audit_measurements`, `audit_targets`, `audit_units`; auditoría explícita del backend para evaluaciones y alertas. | M-04 / C-02 | Abierto |
| H-F03-03 | F-04 | Baja | 8 | `audit_log` | `service_role` puede hacer UPDATE, DELETE y TRUNCATE sobre la auditoría. | Revocarlos y añadir un trigger que bloquee UPDATE/DELETE (append-only). | S-03 | Abierto |
| H-F03-04 | F-04 | Baja | 1 | default privileges de `public` y `private` | Las tablas y funciones nuevas nacen con ALL/EXECUTE para anon/PUBLIC. Mitigado por la prueba de regresión 041. | `alter default privileges … revoke`. | S-03 | Abierto |
| H-F03-05 | F-04 | Baja | 1 | `exceptions_update` | Un miembro del comité reescribe la excepción de otro: toma la firma, extiende la vigencia sin tope y la cambia de unidad. | `unit_id` inmutable; CHECK de vigencia (ligado a H-C01-03). | C-0x (excepciones) | Abierto |
| H-F03-06 | F-04 | Baja | 2 | `config.toml` / panel de Auth | Registro abierto activo (`enable_signup` por defecto). | `enable_signup = false`; verificar en S-05. | S-05 | Abierto |
| H-F03-07 | F-06 | Info | 8 | `seed.sql` | Contraseña local común para 7 cuentas. Solo es seguro mientras `seed.sql` no llegue a producción. | Guarda en `tests/security/db-static-f03.test.js`; en `deploy.yml` (V-05) usar `db push` sin `--include-seed`. | V-05 | Mitigado |
| H-F03-08 | F-04 | Info | 1 | `units_select`, `indicators_select` | El custodio ve todas las unidades; todo rol ve la configuración de todos los indicadores. | Revisar si se añade asignación indicador↔unidad. | — | Aceptado |
## Motor de vulnerabilidades (M-05)

| ID | Ítem | Severidad | Categoría | Ubicación | Resumen | Corrección sugerida | Estado |
|---|---|---|---|---|---|---|---|
| H-M05-01 | M-05 | Media | 3/5 Entradas, alertas | `engine/vulnerabilities.js:163,231` | `resolvedToDate.total` no se acota al efectivo y `paceStatus` usa el total combinado: 500 P2/P3 resueltas sobre un paquete de 300 dejan el ritmo "al día" con 0 P0/P1 resueltas, y la alerta de atraso no se dispara. | Acotar `min(resuelto, efectivo)` por criticidad en el ritmo o rechazar el exceso; ritmo por criticidad; CHECK en BD/CSV. | Abierto |
| H-M05-02 | M-05 | Baja | 3/5 Entradas, alertas | `engine/vulnerabilities.js:61,162,243` | Conteos no seguros (`1e308`) → total `Infinity`, `expected` `NaN`, `behind:false` (falla abierta). | `Number.isSafeInteger` y lanzar si un total no es finito; CHECK de rango en BD. | Abierto |
| H-M05-03 | M-05 | Baja | 3 Entradas | `engine/vulnerabilities.js:123-124` | `thresholds` lee propiedades heredadas (`Object.create({p0p1:0})` → umbral 0). No alcanzable vía JSON. | Leer solo propiedades propias (`Object.hasOwn`). | Abierto |
