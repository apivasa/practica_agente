# F-05 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: login por correo y contraseña con Supabase Auth (`src/lib/session.js`), cliente supabase-js con la clave publicable (`src/lib/supabase.js`), router por hash con guardas por rol (`src/lib/route-logic.js`, `router.js`), vistas sin datos de negocio (`src/views/`), única consulta `user_roles` filtrada por `user_id`. En CI, el job e2e levanta Supabase local y exporta URL y clave publicable al build (`ci.yml`).

Pruebas de seguridad añadidas:
- `tests/security/front-f05.test.js`: 18 casos.
  - Cat. 2 (6): mensaje de login genérico, sin reenviar `error.message` ni el código del error; logout con `scope: 'local'`; `detectSessionInUrl: false`; sin sesión, toda ruta (incluidas `/__proto__`, `/constructor`, `javascript:`) va a login; claves heredadas y roles desconocidos (`admin`, `service_role`) no conceden vistas; ningún rol llega a la ruta de otro.
  - Cat. 4 (9): autoverificación de patrones; `src/` sin `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `createContextualFragment` ni `parseFromString`; sin `eval`, `new Function` ni timers con string; `src/` y `dist/` (si existe; obligatorio con `SECURITY_REQUIRE_DIST=1`) sin `sb_secret_`, `service_role` ni JWT legado; solo se leen `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`; `createClient` solo en `lib/supabase.js` y con la clave publicable; `el()` escribe con `textContent`; la contraseña de la semilla no está en `src/` ni en `dist/`.
  - Cat. 1 (2): las vistas no consultan datos (ni `.from`, ni `.rpc`, ni `fetch`); la única tabla leída es `user_roles` y F-05 no escribe en ninguna tabla.
  - Cat. 5 (1): `ci.yml` usa `supabase/setup-cli` fijada por SHA y con versión exacta, valida el prefijo `sb_publishable_`, exporta a `GITHUB_ENV` solo URL y clave publicable, no toca la clave secreta y borra el volcado de `supabase status`.
- Local: `node --test 'tests/security/*.test.js'` da 275 casos y 275 pasan.

Revisión manual:
- El router no es un control de acceso. Las vistas de rol solo muestran textos fijos y el número de filas propias de `user_roles`. La política `user_roles_select` limita la lectura a las filas propias (o a todas para gestora y comité), así que manipular el rol en el cliente no expone datos.
- Login: un 400 o un 422 (credenciales malas, usuario inexistente, correo sin confirmar) dan el mismo mensaje. El e2e lo comprueba con un correo inexistente.
- El registro abierto está cerrado en local (`enable_signup = false`), y el e2e exige `signup_disabled` (H-F03-06 queda corregido en local).
- La contraseña `Local-Only-Pass-2026` solo aparece en `seed.sql` y en `e2e/login.spec.js`, y se puede sustituir con `E2E_SEED_PASSWORD`. H-F03-07 sigue mitigado.
- Tokens en `localStorage` (opción por defecto de supabase-js): un XSS los podría robar. `src/` no tiene sumideros de HTML, pero `index.html` aún no tiene CSP. La mitigación es la CSP de S-04 (H-F05-01).

Resultados del pipeline: no consultados en esta revisión, porque se pidió no hacer push. gitleaks, semgrep, npm audit y CodeQL corren en `seguridad.yml` al subir la rama. ZAP y el pentest RLS/API no aplican aquí: llegan con S-04, S-03 y S-05.

Hallazgos (detalle en `docs/seguridad/hallazgos.md`):
- H-F05-01 · Baja · 2/4 · `src/lib/supabase.js:14` · Tokens en `localStorage` sin CSP en `index.html`. Reproducción: en la consola de la app con sesión, `localStorage` muestra la clave `sb-*-auth-token` con el access token y el refresh token. Corrección: CSP por meta sin `unsafe-inline` en scripts y `connect-src` acotado (S-04).
- H-F05-02 · Baja · 3/4 · `src/views/dom.js:6-8` · `el()` admite `on*` como atributo de texto y `href` con cualquier esquema. Es latente: hoy solo recibe constantes. Corrección: rechazar `on*` que no sean función y validar el esquema de `href` antes de V-01.
- H-F05-03 · Info · 2 · login · No hay freno de intentos en el cliente; depende del rate limit de Supabase Auth. Verificar en S-05 sin hacer fuerza bruta.

Verificado sin hallazgos: 2 (mensajes de login, logout, rutas sin sesión, registro cerrado), 4 (clave publicable únicamente, sin sumideros HTML, sin secretos en `src/`), 5 (cambios de `ci.yml`: SHA, versión fija, sin secretos), 1 (no se confía en el rol del cliente para mostrar datos). Las categorías 3, 6, 7 y 8 no tienen cambios relevantes en este ítem.
