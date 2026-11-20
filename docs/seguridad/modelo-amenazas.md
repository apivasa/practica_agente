# Modelo de amenazas (STRIDE)

Estado: **S-02** (2026-11-19). Cubre el motor (`engine/`), la capa de datos (F-03/F-04/F-06), CI/CD (S-01) y, por componente, el front en GitHub Pages, Supabase Auth, PostgREST/RLS y las Actions programadas con la clave secreta. Las amenazas de componentes aún no construidos (front con UI, CSV, Actions programadas) quedan con su control exigido y la prueba asignada al ítem que los construye.

Regla del documento: **toda amenaza de riesgo Alto tiene una prueba automática asignada** (archivo y caso). La tabla de trazabilidad del final lo resume; si una amenaza alta queda sin prueba, el ítem que la introduce no puede salir en `VERDE`.

Escala de riesgo: **Alto** = acceso a datos de otra unidad, escalada de rol, alteración de colores/candados, secreto expuesto, XSS almacenado o inyección explotable. **Medio** = abuso con impacto limitado o que exige otra falla previa. **Bajo** = residual o informativo.

## Diagrama de confianza

```
 Internet ──(HTTPS)──► GitHub Pages (dist/: HTML+JS estático, clave sb_publishable_)
     │                         │ supabase-js en el navegador
     │                         ▼
     └──────────────► Supabase gateway ─► Auth (GoTrue: /auth/v1)    ◄── límite 1: navegador ↔ API
                               └────────► PostgREST (/rest/v1) ─► Postgres (RLS, esquema private)
                                                                   ▲
 GitHub Actions programadas (C-03/C-04, clave sb_secret_) ─────────┘   ◄── límite 2: backend con BYPASSRLS
 GitHub Actions CI/CD (ci.yml, seguridad.yml, lockfile.yml, deploy.yml) ◄── límite 3: repo ↔ runner
```

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

## Activos de datos (F-03)

| Tabla | Sensibilidad | Lee | Escribe |
|---|---|---|---|
| `user_roles` | Crítica (autorización) | propio usuario; gestora y comité todo | solo gestora |
| `units` | Media | gestora, comité, custodios; líder solo la suya | gestora |
| `indicators` | Alta (umbrales) | cualquier usuario con rol | gestora |
| `commitments` | Alta | gestora, comité; custodio de su KPI; líder de su unidad | custodio de su KPI (insert/update) |
| `measurements` | Alta (entrada del color) | ídem `commitments` | custodio de su KPI (insert/update) |
| `targets` | Media | gestora, comité, custodios; líder de su unidad | gestora |
| `evaluations` | Alta (decide los candados) | gestora, comité; custodio de su KPI; líder de su unidad | solo backend (`service_role`) |
| `exceptions` | Alta (levanta candados) | gestora, comité; líder de su unidad | comité: inserta firmando con `auth.uid()`; solo quien aprobó edita o revoca (C-02, trigger `enforce_exception_rules`); `approved_by`, `created_at`, `revoked_by`, `unit_id` inmutables; tope 90 días; sin DELETE |
| `alerts` | Baja | destinatario; gestora y comité | backend; el destinatario solo `read_at` |
| `audit_log` | Alta (evidencia) | gestora y comité | solo triggers `security definer` y backend |
| `auth.users` (semilla) | Crítica | Supabase Auth | gestora vía panel/Auth admin |

Roles de BD: `anon` (sin privilegios), `authenticated` (todos los usuarios; el rol de negocio sale de `user_roles`, nunca del JWT) y `service_role` (Actions con la clave secreta, BYPASSRLS).

## Amenazas STRIDE (datos y RLS, F-04)

| ID | STRIDE | Amenaza | Control | Prueba |
|---|---|---|---|---|
| T-DB-01 | Elevation | Usuario se asigna rol o cambia su unidad o KPI en `user_roles` | Solo la gestora escribe (políticas con WITH CHECK); la autorización no lee el JWT | `supabase/tests/security/040_*` §1–4, 011, 013 |
| T-DB-02 | Elevation / Spoofing | JWT con `role:service_role`, `app_metadata.role` o claims inventados bajo rol `authenticated` | Políticas basadas en `auth.uid()` y `user_roles`; firma del JWT validada por PostgREST | 040 §1; `tests/security/api/auth-jwt.test.js` (JWT manipulado → 401; claims inventados con firma válida) |
| T-DB-03 | Information disclosure | IDOR: líder A lee la unidad B (`or=`, `in=`, joins); custodio X lee Y | RLS por unidad/KPI con funciones de `private` | 040 §3–4, 013, 011 |
| T-DB-04 | Tampering | Custodio mueve una medición o compromiso a otro KPI | WITH CHECK `is_custodian_of(indicator_id)` | 040 §4, 011 |
| T-DB-05 | Tampering / Repudiation | Custodio falsifica `created_by` o `source` y reescribe mediciones sin rastro | INSERT exige `created_by = auth.uid()` y `source='manual'`; UPDATE por columnas (sin `created_by`, `source`, `unit_id`, `indicator_id`); trigger `audit_measurements` (H-F03-01/02 corregidos en `hardening.sql`) | 021; `api/idor-escalation.test.js` › escalada (columnas inmutables, mediciones falsificadas) |
| T-DB-06 | Elevation | Líder o gestora crea o extiende una excepción; un miembro del comité firma a nombre de otro | Solo el comité; `approved_by = auth.uid()` | 040 §3, 5, 6 |
| T-DB-07 | Tampering | Usuario escribe `evaluations`, `alerts` o `audit_log` (se pinta de verde, fabrica evidencia) | Sin privilegio INSERT/UPDATE/DELETE | 040 §6, 041, 042 |
| T-DB-08 | Tampering / DoS | TRUNCATE (ignora RLS) | TRUNCATE revocado a anon/authenticated | 041, 042 |
| T-DB-09 | Elevation | `security definer` con `search_path` manipulable o invocable por RPC | `search_path=''`, funciones en `private` no expuesto, EXECUTE revocado a PUBLIC/anon | 041 |
| T-DB-10 | Elevation | Tabla, vista o función futura sin RLS o con los grants por defecto de Supabase | Regresión de catálogo en CI | 041, `tests/security/db-static-f03.test.js` (H-F03-04) |
| T-DB-11 | Repudiation | Auditoría alterada o actor falsificado | Solo SELECT para usuarios; actor = `auth.uid()`; append-only también para `service_role` (revoke + triggers `audit_log_append_only`/`audit_log_no_truncate`, H-F03-03) | 042, 020; `api/rls-matrix.test.js` › audit_log (POST/PATCH/DELETE por rol) |
| T-DB-12 | Spoofing | La semilla con contraseña conocida llega a producción | `db push` no aplica la semilla; guarda contra `--include-seed`/`db reset --linked` | `tests/security/db-static-f03.test.js` |
| T-DB-13 | Spoofing | Autoregistro abierto | `enable_signup = false` en `config.toml`; el usuario sin rol no ve nada. En producción se verifica en el panel (S-05) | 014, 040 §2; `api/auth-jwt.test.js` › registro abierto deshabilitado |
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

| T-CI-10 | Elevation / Tampering | `deploy.yml` (V-05) con la clave secreta o credenciales de BD se dispara desde una rama o PR y aplica migraciones o publica un `dist/` alterado. | Solo `push` a `main` y `environment` protegido; sin `pull_request`; secretos solo en el job de despliegue; `db push` sin `--include-seed`. | Prueba a añadir en `workflows.test.js` cuando exista `deploy.yml` (V-05); hoy `db-static-f03.test.js` (guarda de seed). |

---

# STRIDE por componente (S-02)

## 1. Front estático en GitHub Pages

Superficie: `dist/` público (HTML, JS, CSS), `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` incrustadas, rutas por rol en el cliente (F-05), formularios de indicadores, compromisos, mediciones y excepciones (M-02..M-04, C-02), importación CSV (M-04). GitHub Pages no permite cabeceras propias: la CSP va por `<meta>` y `frame-ancestors` no aplica.

| ID | STRIDE | Amenaza | Riesgo | Control | Prueba |
|---|---|---|---|---|---|
| T-FE-01 | Information disclosure | Clave `sb_secret_`, JWT legado `service_role` o token incrustado en `dist/` | Alto | El front solo lee `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`; gitleaks no ve `dist/`, por eso se escanea el build | `tests/security/static-secrets.test.js` (con `SECURITY_REQUIRE_DIST=1` en `seguridad.yml` › security-tests) |
| T-FE-02 | Tampering / Elevation | XSS almacenado: nombre de indicador, categoría, `reason` del motor, motivo de excepción, `payload` de alerta o celda CSV renderizados como HTML | Alto | Render con `textContent`/nodos DOM, nunca `innerHTML` con datos; CSP sin `unsafe-inline` en scripts | `e2e/security/xss.spec.js` (S-04: payloads en `units.name`, `indicators.name`/`description`/claves de categoría, insertados por la gestora vía API; los 4 roles recorren sus rutas; XSS reflejado por URL); `e2e/security/csp.spec.js` (la CSP bloquea inline, `on*`, eval y orígenes ajenos); `api/idor-escalation.test.js` › inyección en filtros. Al llegar las vistas con datos (M-02..M-04, V-0x) la prueba exige el texto literal |
| T-FE-03 | Elevation | El front oculta rutas por rol pero la autorización real está en el cliente | Alto | La autorización vive en RLS; el enrutamiento por rol es solo UX. Cualquier llamada directa a la API se evalúa como si no hubiera front | `tests/security/api/rls-matrix.test.js` (matriz completa sin front) |
| T-FE-04 | Tampering | Clickjacking (la app embebida en un iframe ajeno induce a aprobar una excepción) | Medio | `frame-ancestors` no aplica por meta: `src/security/anti-framing.js` (primer import de `main.js`) vacía y oculta el documento y elimina `#app` si `top !== self`, así la app no arranca. Residual: con JS desactivado no hay app; un atacante con `sandbox` sin `allow-scripts` solo enmarca una página vacía | `e2e/security/framing.spec.js`; `tests/security/front-s04.test.js` › anti-framing |
| T-FE-05 | Tampering | Dependencia cargada desde CDN sin SRI o CSP permisiva (`unsafe-inline`, `*`) | Medio | Todo empaquetado por Vite desde npm (lockfile); CSP `script-src 'self'` | `tests/security/front-s04.test.js` (política generada y `dist/index.html`: CSP primer elemento, sin inline, recursos solo bajo `/practica_agente/` o con SRI); ZAP baseline regla 90003/10017 en FAIL (`seguridad.yml` › dast) |
| T-FE-06 | Tampering | CSV con fórmulas (`=`, `+`, `-`, `@`) que se ejecutan al reexportar en Excel; filas hacia otra unidad o KPI ajeno | Medio (fórmulas) / Alto (unidad ajena) | Neutralizar prefijos al exportar; la fila ajena la rechaza RLS (`is_custodian_of`) | Unidad/KPI ajeno: `api/idor-escalation.test.js` › mediciones falsificadas (lote mixto: todo o nada). Fórmulas: `e2e/security/csv-injection.spec.js` (`test.fixme`, pendiente de M-04: la importación CSV no existe aún) |
| T-FE-07 | Spoofing | Sesión robada de `localStorage` por XSS | Alto (condicionado a T-FE-02) | Mitigado por T-FE-02 y CSP (`connect-src` solo `'self'` y el proyecto Supabase: un XSS no puede exfiltrar con `fetch`); tokens de 1 h; logout revoca el refresh token | `api/auth-jwt.test.js` › logout revoca el refresh token; `e2e/security/csp.spec.js` › connect-src; T-FE-02 |
| T-FE-08 | Information disclosure | Enlace externo con `target=_blank` sin `rel="noopener"` (reverse tabnabbing) | Bajo | `rel="noopener noreferrer"`; `<meta name="referrer" content="no-referrer">` | `tests/security/front-s04.test.js` › target=_blank |

## 2. Supabase Auth (GoTrue, `/auth/v1`)

Superficie: inicio de sesión por correo y contraseña, refresh, logout, `/auth/v1/user` (el propio usuario edita `user_metadata`), `/auth/v1/admin/*` (solo con clave secreta), registro (`/signup`, deshabilitado).

| ID | STRIDE | Amenaza | Riesgo | Control | Prueba |
|---|---|---|---|---|---|
| T-AUTH-01 | Spoofing | Autoregistro abierto crea cuentas en la organización | Alto | `enable_signup = false` (local y, en S-05, panel de producción); sin fila en `user_roles` no se ve nada | `api/auth-jwt.test.js` › registro abierto deshabilitado; `supabase/tests/014`, `040` §2 |
| T-AUTH-02 | Spoofing | JWT falsificado: firma alterada, `alg:none`, secreto inventado, confusión de clave con la publicable, claims o `exp` alterados sin re-firmar | Alto | PostgREST valida firma y `exp`; algoritmo fijado por el servidor | `api/auth-jwt.test.js` › JWT manipulado → 401 (12 variantes × 10 tablas + escritura) |
| T-AUTH-03 | Spoofing | Token vencido reutilizado | Alto | `exp` validado; tokens de 1 h | `api/auth-jwt.test.js` › token correctamente firmado pero vencido → 401 (con control vigente → 200) |
| T-AUTH-04 | Elevation | El usuario se pone `app_metadata.role` o `user_metadata.role` por `/auth/v1/user` y la app lo usa como rol | Alto | La autorización sale solo de `public.user_roles` (ADR 0005); `app_metadata` solo la escribe el backend | `api/auth-jwt.test.js` › app_metadata.role por /auth/v1/user; › firma válida con claims de rol inventados no da acceso |
| T-AUTH-05 | Elevation | Usuario llama a `/auth/v1/admin/users` para crear o promover cuentas | Alto | Requiere clave secreta | `api/auth-jwt.test.js` › API de administración de Auth |
| T-AUTH-06 | Spoofing | Sesión que sigue viva tras logout | Medio | Logout revoca refresh token y sesión de Auth; **residual**: el access token sigue siendo válido en PostgREST hasta su `exp` (≤ 1 h, JWT sin estado) — H-S03-01 | `api/auth-jwt.test.js` › logout revoca el refresh token y la sesión en Auth |
| T-AUTH-07 | Spoofing | Fuerza bruta o contraseñas débiles | Medio | Límite de intentos de GoTrue; política de contraseñas mínima — **pendiente** (H-S03-02) | S-05 (configuración de producción) |
| T-AUTH-08 | Spoofing | Cuentas semilla con contraseña conocida en producción | Alto | `db push` no aplica `seed.sql`; guardas contra `--include-seed` | `tests/security/db-static-f03.test.js` |

## 3. PostgREST y RLS (`/rest/v1`)

Superficie: 10 tablas de `public` (CRUD según grants y políticas), filtros (`eq`, `in`, `or`, `and`, `not`), `select=` con embebidos, `Prefer` (`return`, `resolution`, `count`, `tx`, `missing`), `on_conflict`, `/rpc/*` (hoy ninguna función en `public`), cabeceras `Accept-Profile`/`Content-Profile`, OpenAPI en `/`.

| ID | STRIDE | Amenaza | Riesgo | Control | Prueba |
|---|---|---|---|---|---|
| T-API-01 | Information disclosure | Celda de la matriz rol × tabla × operación más abierta que el diseño (ADR 0005) | Alto | Grants mínimos + políticas RLS por tabla | `api/rls-matrix.test.js` › `<tabla>` › `<actor> · GET/POST/PATCH/DELETE` (10 tablas × 8 actores × 4 operaciones = 320 casos) |
| T-API-02 | Information disclosure | Anónimo con la clave publicable lee o escribe datos | Alto | `anon` sin privilegios | `api/rls-matrix.test.js` (actor `anon`); `api/auth-jwt.test.js` › la clave publicable sola |
| T-API-03 | Information disclosure | IDOR por filtros: `or=`, `in=`, `neq`, `not`, ids ajenos; conteos con `Prefer: count=exact` | Alto | RLS se aplica antes de cualquier filtro | `api/idor-escalation.test.js` › IDOR por filtros (7 tablas × 8 variantes; HEAD con count) |
| T-API-04 | Information disclosure | IDOR por embebidos (`select=*,measurements(*)`, `!inner`) o salto a `auth.users` | Alto | RLS en cada tabla embebida; `auth` no expuesto | `api/idor-escalation.test.js` › IDOR por embebidos |
| T-API-05 | Elevation | Escalada: PATCH/POST/upsert en `user_roles`, `units.leader_user_id`, columnas inmutables (`created_by`, `source`, `unit_id`, `indicator_id`), excepciones | Alto | Políticas solo-gestora/solo-comité, grants por columna, `approved_by = auth.uid()` | `api/idor-escalation.test.js` › escalada |
| T-API-06 | Tampering | Upsert indebido con `Prefer: resolution=merge-duplicates` + `on_conflict` (robar fila ajena por id, reescribir compromiso de otro KPI) | Alto | INSERT WITH CHECK + UPDATE por columnas | `api/idor-escalation.test.js` › upsert |
| T-API-07 | Elevation | Funciones de autorización `security definer` invocables por `/rpc` o vía `Accept-Profile: private` | Alto | Esquema `private` no expuesto; `RPC_ALLOWLIST` vacío | `api/rls-matrix.test.js` › RPC; › catálogo (funciones expuestas); `api/idor-escalation.test.js` › esquemas no expuestos |
| T-API-08 | Elevation | Tabla o vista nueva sin RLS o sin fila en la matriz | Alto | Catálogo verificado en cada PR | `api/rls-matrix.test.js` › catálogo (RLS, `security_invoker`, tabla sin matriz, OpenAPI); `supabase/tests/security/041` |
| T-API-09 | Tampering | Inyección SQL por filtros, `select=` u `order=` | Alto | PostgREST parametriza; parser estricto | `api/idor-escalation.test.js` › inyección en filtros |
| T-API-10 | Information disclosure | OpenAPI en `/rest/v1/` lista el esquema a anónimos | Bajo | Grants: anon no ve tablas | `api/auth-jwt.test.js` › la clave publicable sola no lista el esquema |
| T-API-11 | DoS | Consultas costosas (embebidos profundos, `limit` ausente) | Bajo | Límites del plan de Supabase; sin pruebas de carga en producción (alcance) | — (aceptado) |

## 4. GitHub Actions programadas con la clave secreta (C-03, C-04, V-04)

Superficie: `evaluacion-mensual.yml`, `ritmo-diario.yml`, `scripts/evaluate.js` + `scripts/lib/` (C-03/C-04, construidos; `workflow_dispatch` con input `as_of`, guarda `vars.EVALUATION_ENABLED`), `salud.yml` (V-04). Usan `SUPABASE_SECRET_KEY` (BYPASSRLS) para escribir `evaluations`, `alerts` y `audit_log`. Leen mediciones cargadas por custodios (datos no confiables) y las pasan a `engine/`.

| ID | STRIDE | Amenaza | Riesgo | Control | Prueba |
|---|---|---|---|---|---|
| T-JOB-01 | Information disclosure | La clave secreta se imprime en logs (`echo`, `set -x`, error de fetch con cabeceras) | Alto | Solo vía `secrets.` en `env:`; sin `set -x`; GitHub enmascara | `tests/security/workflows.test.js` › no imprime secretos (aplica a todo workflow nuevo) |
| T-JOB-02 | Tampering / Elevation | Disparo con datos manipulados: `workflow_dispatch` con `inputs` (mes, unidad) interpolados en `run:`, o `pull_request` que ejecuta el job con secretos | Alto | Solo `schedule` + `workflow_dispatch` (requiere escritura en el repo); inputs validados por regex y pasados por `env:`; sin `pull_request_target` | `workflows.test.js` › sin `pull_request_target`, › sin expresiones de evento en `run:`. C-03 añade el caso `inputs` validados |
| T-JOB-03 | Tampering | Custodio carga mediciones extremas o de otra unidad para forzar o quitar un candado | Alto | RLS por KPI (T-DB-04); `measure()` neutraliza no finitos y negativos; CHECK `value >= 0` | `api/idor-escalation.test.js` › mediciones falsificadas; `tests/security/engine-m01.test.js`, `engine-m05.test.js` |
| T-JOB-04 | Tampering | Usuario escribe `evaluations` o `alerts` directamente (se pinta de verde, se quita un candado) | Alto | Sin INSERT/UPDATE/DELETE para `authenticated` | `api/rls-matrix.test.js` › evaluations, alerts; `api/idor-escalation.test.js` › nadie escribe evaluaciones |
| T-JOB-05 | Repudiation | Acción automática (candado, alerta, vencimiento) sin rastro o con auditoría editable | Alto | Insert explícito en `audit_log` desde la Action; `audit_log` append-only incluso para `service_role` | `supabase/tests/security/042`, `020`; `api/rls-matrix.test.js` › audit_log. C-03 añade la prueba "cada efecto deja fila de auditoría" |
| T-JOB-06 | Tampering | Excepción extendida o creada fuera del comité que suspende el candado | Alto | Solo comité, `approved_by = auth.uid()`, `expires_on >= current_date`, `unit_id` inmutable | `api/idor-escalation.test.js` › líder y gestora: crear o extender; › comité: no firma a nombre de otro |
| T-JOB-07 | DoS | El job falla en silencio (motor lanza por un dato) y no se aplica el candado | Medio | Error por indicador registrado en auditoría; `salud.yml` alerta si un programado no corrió (V-04) | C-03 / V-04 |
| T-JOB-08 | Elevation | Clave secreta con más alcance del necesario o compartida con CI | Medio | Solo en el environment de los jobs programados y de despliegue; `ci.yml` y `seguridad.yml` no usan secretos | `workflows.test.js` › pentest-api sin `secrets.` |
| T-JOB-09 | Tampering | `workflow_dispatch` con `as_of` futuro o pasado: candado anticipado, re-cierre de un mes viejo, vencimiento de excepción anticipado que consume la `dedupe_key` y silencia la alerta real | Medio | Formato validado (`parseArgs`), `as_of` > hoy rechazado, re-cierre solo con `--reprocess` auditado; inputs `AS_OF`/`REPROCESS` solo por `env:` (H-C03-01 corregido) | `automation-c03.test.js` › parseArgs |
| T-JOB-10 | Tampering | Custodio relaja `green_override` o `package_by_category` del compromiso (incluso de un periodo cerrado) para quitar un candado o callar el ritmo | Bajo | Auditado por `audit_commitments`; rol con potestad de negociar (diseño). Falta congelar periodos cerrados (H-C03-03) | `api/idor-escalation.test.js` (RLS de commitments) |
| T-JOB-11 | Tampering / Repudiation | Alguien pre-inserta alertas con la `dedupe_key` futura o falsifica `pace_snapshot` en `audit_log` para silenciar alertas | Alto | `authenticated` sin INSERT en `alerts` ni `audit_log`; `read_at` única columna editable; snapshots filtrados por `actor = 'system:evaluate'` | `041`; `automation-c03.test.js` › db.js snapshots, alertas |

## 5. CI/CD

Ver "Superficie de CI/CD (S-01)" y T-CI-01..10 arriba. El job `pentest-api` (S-03) levanta Supabase local efímero con claves locales generadas por la CLI: no usa secretos del repositorio y no apunta a hosts externos.

---

## Superficie nueva (M-02, M-03, M-04)

- **Pantalla de indicadores (gestora):** alta y edición de `indicators`, activar o desactivar, y asignación de custodio, que escribe `user_roles` (borrar e insertar filas `custodian`) y `indicators.custodian_user_id` desde el front, en tres peticiones sin transacción.
- **Compromisos (custodio):** INSERT/UPDATE de `commitments` con umbral negociado y paquete por categoría.
- **Mediciones (custodio):** captura manual e importación CSV (hasta 1 MB y 5000 filas), validada fila a fila en `engine/measurements-input.js` y guardada en un solo INSERT.
- **Semilla:** tres usuarios ficticios nuevos (custodio de un KPI inactivo, multirol gestora+custodio y un usuario sin rol) y dos indicadores inactivos.

| STRIDE | Amenaza | Control | Prueba |
|---|---|---|---|
| E | Un custodio, un líder o un usuario sin rol se concede el rol `custodian` o borra el de otro | `user_roles_insert/delete` solo `kpi_manager` | `api/rls-matrix.test.js` (user_roles), `api/m02-m04.test.js` › asignación |
| T | Un corte a medias en la asignación de custodio deja más permisos | Orden "falla cerrado" (borrar → conceder → columna); `custodian_user_id` es informativo y no da permisos | `front-m02-m04.test.js` › corte en cualquier paso |
| T | Dos asignaciones a la vez dejan dos custodios | Detección en pantalla (`incoherentCustodians`) | `front-m02-m04.test.js` › carrera (H-M02-01, abierto) |
| T | CSV con fórmulas (`= + - @`), tipos inválidos, unidades ajenas o cabeceras `__proto__` | `validateMeasurementInput` y `parseMeasurementsCsv` rechazan la fila y el lote entero | `front-m02-m04.test.js` › CSV |
| D | CSV enorme o patológico que congela la pestaña | Límite de 1 MB (`File.size` y bytes UTF-8) y 5000 filas; tokenizador lineal | `front-m02-m04.test.js` › tamaño y archivo patológico |
| T | Fila del CSV que fija `source`, `created_by` o `indicator_id` | Cabecera con lista blanca; `toMeasurementRow` fija `source: 'manual'`; RLS exige `created_by = auth.uid()` y `source = 'manual'` | `front-m02-m04.test.js`, `api/m02-m04.test.js` › multirol |
| I/T | XSS almacenado en nombre de indicador, categoría, notas, unidad o en el mensaje de error que repite la celda | Todo por `textContent`; `el()` rechaza `on*` de texto y URL `javascript:` | `front-m02-m04.test.js` › XSS, `front-f05.test.js` |
| E | Ser gestora da escritura en mediciones de KPIs que no custodia | `measurements_insert` exige `is_custodian_of` | `api/m02-m04.test.js` › multirol |

## Superficie de producción (S-05, antes de V-05)

Con el primer despliegue cambian tres cosas: (1) el front deja de ser un build local y queda en `https://apivasa.github.io/practica_agente/`, con la URL del proyecto y la clave publicable dentro del bundle; (2) la BD y Auth pasan al proyecto Supabase real (ref `oehtspdtpwdhfhhhkgao`), cuya configuración de Auth **no** la fija `config.toml`, sino el panel; (3) `deploy.yml` y los workflows programados usan los seis secretos de producción. Detalle y resultados en `docs/seguridad/pentest-preproduccion.md`.

| ID | STRIDE | Amenaza | Riesgo | Control | Prueba |
|---|---|---|---|---|---|
| T-PROD-01 | Spoofing | El proyecto real conserva los valores por defecto de Supabase (registro abierto, contraseña de 6 caracteres): cualquiera crea una cuenta | Medio (sin rol no se ve nada: T-AUTH-01) | Panel de Auth configurado por la usuaria antes del primer uso (H-S05-01) | `tests/security/prod/fase-b.test.js` › `/auth/v1/settings` (fase B) |
| T-PROD-02 | Information disclosure | `pg_graphql` activo en producción (no lo está en local) publica tablas o salta RLS | Bajo (respeta grants y RLS) | `anon` sin grants; desactivar la extensión si no se usa (H-S05-03) | `api/preprod-s05.test.js` › GraphQL (local); `prod/fase-b.test.js` › GraphQL anónimo |
| T-PROD-03 | Information disclosure | El build publicado lleva la clave secreta, un token o una clave legada | Alto | `deploy.yml` solo pasa URL y clave publicable a `VITE_*`; busca `sb_secret_` en `dist/` | `preprod-s05.test.js` › VITE_ solo publicable; `prod/fase-b.test.js` › sin secretos en assets |
| T-PROD-04 | Elevation | Un workflow de cualquier rama lee los secretos de producción (environment sin regla de ramas o secretos a nivel de repo) | Medio | Environment `produccion` con regla `main` y secretos solo ahí (H-C03-02, pendiente de la usuaria) | `preprod-s05.test.js` › environment produccion en jobs con credenciales de administración; `s05-fase-b` › paso informativo |
| T-PROD-05 | Tampering | El despliegue aplica la semilla (cuentas con contraseña pública) o vuelca la cadena de conexión | Alto | `db push` sin `--include-seed` ni `--debug` | `preprod-s05.test.js` › db push/reset |
| T-PROD-06 | Information disclosure / Elevation | Inyección en filtros, `order`, `select` y esquemas ocultos de PostgREST | Alto | PostgREST parametriza; `Accept-Profile` solo `public` | `api/preprod-s05.test.js` › inyección (10 tablas × 5 actores × 21 sondas), esquemas no expuestos; ZAP API scan (`s05-fase-a`) |
| T-PROD-07 | DoS (nuestro) | El propio pentest degrada producción | — | Fase B manual, 1 hilo, retardo, duración acotada, sin escaneo activo de la API ni AJAX spider; tope de 900 peticiones | `preprod-s05.test.js` › s05-fase-b acotado |

## Superficie nueva (M-06)

- **Color mensual por criticidad:** la evaluación mensual (`scripts/lib/build.js` → `engine/rows.js` `evaluateCategoryMonth` → `categoryMonthColor`) colorea los indicadores `cumulative_target` con `thresholds_by_category` a partir de `commitments.package_by_category` (lo escribe el custodio) y de las mediciones `resolved`/`detected` (custodio), ya no de `targets`. Ese color alimenta la escalada (racha de rojos → congelamiento).
- **Meta del líder:** `src/lib/dashboard.js` `categoryGoal` muestra etiquetas de categoría (claves jsonb que escribe la gestora) y metas en la vista del líder.

| ID | STRIDE | Amenaza | Riesgo | Control | Prueba |
|---|---|---|---|---|---|
| T-M06-01 | Tampering | Claves `__proto__`/`constructor` en `thresholds_by_category`, `package_by_category` o `measurements.category` contaminan prototipos o se leen como categoría válida | Medio | `Object.hasOwn` en lecturas; `normalizeIndicator` con `Object.create(null)` y descarta `__proto__`; categorías no reconocidas → sin evaluar | `engine-m06.test.js` › cat 3 prototipo |
| T-M06-02 | Tampering | Paquete o umbrales NaN/Infinity/negativos/decimales fuerzan verde | Medio | `count()`/`pct()` de `packageStatus`, `validateIndicator`; `num()` descarta no finitos | `engine-m06.test.js` › cat 3/5 cifras (H-M06-02: `[]`, `false`, `' '` → 0) |
| T-M06-03 | Tampering / DoS | Una medición malformada cargada por API (decimal, categoría nula o desconocida) deja el mes `not_evaluated` y corta la racha de rojos (evita el congelamiento) | Medio | Validación en el front (`measurements-input.js`); auditoría de `measurements`. Falta validar en BD o filtrar en el motor | H-M06-01 (abierto); `engine-m06.test.js` fija que nunca da verde |
| T-M06-04 | Information disclosure / XSS | Etiqueta de categoría con marcado llega al DOM | Medio | Todo por `textContent` (`el()`) | `engine-m06.test.js` › cat 4/6 |

## Trazabilidad: amenazas de riesgo Alto → prueba automática

| Amenaza | Prueba (archivo › caso) | Estado |
|---|---|---|
| T-DB-01, T-API-05 | `tests/security/api/idor-escalation.test.js` › escalada; `supabase/tests/security/040` §1–4 | Activa |
| T-DB-02, T-AUTH-02, T-AUTH-03 | `api/auth-jwt.test.js` › JWT manipulado → 401; › token vencido; `040` §1 | Activa |
| T-DB-03, T-API-03, T-API-04 | `api/idor-escalation.test.js` › IDOR por filtros / por embebidos; `040` §3–4 | Activa |
| T-DB-04, T-DB-05, T-JOB-03 | `api/idor-escalation.test.js` › columnas inmutables, mediciones falsificadas; `021` | Activa |
| T-DB-06, T-JOB-06 | `api/idor-escalation.test.js` › líder y gestora: excepción; › comité; `040` §3,5,6 | Activa |
| T-DB-07, T-JOB-04 | `api/rls-matrix.test.js` › evaluations/alerts/audit_log; `041`, `042` | Activa |
| T-DB-09, T-API-07 | `api/rls-matrix.test.js` › RPC, › catálogo; `041` | Activa |
| T-DB-10, T-API-08 | `api/rls-matrix.test.js` › catálogo; `041`; `db-static-f03.test.js` | Activa |
| T-DB-11, T-JOB-05 | `042`, `020`; `api/rls-matrix.test.js` › audit_log | Activa (C-03 amplía) |
| T-DB-12, T-AUTH-08 | `tests/security/db-static-f03.test.js` | Activa |
| T-DB-13, T-AUTH-01 | `api/auth-jwt.test.js` › registro abierto deshabilitado | Activa |
| T-AUTH-04, T-AUTH-05 | `api/auth-jwt.test.js` › app_metadata; › API de administración | Activa |
| T-API-01, T-API-02, T-FE-03 | `api/rls-matrix.test.js` (matriz completa, incluido `anon`) | Activa |
| T-API-06 | `api/idor-escalation.test.js` › upsert | Activa |
| T-API-09 | `api/idor-escalation.test.js` › inyección en filtros | Activa |
| T-FE-01 | `tests/security/static-secrets.test.js` | Activa |
| T-FE-02, T-FE-07 | `e2e/security/xss.spec.js`, `e2e/security/csp.spec.js` | Activa (S-04; se amplía con cada vista que muestre datos) |
| T-FE-04 | `e2e/security/framing.spec.js` | Activa (S-04) |
| T-FE-05, T-FE-08 | `tests/security/front-s04.test.js`; ZAP baseline (`seguridad.yml` › dast) | Activa (S-04) |
| T-FE-06 (fórmulas) | `e2e/security/csv-injection.spec.js` | **`test.fixme` → M-04** |
| T-FE-06 (unidad ajena) | `api/idor-escalation.test.js` › lote mixto | Activa (S-04 añade el CSV) |
| T-JOB-01, T-JOB-02 | `tests/security/workflows.test.js` › inputs solo por env, › SUPABASE_SECRET_KEY solo schedule/dispatch; `automation-c03.test.js` | Activa |
| T-JOB-05, T-JOB-11 | `automation-c03.test.js` › auditoría de efectos; › db.js | Activa |
| T-EXC-01 (E: comité toma o extiende la excepción de otro, H-S03-04/H-F03-05) | pgTAP `070`, `044`; `api/exceptions-c02.test.js` | Activa (C-02) |
| T-EXC-02 (T: forjar `created_at`/`revoked_at`/`revoked_by` para evadir el tope o fingir la revocación) | `044`; `api/exceptions-c02.test.js` › servidor fija campos | Activa (C-02) |
| T-EXC-03 (T/E: la evaluación programada aplica una excepción revocada y quita candados indebidamente, H-C02-01) | `tests/security/exceptions-c02.test.js` › automatización | **Falla: H-C02-01** |
| T-EXC-04 (I/T: XSS almacenado en motivo y `change_ref`) | `tests/security/exceptions-c02.test.js` › XSS; `api/exceptions-c02.test.js` › XSS | Activa (C-02) |
| T-CI-01..09 | `tests/security/workflows.test.js`; jobs gitleaks, semgrep, npm-audit, CodeQL | Activa |
| T-CI-10 | `workflows.test.js` (caso deploy) | **Asignada a V-05** |
| T-PROD-03, T-PROD-05 | `tests/security/preprod-s05.test.js` › VITE_ solo publicable, › db push/reset, › deploy.yml (si existe); `prod/fase-b.test.js` › sin secretos | Activa (S-05; la parte de producción, en fase B) |
| T-PROD-06 | `tests/security/api/preprod-s05.test.js` › inyección, › esquemas no expuestos, › embebidos; `seguridad.yml` › `s05-fase-a` (ZAP API scan) | Activa (S-05) |
