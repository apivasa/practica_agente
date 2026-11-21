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

---

## Re-revisión V-05b + V-05c (SHA 86b447c)
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva:
- En push, `verify` espera al run de `ci.yml` del mismo commit (`scripts/ci/wait-ci.sh`). Usa el `github.token` con `actions: read`, solo en `verify`.
- `db-url.sh` apaga xtrace al entrar en `supabase_db_url` y no lo vuelve a activar.

Pruebas de seguridad añadidas: `tests/security/deploy-v05c.test.js`, con 65 casos de categoría 5. Todos pasan con `node --test`, sin red y sin dependencias. Las pruebas se ejecutan de verdad: `wait-ci.sh` y `db-url.sh` corren con bash y un `gh` falso en PATH.
- **Inyección en la entrada (20 casos):**
  - 8 `HEAD_SHA` hostiles: vacío, 39 o 41 hex, mayúsculas, `&branch=evil`, `$(…)`, salto de línea y un ref.
  - 8 `GITHUB_REPOSITORY` hostiles: query, fragmento, ruta extra, espacio, salto de línea y `$(id)`.
  - 4 topes o intervalos hostiles.
  - En todos falla sin llamar a `gh`. Además, la URL consultada es exactamente `head_sha=<sha>&event=push&branch=main`.
- **Workflow impostor (10 casos):**
  - Un run en success de `ci.yaml`, `ci.yml.bak`, `ci.yml-evil`, `xci.yml`, `CI.yml`, `evil/.github/workflows/ci.yml`, `seguridad.yml` o `deploy.yml` no abre la compuerta.
  - Un impostor con id mayor no tapa un CI real en failure.
  - Un success viejo no tapa un rerun en failure.
- **Solo `success` abre (24 casos):**
  - Bloquean el despliegue `failure`, `cancelled`, `timed_out`, `skipped`, `neutral`, `action_required`, `stale`, `startup_failure`, `null`, `""` y `SUCCESS`.
  - También lo bloquean los status distintos de `completed` aunque `conclusion` diga success.
  - Si la API falla, devuelve HTML, `{}`, una lista vacía o nada, el despliegue falla cerrado.
- **Token (2 casos):**
  - Un `gh` que vuelca `GH_TOKEN` por stderr y en el cuerpo no lo hace llegar al log.
  - El script no tiene xtrace, `eval` ni escrituras a `GITHUB_ENV`/`GITHUB_OUTPUT`.
- **Estructura de `deploy.yml` (5 casos):**
  - El paso de la compuerta no tiene `if:` ni `continue-on-error`, y no admite `${{ }}` en `run:`. `HEAD_SHA` sale de `github.sha` y no hay overrides de `CI_WAIT_*`.
  - Nadie redefine `GITHUB_EVENT_NAME`, `GITHUB_REPOSITORY`, `GITHUB_SHA` ni `GITHUB_REF`.
  - `actions: read` aparece solo en `verify` y no hay ningún permiso de escritura salvo los de Pages.
  - La cadena de `needs` sigue intacta, sin `always()`.
  - Solo disparan `push` y `workflow_dispatch`, y `ci.yml` corre en todo push a `main` sin filtro de rutas. Si `ci.yml` filtrara rutas, el despliegue esperaría un CI que nunca llega; hoy fallaría cerrado.
- **Traza en `db-url.sh` (4 casos):**
  - Con `set -x`, el comando posterior que usa `$SUPABASE_DB_URL` no se traza.
  - Con `SHELLOPTS=xtrace` heredado y con `BASH_XTRACEFD` desviado a stdout, la contraseña no sale por ningún canal.
  - `migrate-plan` y `migrate` no reactivan la traza.

Valoración de no restaurar xtrace: es correcto y más seguro que restaurarlo. Si la traza se restaurara, la línea siguiente (`supabase db push --db-url "$SUPABASE_DB_URL"`) se trazaría con la URL expandida. Solo la taparía `::add-mask::`, y la máscara depende de que el runner ya haya procesado la línea. El único efecto es que el resto del paso pierde la traza, y ningún paso la usa. Queda cubierto por la prueba "con xtrace, el comando que usa $SUPABASE_DB_URL después tampoco se traza".

Compuerta de CI: el despliegue no corre cuando el CI está en rojo, cancelado, ausente o sin terminar.
- La consulta fija `head_sha`, `event=push` y `branch=main`, y filtra por la ruta exacta `.github/workflows/ci.yml`. Decide el último run (id mayor); un rerun conserva el id y refleja el último intento.
- Cualquier conclusión distinta de `success`, un timeout de 20 min o errores persistentes de la API hacen fallar `verify`. Con eso no corre ni build, ni `db push`, ni Pages.
- Si llegan dos merges seguidos, `ci.yml` (`cancel-in-progress`) cancela el CI del primero: su despliegue falla y despliega el segundo, que lo contiene.
- Con disparo manual no se espera al CI. Es una decisión explícita de quien escribe `desplegar`, el mismo actor de antes.

`vars.SUPABASE_DB_POOLER_HOST`: sigue validada por regex en `verify` y otra vez en `db-url.sh`. Un valor hostil (otro host, puerto, `user@`, salto de línea, `$(…)`) no construye la URL, así que la contraseña no sale hacia otro host (61 casos de `deploy-v05b.test.js`, todavía en verde).

Resultados del pipeline:
- **Local:** `deploy-v05b`, `deploy-v05c`, `wait-ci-v05c`, `db-url-v05b`, `workflows/deploy` y `qa-v05b`: 326 pruebas, 0 fallan.
- **Sobre 86b447c:**
  - Seguridad (gitleaks, semgrep, npm audit, ZAP, pentest RLS/API): success, https://github.com/apivasa/practica_agente/actions/runs/44868418993
  - CI: success, https://github.com/apivasa/practica_agente/actions/runs/44868418987
- **Sobre b285778** (commit posterior de otro revisor en la rama): Seguridad y CI en curso al escribir esto (runs 44870030077 y 44870030035).
- No se lanzó nada contra producción.

Hallazgos:
- **H-V05c-01 · Baja · 5 · `deploy.yml` › `verify`.**
  - Problema: un run viejo de despliegue relanzado republica el `dist/` de un commit anterior, porque `verify` no comprueba que `github.sha` siga siendo la punta de `main`.
  - Cómo se reproduce: el commit A se despliega, luego B se despliega, y después se pulsa *Re-run* en el run de A. El mensaje de timeout de `wait-ci.sh` invita a relanzar.
  - Corrección sugerida: en push, comparar `HEAD_SHA` con `gh api repos/$GITHUB_REPOSITORY/commits/main --jq .sha`.
  - No es Alta: requiere escritura en el repo y una acción deliberada. Si B trajo migraciones, `db push` falla antes de Pages.
- **H-V05c-02 · Info · 5 · `scripts/ci/wait-ci.sh`.**
  - El script exime de la espera a cualquier evento distinto de `push`, en lugar de eximir solo a `workflow_dispatch`.
  - El filtro jq no vuelve a comprobar `head_sha`, `head_branch` ni `event` de cada run.
  - Hoy no es explotable: no hay otros disparadores y la API aplica los filtros. Se acepta como defensa en profundidad.
- **H-V05b-01 (Media) → mitigado en parte.** El gate de CI ya existe. Siguen abiertos `main` sin ruleset (usuaria) y que `deploy.yml` no espera a `seguridad.yml`.
- **H-V05b-02 → Corregido.**

Verificado sin hallazgos:
- **Compuerta CI:** no se salta con CI rojo, cancelado, ausente o impostor.
- **Inyección:** por SHA, repositorio y tope.
- **Fugas:** ni `GH_TOKEN` ni la contraseña de la BD se trazan, tampoco con xtrace.
- **Permisos:** mínimos. `actions: read` solo en `verify`, y ninguna escritura salvo Pages.
- **Expresiones `${{ }}`:** ninguna en `run:`.
- **Acciones:** fijadas por SHA (sin cambios).
