# Modelo de amenazas (borrador, M-01 + S-01)

Estado: borrador. Cubre la superficie construida hasta M-01 (motor `engine/`). Se amplía en S-02 con Supabase (Auth, RLS, RPC), el front en GitHub Pages y los workflows programados.

## Activos

| Activo | Por qué importa |
|---|---|
| Color de cada indicador por unidad | Decide los candados sobre la capacidad de la unidad. Un color falso aplica o quita restricciones indebidamente. |
| Configuración de indicadores (tipo, sentido, ventana, umbrales, umbrales por categoría, muestra mínima) | Quien la altera cambia el resultado de todas las unidades. |
| Mediciones cargadas por custodios | Entrada principal del motor. |
| Compromisos, metas y excepciones | Modifican el efecto del color. |
| Auditoría de acciones automáticas | Evidencia de candados, alertas y vencimientos; no debe ser editable. |
| Credenciales: `SUPABASE_SECRET_KEY` (solo en Actions), sesiones de usuario | Dan acceso a los datos. |

## Actores

| Actor | Confianza | Puede (según diseño) |
|---|---|---|
| Gestora de KPIs | Alta | Define indicadores, umbrales y custodios. |
| Custodio | Media | Carga mediciones de **su** KPI (CSV o formulario). |
| Comité de delivery | Alta | Ve todas las unidades, decide escaladas, aprueba excepciones. |
| Líder de unidad | Baja respecto a datos ajenos | Solo ve su unidad. Interés en mejorar su color o quitar candados. |
| Anónimo / Internet | Nula | Ve el front estático público. |
| GitHub Actions (cálculo programado) | Alta, con clave secreta | Ejecuta el motor y escribe colores, candados y auditoría. |

## Superficie actual (M-01)

- `engine/` — funciones puras ESM (`validateIndicator`, `normalizeIndicator`, `measure`, `parseDay`, `evaluateColor`). Sin red, sin E/S, sin dependencias.
- Entradas no confiables que llegarán al motor: configuración de indicador (gestora, vía BD), mediciones (custodios, vía CSV/formulario/BD), `asOf`, `target`, `category` (Actions y front).
- Salidas que se mostrarán en el front: `color`, `reason` (texto que incluye valores y nombres de categoría) y mensajes de error.

## Amenazas STRIDE (motor)

| ID | STRIDE | Amenaza | Control | Prueba |
|---|---|---|---|---|
| T-ENG-01 | Tampering | Prototype pollution con claves `__proto__`/`constructor` en `thresholdsByCategory`, `category` o `appId`. | `hasOwnProperty` para elegir umbral; copia defensiva; `Map` en coverage. | `tests/security/engine-m01.test.js` (categoría 3, pollution) |
| T-ENG-02 | Tampering | Valores NaN/Infinity/strings en umbrales, valores, `target`, `windowDays`, `minSample` que fuerzan un color. | Validación `Number.isFinite`/`Number.isInteger`; mediciones no finitas se ignoran; `value` no finito lanza. | idem (números no finitos) |
| T-ENG-03 | Tampering | Fechas malformadas o de otro periodo cuelan datos en la ventana. | Regex anclada `YYYY-MM-DD` + verificación de calendario UTC. | idem (fechas) |
| T-ENG-04 | DoS | Arreglos enormes, `windowDays` gigante, miles de categorías, ReDoS. | Algoritmos O(n), sin iterar por días; regex sin cuantificadores anidados. | idem (complejidad) |
| T-ENG-05 | Elevation / Tampering | Ejecución de código vía `eval`/`Function`/RegExp dinámica. | No existen en el motor. | idem (categoría 6) |
| T-ENG-06 | Information disclosure / XSS | `reason` y errores reflejan nombres de categoría; si el front los inserta como HTML hay XSS almacenado. | El front debe renderizar con `textContent`. | Pendiente: prueba XSS del front (V-xx / S-02). |
| T-ENG-07 | Tampering / DoS | Valores extremos (p. ej. `1e308`) desbordan la suma a `Infinity` y rompen la evaluación; negativos sesgan el resultado. | Pendiente: validación de rango en BD/CSV (CHECK) y manejo por indicador en Actions. | Ver hallazgos H-M01-02. |
| T-ENG-08 | Tampering | `sampleSize` no numérico salta la muestra mínima. | Pendiente (H-M01-01). | Ver hallazgos. |

## Superficie de CI/CD (S-01)

- Workflows: `ci.yml` (lint, unit, build, pgTAP, e2e; `contents: read`), `lockfile.yml` (genera y sube `package-lock.json`; `contents: write` + `actions: write` solo en el job, solo en `item/**` y `fix/**`), `seguridad.yml` (gitleaks, semgrep, npm audit, CodeQL, `tests/security`; `contents: read`, `security-events: write` solo en CodeQL).
- Disparadores: `pull_request` (los forks reciben token de solo lectura y sin secretos), `push` a ramas propias, `schedule` semanal y `workflow_dispatch` (requiere permiso de escritura en el repo).
- Dependencias de terceros: acciones de GitHub fijadas por SHA, binario de gitleaks con sha256, semgrep y CLI de Supabase con versión fija, paquetes npm del lockfile.

## Amenazas STRIDE (CI/CD y cadena de suministro)

| ID | STRIDE | Amenaza | Control | Prueba |
|---|---|---|---|---|
| T-CI-01 | Tampering / Elevation | Etiqueta de una acción de terceros re-apuntada a código malicioso que corre con el token del job. | `uses:` por SHA completo con `# vX.Y.Z`; Dependabot `github-actions` propone las subidas como PR revisable. | `tests/security/workflows.test.js` (SHA y comentario) |
| T-CI-02 | Elevation | Un PR de fork ejecuta código con permisos de escritura o secretos (`pull_request_target`, `workflow_run`). | Ningún workflow usa esos eventos; permisos por defecto `contents: read`; escritura solo a nivel de job. | idem (sin `pull_request_target`, sin `write` a nivel de workflow) |
| T-CI-03 | Tampering | Inyección de expresiones (`${{ github.event.pull_request.title }}`, `head_ref`) en `run:`. | Datos del evento solo por variables de entorno. | idem (expresiones de evento) |
| T-CI-04 | Tampering | Script `postinstall` de un paquete comprometido ejecuta código en CI. | `npm ci --ignore-scripts`; solo `npm rebuild esbuild` explícito; `npm audit` y `npm audit signatures`. | idem (`--ignore-scripts`); job `npm-audit` |
| T-CI-05 | Information disclosure | El token del checkout queda en `.git/config` al alcance de scripts. | `persist-credentials: false` salvo en `lockfile.yml` (hace push y no ejecuta scripts). | idem (persist-credentials) |
| T-CI-06 | Tampering | `lockfile.yml` escribe en `main` sin revisión. | `branches: ['item/**','fix/**']`, `if: github.ref_name != 'main'`; `main` solo recibe merges de PR. | idem (lockfile) |
| T-CI-07 | Information disclosure | Secreto commiteado en cualquier punto del historial. | gitleaks sobre todo el historial de la rama en cada push/PR y semanal; semgrep `p/secrets`. Pendiente usuario: push protection (H-007). | job `gitleaks`; ensayo `ensayo/s01-secreto` |
| T-CI-08 | Information disclosure | Clave secreta o JWT legado incrustado en `dist/` (no versionado, gitleaks no lo ve). | El front solo usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. | `tests/security/static-secrets.test.js` (dist obligatorio en `seguridad.yml`) |
| T-CI-09 | Repudiation / Tampering | Neutralizar un control (`continue-on-error`, `\|\| true`) para que el pipeline pase. | Prohibido por CLAUDE.md §4. | `workflows.test.js` (sin `continue-on-error` ni `\|\| true` en pasos de seguridad) |

## Pendiente para S-02
Auth y sesión, RLS por rol y tabla, RPC `security definer`, IDOR entre unidades/KPIs, importación CSV (fórmulas, tamaño, unidad ajena), front estático (CSP, anti-framing), workflows programados (disparo con datos manipulados) y DAST (ZAP).
