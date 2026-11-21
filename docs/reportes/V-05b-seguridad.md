# V-05b — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: `deploy.yml` se dispara solo en cada push a `main` que no sea solo documentación (`paths-ignore: docs/**, **/*.md`) y aplica migraciones y publica Pages sin `confirm`. Las migraciones ya no usan el token de cuenta: van por `supabase db push --db-url` al pooler de sesión. La cadena la arma `scripts/ci/db-url.sh` con `SUPABASE_DB_POOLER_HOST` (variable no secreta, validada por regex), el ref validado y la contraseña codificada con `jq @uri` y enmascarada. Además, `config.toml` fija la política de contraseñas.

Pruebas de seguridad añadidas: `tests/security/deploy-v05b.test.js`, con 61 casos, todos ejecutados con `node --test` y sin dependencias.
- 5 · Actions (58 casos):
  - **Disparadores:** push solo a `[main]`, sin tags, comodines ni `branches-ignore`. No hay ningún disparador con datos de terceros. `paths-ignore` se limita exactamente a la documentación y el build no consume `.md`. `concurrency` no cancela un despliegue.
  - **verify no se salta:** todos los jobs dependen de `verify` de forma transitiva, y no hay `continue-on-error`, `always()` ni pasos condicionales en `verify`.
  - **Eventos y refs:** 7 eventos distintos de `push`, incluidos `""` y `PUSH`, siguen exigiendo `confirm`. Se rechazan 5 refs hostiles (`refs/tags/v1`, `main-evil`, `feature/main`, `refs/pull/3/merge`, `main\n`) y los `confirm` casi iguales.
  - **Sin fugas ni globs:** un ref con `*` no casa con la URL, y `verify` no imprime secretos ni en éxito ni en error.
  - **db-url.sh, host y ref:** 12 hosts hostiles rechazados (salto de línea, puerto, ruta, `user@`, query, punto final, mayúsculas, `$(...)`, sufijos). Ninguno llega a construir la URL ni a emitir máscaras. También se rechazan 6 refs hostiles.
  - **db-url.sh, contraseñas:** 6 contraseñas hostiles (saltos de línea, `::add-mask::`, `::set-output`, `::stop-commands::`, comillas, `$(id)`, espacios). Se codifican sin inyectar comandos de workflow ni alterar host, usuario o puerto. La máscara de la contraseña sale antes que la URL, y el script no escribe en `GITHUB_ENV`/`GITHUB_OUTPUT` ni en ficheros.
  - **Trazas:** ni `deploy.yml` ni el script usan `set -x`, `bash -x`, `--debug`, `printenv` ni `ACTIONS_*_DEBUG`, y no hay `echo` de la cadena ni de la contraseña.
  - **Alcance de la contraseña:** solo la leen pasos `run`, nunca una acción de terceros ni un `env` de job o de workflow. Solo la tienen `verify`, `migrate-plan` y `migrate`, los tres con `environment: produccion` y `contents: read`.
  - **Credenciales retiradas:** no queda `SUPABASE_ACCESS_TOKEN`, `sbp_`, `supabase link`, `SUPABASE_SECRET_KEY` ni `config push`. `db push` no usa `--linked`, `--local`, `--include-seed` ni `--include-all`.
- 2 · Auth (8 casos):
  - **Registro cerrado:** se probó con un `curl` falso en PATH. Pasa solo con `disable_signup: true`. Bloquean el despliegue `false`, la clave ausente, `null`, un HTML, una respuesta vacía y un error de curl.
  - **Contraseñas:** `config.toml` exige mínimo 12 caracteres con `lower_upper_letters_digits`.
- Categorías 1, 3, 4, 6, 7 y 8: sin casos nuevos (el ítem no toca RLS, entradas, front, dependencias ni datos).

Modelo de amenazas: T-CI-10 actualizado en `docs/seguridad/modelo-amenazas.md`.

Resultados del pipeline:
- **Local (`node --test`):**
  - `tests/security/*.test.js` + `tests/scripts/db-url-v05b.test.js`: 615 pasan, 0 fallan y 2 se omiten. Las 2 omitidas ya existían y dependen de `dist/`; corren en `seguridad.yml`.
  - `deploy-v05b.test.js`: 61 de 61.
- **Seguridad sobre ae7de7c (gitleaks, semgrep, npm audit, ZAP, pentest RLS/API):** success, https://github.com/apivasa/practica_agente/actions/runs/44840478234
- **CI sobre ae7de7c:** failure, https://github.com/apivasa/practica_agente/actions/runs/44840478337. La causa son pruebas de V-05 en `tests/workflows/deploy.test.js` (dominio del tester) que aún esperan `workflow_dispatch` como único disparador y `SUPABASE_ACCESS_TOKEN`. No es un hallazgo de seguridad; las tiene que actualizar el tester.
- **Commit 8502e7d:** Seguridad y CI en curso cuando se escribió este informe (runs 44841037199 y 44841037161).
- No se lanzó ningún workflow contra producción.
- Comprobación de solo lectura en la API del repo: `GET branches/main/protection` → 404 *Branch not protected*; `GET rules/branches/main` → `[]`. No se pudieron consultar environments, secretos ni variables (403 del proxy).

Hallazgos:
- **H-V05b-01 · Media · 5 · protección de `main` + `deploy.yml` `on.push`.**
  - `main` no tiene protección de rama ni ruleset. Con el despliegue continuo, un push directo a `main` aplica `db push` y publica sin PR, sin revisión y sin esperar a CI ni a Seguridad: `deploy.yml` no depende de sus resultados.
  - El actor (alguien con escritura) es el mismo que ya podía usar `workflow_dispatch`; lo que desaparece es la parada humana y el gate de pruebas.
  - Cómo se reproduce: un push a `main` con un cambio fuera de `docs/`; las APIs citadas arriba.
  - Corrección sugerida (usuaria): un ruleset en `main` que exija PR y los checks de CI y Seguridad, que bloquee force-push y borrado, y con bypass solo si el orquestador lo necesita para `docs/estado.md`. Opcional (desarrollador): que `verify` compruebe por API que los check-runs del commit están en verde.
  - No es Alta: no da acceso a nadie nuevo, ni de fuera ni de forks.
- **H-V05b-02 · Baja · 5 · `scripts/ci/db-url.sh`.**
  - Con `set -x` activo, la traza imprime la contraseña codificada antes de registrar la máscara. Se reprodujo en local: 7 líneas.
  - Hoy no hay `set -x`, y `deploy-v05b.test.js` lo impide.
  - Corrección sugerida: `{ set +x; } 2>/dev/null` dentro de la función y restaurar la traza al salir.
- **H-V05b-03 · Info · 5 · `supabase db push --db-url "$SUPABASE_DB_URL"`.**
  - La contraseña va en el argv del proceso de la CLI, en un runner efímero.
  - Corrección sugerida: si la CLI lo admite, mandar la URL sin contraseña y la contraseña por `PGPASSWORD`. Aceptado.
- **H-V05b-04 · Baja · operación · `verify`.**
  - Hasta que exista `vars.SUPABASE_DB_POOLER_HOST` en `produccion`, cada push que no sea solo docs falla en `verify`. Es una falla segura: no migra ni publica.
  - El merge de este PR será el primer despliegue sin `confirm`: conviene crear la variable antes y tener el volcado previo de la BD.

Estado de los hallazgos previos en `docs/seguridad/hallazgos.md`:
- **H-V05-01 → Corregido.** Ningún job lee el token. La usuaria puede borrar el secreto `SUPABASE_ACCESS_TOKEN` (compuerta de secretos).
- **H-S03-02 → Corregido en local/CI.** En producción depende del panel (H-S05-01).
- **H-S05-06 → Corregido.**
- **H-C03-02 sigue abierto** (no verificable desde la sesión). Si los secretos de BD siguen también a nivel de repositorio, un workflow de otra rama que no declare `environment` podría leerlos. La regla de ramas de `produccion` solo protege los secretos del environment.

Verificado sin hallazgos:
- **Inyección:** inyección por host o ref, y comandos de workflow inyectados vía contraseña.
- **Disparos ajenos:** un PR, un fork, un tag o un push de otra rama no despliega ni recibe los secretos del environment (regla `main` confirmada por la usuaria en P-06).
- **Registro cerrado:** el disparo automático no se salta la comprobación.
- **Permisos:** mínimos (`contents: read`; `pages: write`/`id-token: write` solo en `deploy-pages`; `{}` en `smoke`).
- **Acciones:** todas fijadas por SHA. Las acciones de terceros no reciben la contraseña.
- **Expresiones `${{ }}`:** ninguna se interpola en `run:`.
- **`paths-ignore`:** no deja fuera código, migraciones ni workflows.
