# V-05 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: `.github/workflows/deploy.yml`, manual con `confirm = desplegar`, con la cadena verify → build-pages → migrate-plan → migrate → deploy-pages → smoke. Es la primera vez que un workflow usa `SUPABASE_ACCESS_TOKEN` y `SUPABASE_DB_PASSWORD` y escribe en la BD real (`supabase db push`) y en Pages. Además, `environment: produccion` en `evaluacion-mensual.yml` y `ritmo-diario.yml`. Modelo de amenazas: T-PROD-03..05 y T-CI-10 (`docs/seguridad/modelo-amenazas.md`).

Revisado sobre `origin/item/V-05` en `73a679e`.

## Pruebas de seguridad aplicadas
- `tests/security/preprod-s05.test.js` (S-05) incluye un caso dedicado a `deploy.yml` que se activa cuando existe. Lo ejecuté sobre el árbol de V-05 y pasan todos los casos de configuración y de workflows, incluidos los 4 por workflow aplicados a `deploy.yml`:
  - `VITE_*` solo recibe la URL y la clave publicable.
  - `db push`/`link` van sin `--include-seed`, sin `--debug` y sin contraseña en la línea de comandos.
  - Los jobs con `SUPABASE_ACCESS_TOKEN` o `SUPABASE_DB_PASSWORD` declaran `environment: produccion` y ningún workflow con esas credenciales se dispara por PR.
  - `deploy.yml` es manual, comprueba `refs/heads/main`, valida `sb_publishable_*` y busca `sb_secret_…` en `dist/`.
  - Los 3 fallos de esa ejecución son los jobs `s05-*` de `seguridad.yml`, que todavía no existen en esta rama. Es lo esperado: llegan con S-05.
- `tests/security/workflows.test.js` (S-01/C-03) pasa en el árbol de V-05: SHA fijados, `permissions` explícitos, inputs solo por `env`, nada impreso, `SUPABASE_SECRET_KEY` solo con schedule/dispatch y con guarda.
- `tests/security/static-secrets.test.js` pasa.
- No añado pruebas nuevas en V-05: las del ítem ya están en S-05 (`preprod-s05.test.js` › deploy.yml) y en las de QA (`tests/workflows/deploy.test.js`).

## Resultados del pipeline
- Seguridad en `73a679e`, [run 44662912815](https://github.com/apivasa/practica_agente/actions/runs/44662912815): **verde** (gitleaks, semgrep, npm audit, CodeQL, `security-tests`, `pentest-api` y DAST).
- CI en `73a679e`, [run 44662912915](https://github.com/apivasa/practica_agente/actions/runs/44662912915): **rojo**, por motivos de QA y no de seguridad. `tests/workflows/deploy.test.js` sigue esperando el orden anterior (verify → migrate → build-pages) y los 6 secretos en `verify`, incluida `SUPABASE_SECRET_KEY`. Localmente fallan 5 de sus 47 casos. Le toca al tester actualizarlos: el código actual es el correcto desde el punto de vista de seguridad (H-S05-06).
- ZAP y pentest contra producción: fase B de S-05, después del primer despliegue.

## Verificado sin hallazgos
- **H-S05-06 corregido:** ningún job de `deploy.yml` lee `SUPABASE_SECRET_KEY`.
- **H-C03-02, parte de código corregida:** los dos jobs programados declaran `environment: produccion`. Falta la parte de la usuaria (ver abajo).
- **H-S05-01, aplicado como guarda:** `verify` lee `/auth/v1/settings` con la clave publicable y para el despliegue si `disable_signup` ≠ true, antes de tocar la BD. Falla cerrado: si no puede leer los settings, también para.
- **Origen de producción:** `SUPABASE_URL` debe ser igual a `PRODUCTION_SUPABASE_ORIGIN` de `src/security/csp.js`. Si los secretos apuntan a otro proyecto, el despliegue para antes de migrar.
- **Orden seguro:** el build y la verificación de `dist/` (CSP sin loopback, `upgrade-insecure-requests`, sin `sb_secret_`, sin `:54321`) van antes del `db push`, que es irreversible. Hay un dry-run en `migrate-plan` y otro justo antes de aplicar. Si `produccion` tiene revisor requerido, la aprobación llega con el plan ya visible.
- **Sin semilla:** `db push` no lleva `--include-seed` (H-F03-07) ni `--debug`.
- **Mínimo privilegio:** `permissions: contents: read` por defecto; `pages: write` e `id-token: write` solo en `deploy-pages`; `smoke` con `permissions: {}`; checkout con `persist-credentials: false`; acciones fijadas por SHA; `npm ci --ignore-scripts`.
- **Inyección en Actions:** `inputs.confirm` llega solo por `env` y se compara de forma literal.
- **Secretos en logs:** solo se comprueba si están vacíos o tienen el formato correcto; nunca se imprime un valor.

## Hallazgos
- **H-V05-01 · Media · 5/6 · `deploy.yml` (`migrate-plan`, `migrate`, `verify`) · `SUPABASE_ACCESS_TOKEN`.**
  - El token personal de Supabase (`sbp_…`) vale para toda la cuenta, no solo para este proyecto: da acceso por la Management API a todos los proyectos de la cuenta. P-02 dice que el proyecto `KPIs` está separado del de Café & Tinta, pero no si están en cuentas distintas.
  - Si el token se filtra (un workflow de una rama mientras el environment no tenga regla de ramas, o una acción comprometida), el daño llega a recursos fuera del alcance de esta app.
  - Además, `verify` recibe el token y `SUPABASE_DB_PASSWORD` solo para comprobar que no están vacíos.
  - Cómo se reproduce: lectura del workflow. Con el token, `supabase projects list` lista todos los proyectos de la cuenta.
  - Corrección sugerida al desarrollador, sin cambiar el diseño:
    - `supabase db push --db-url "$SUPABASE_DB_URL"` (cadena del pooler con la contraseña de la BD) en lugar de `link` con el token; así desaparece el `SUPABASE_ACCESS_TOKEN`.
    - Mientras tanto, quitar el token y la contraseña de `verify` y comprobar su presencia en los jobs que los usan.
  - Alternativa de la usuaria: una cuenta u organización de Supabase dedicada a este proyecto. Crear o rotar secretos es compuerta de la usuaria.
  - No bloquea: los jobs están en `produccion` y el despliegue es manual.
- **H-C03-02 · Media · 5 · configuración del repositorio. Sigue abierto, parte de la usuaria.** `environment: produccion` solo protege si el environment existe con regla de ramas = `main` y los secretos viven ahí, no en el repo. Si no existe, GitHub lo crea sin protección la primera vez. Antes del primer despliegue hay que crear `produccion` con la regla `main`, mover los 6 secretos y borrar los del repo. El paso informativo de `s05-fase-b` imprime `deployment_branch_policy`.
- **H-V05-02 · Baja · operación · `evaluacion-mensual.yml`, `ritmo-diario.yml`.** Si la usuaria añade un revisor requerido a `produccion` para frenar el `db push`, también quedan esperando aprobación los jobs programados, el diario incluido, y el candado se aplicaría tarde. Opciones: no poner revisor y confiar en la regla de ramas más `confirm`, o usar un environment aparte (`produccion-deploy`) con revisor solo para `migrate`. Decisión de arquitectura y operación.
- **H-S05-01 · Media · panel de Auth. Abierto hasta el primer despliegue, de la usuaria.** El despliegue ya comprueba el registro cerrado. La Site URL, las redirecciones y la política de contraseñas del panel no se pueden leer con la clave publicable: van en la lista de requisitos previos de `docs/despliegue.md`, y la fase B mide `jwt_expiry` en modo `roles`.

## H-S03-02 (`minimum_password_length = 12`)
**Recomiendo hacerlo ya, dentro de V-05 o como un `fix/` pequeño del desarrollador. No bloquea.**
- Es una línea en `supabase/config.toml`: `[auth] minimum_password_length = 12` y `password_requirements = "lower_upper_letters_digits"`.
- No rompe nada: todas las contraseñas del repo cumplen (`Local-Only-Pass-2026` del seed y de `tests/security/api/_lib.js`, `Otra-Pass-Local-2026` en `e2e/login.spec.js`, `Pentest-Signup-2026!` y `x-Pentest-2026` en `auth-jwt.test.js`). El seed inserta los usuarios por SQL y no pasa por la validación.
- Hacerlo en local alinea el entorno de pruebas con lo que debe tener producción.
- El control que de verdad protege es el ajuste equivalente del panel del proyecto real, porque `config.toml` no se aplica a producción (H-S05-01). Ese ajuste es tarea de la usuaria antes de dar de alta usuarios reales.
