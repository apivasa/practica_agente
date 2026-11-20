# S-05b — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. En S-05b el constructor es seguridad y no se añade código de la app. Lo que se prueba es la superficie que abrió V-05 en producción: el front publicado en `https://apivasa.github.io/practica_agente/`, la API (PostgREST, Auth y GraphQL) del proyecto Supabase `oehtspdtpwdhfhhhkgao` con la clave publicable que lleva el bundle, y el environment `produccion` de GitHub. Se añade la amenaza T-PROD-08 (Pages sirve CORS comodín y no admite cabeceras) a `docs/seguridad/modelo-amenazas.md`.

Detalle completo: `docs/seguridad/pentest-preproduccion.md` › Resultados de la fase B.

## Pruebas de seguridad añadidas
No hay archivos de prueba nuevos. Se ejecutó la batería que ya existía, `tests/security/prod/fase-b.test.js` (S-05), contra producción. Casos ejecutados por categoría:
- Categoría 1 (autorización y RLS, anónimo): 17 casos. Son 10 lecturas de tablas, 4 escrituras anónimas, RPC a funciones `private`, esquemas internos y GraphQL.
- Categoría 2 (autenticación): 4 casos. `/auth/v1/settings` (registro, anónimos, OAuth), admin con la clave publicable, enumeración de usuarios y JWT `alg:none` o con firma inventada.
- Categoría 3 (inyección y entradas): incluida en las sondas de escritura y de esquema; la inyección masiva ya la cubren la fase A y `pentest-api`.
- Categoría 4 (front estático): 6 casos. HTTPS, HSTS, CSP, secretos, terceros y archivos de desarrollo. Además, OpenAPI no publicado.
- Categoría 5 (Actions): el paso «environment produccion» del job.
- Categoría 7 (DAST): ZAP full scan no destructivo de Pages.

Total: 28 casos de Node; pasan 28, fallan 0 y no se omite ninguno. La suite `roles` se salta por diseño con `S05_MODE=anonimo`, así que no es una prueba desactivada.

## Resultados del pipeline
[Seguridad 44839422473](https://github.com/apivasa/practica_agente/actions/runs/44839422473): `workflow_dispatch` desde `main` (commit `7610aba`) con `fase_b = anonimo`, 2026-11-20 18:48 (America/Guayaquil).
- S-05 fase B (job 136643913606): success.
  - Las 28 pruebas pasan.
  - ZAP full scan de Pages: 3 URL, todas dentro del alcance, **FAIL 0 · WARN 7 · PASS 136**. Riesgo alto: 0.
  - Informe ZAP en el artefacto `s05-fase-b-zap`.
- gitleaks (historial completo): success.
- semgrep (JS, secretos, Actions, SQL): success.
- npm audit (producción): success.
- CodeQL (javascript-typescript y actions): success.
- Pruebas de seguridad (`tests/security`): success.
- Pentest API (PostgREST/Auth, Supabase local): success.
- DAST (e2e de seguridad + ZAP baseline): success.
- S-05 fase A: skipped, como corresponde con `fase_b != no`.

## Hallazgos
No hay hallazgos altos ni críticos. Ninguna sonda anónima escribió nada, así que no hace falta limpiar filas `s05-fase-b`.

Hallazgos nuevos:
- **H-S05-07 · Info · 4 · Pages (ZAP 10098, 40040).** Pages responde `Access-Control-Allow-Origin: *`, incluso a un `Origin` arbitrario, sin `Allow-Credentials`.
  - Reproducción: `GET https://apivasa.github.io/practica_agente/` con `Origin: https://otro.example` devuelve el comodín.
  - Por qué no tiene impacto: el contenido es estático y público, la fase B comprueba que no lleva secretos y la sesión de Supabase viaja como bearer, no como cookie.
  - Estado: aceptado. Pages no permite cambiar esa cabecera.
- **H-S05-08 · Baja · 4 · Pages (ZAP 10020, 10055, 10021, 10063, 90004).** Faltan `X-Frame-Options`/`frame-ancestors`, `nosniff`, `Permissions-Policy`, COOP y COEP. Pages no admite cabeceras propias y `frame-ancestors` no funciona en la meta CSP.
  - Mitigación del clickjacking: script anti-framing (H-S04-01).
  - El resto no tiene impacto práctico con `script-src 'self'` y sin contenido de terceros.
  - Estado: aceptado. Si algún día hiciera falta, la alternativa es una CDN delante de Pages.

Hallazgos que ya existían, actualizados con la evidencia del run:
- **H-S05-01 · Media · 2 · Auth del proyecto real: mitigado.** `/auth/v1/settings` de producción devuelve `disable_signup = true`, sin inicio anónimo y sin proveedores externos. La Site URL, las redirecciones y la política de contraseñas no se ven como anónimo; se siguen en H-S03-02 y en el panel.
- **H-S05-03 · Baja · 1 · `pg_graphql`: mitigado para anónimo.** La introspección `__schema` anónima no publica ninguna de las 10 tablas. Sigue abierto para la usuaria: desactivar la extensión si no se usa. GraphQL con sesión se prueba en el modo `roles`.
- **H-C03-02 · Media · 5 · environment `produccion`: corregido.**
  - Los tres workflows con secretos de producción declaran `environment: produccion`.
  - La API devuelve `deployment_branch_policy: {"protected_branches":false,"custom_branch_policies":true}`.
  - El aviso `environment produccion sin regla de ramas (H-C03-02)` **no se emitió**: en el log solo aparece como texto del script (la línea `if`), no como anotación `::warning::`.
  - La usuaria confirmó la regla `main` (P-06).
  - Residual: desde la sesión no se pueden listar el nombre de la política ni los secretos del repositorio (403). Queda como seguimiento confirmar que no hay copias de los secretos a nivel de repositorio.
- **H-S03-02 · Baja · 2 · política de contraseñas: sigue abierto.** `supabase/config.toml` no tiene `minimum_password_length` ni `password_requirements`, y en producción no se puede observar sin cuenta. Corrección: desarrollador (`config.toml`) y usuaria (panel).
- **H-S05-06 · Baja · 5: corregido en V-05.** `deploy.yml` › `verify` ya no recibe `SUPABASE_SECRET_KEY`.
- **H-007 · Baja · 6: sigue abierto (P-04).** El 2026-11-20 la API sigue dando `secret_scanning`, `push_protection` y `dependabot_security_updates` en `disabled`. En el job el paso no imprimió nada, porque `GITHUB_TOKEN` no tiene acceso.

## Verificado sin hallazgos
- 1 · Autorización y RLS (anónimo, en producción):
  - Las 10 tablas devuelven lectura denegada o vacía.
  - `POST` a `units`, `exceptions`, `audit_log` y `user_roles` se rechaza por privilegio, sin llegar a restricciones `23xxx`.
  - Las funciones `private` no están expuestas por RPC.
  - `auth`, `private`, `storage` y `vault` no son accesibles por `Accept-Profile`.
  - OpenAPI no se publica.
  - GraphQL no expone tablas.
- 2 · Autenticación:
  - Registro cerrado, sin anónimos ni OAuth.
  - `/auth/v1/admin/users` da 401/403 con la clave publicable.
  - Sin enumeración de usuarios en el login.
  - JWT `alg:none` y HS256 con firma inventada (`role: service_role`) → 401.
  - El bundle lleva una sola clave `sb_publishable_` y ninguna clave legada.
- 4 · Front publicado:
  - `http://` redirige a `https://` y hay HSTS.
  - CSP por meta sin `unsafe-inline` ni `unsafe-eval`, sin loopback y con `connect-src` solo al proyecto.
  - Sin `sb_secret_`, tokens ni claves privadas.
  - Sin scripts de terceros ni source maps.
  - `.env`, `package.json`, `seed.sql` y `.git/config` → 404.
  - ZAP no encuentra XSS, inyección, traversal ni bibliotecas vulnerables.
- 5 · Actions: environment `produccion` con política de ramas; el job de la fase B corre con `contents: read`, solo desde `main` y sin la clave secreta.
- 6 · Cadena de suministro: gitleaks, semgrep, npm audit y CodeQL en verde en el mismo run.
- 7 · DAST: el ZAP full scan de Pages no sale del alcance y no da ninguna alerta alta.

## Seguimiento (no bloquea S-05b; el criterio de aceptación es «sin altos ni críticos»)
1. **Fase B en modo `roles`.** La usuaria crea las 4 cuentas de prueba dedicadas (`s05-<rol>@example.test`) con su fila en `user_roles`, y el secreto `S05_TEST_USERS` en el environment `produccion`; crear secretos es compuerta del usuario. Después, `dispatch` con `fase_b=roles`. Cubre en producción:
   - `jwt_expiry` (H-S03-01).
   - IDOR del líder y del custodio.
   - Auditoría inmutable.
   - Escalada en `user_roles`.
   - Que el líder no pueda crear excepciones.
   - GraphQL con sesión.
2. **Panel de Supabase (usuaria):**
   - Site URL y redirecciones a la URL de Pages.
   - Contraseña mínima de 12 con complejidad (H-S03-02).
   - Desactivar `pg_graphql` (H-S05-03).
3. **GitHub (usuaria, P-04):**
   - Confirmar que no quedan secretos de producción a nivel de repositorio (H-C03-02, residual).
   - Activar secret scanning, push protection y Dependabot (H-007).
4. **P-05 (activar evaluaciones):** desde seguridad no hay ningún bloqueo. No queda ningún hallazgo alto ni crítico abierto.
