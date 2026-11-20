# V-04 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: workflow `salud.yml` (cron cada 6 h y `workflow_dispatch` sin inputs) con dos jobs. `check` tiene `actions: read` y usa la clave publicable contra `/auth/v1/health` y un GET a Pages. `alert` tiene `issues: write`, no recibe secretos y abre o comenta un issue público con la etiqueta `salud`. Lo acompañan `scripts/health/{lib,check,issue}.js` y `scripts/ci/health.sh`, un paso nuevo en `ci.yml` › integration que solo corre contra Supabase local. El modelo de amenazas tiene una sección nueva: «4.1 Workflow de salud», con T-HEALTH-01..08.

Pruebas de seguridad añadidas: `tests/security/health-v04.test.js` (22 casos)
- 2 · Autenticación y claves (6): una `sb_secret_` puesta en `SUPABASE_PUBLISHABLE_KEY` no se envía. Supabase solo recibe `apikey` publicable y Pages no recibe cabeceras. El token no aparece en los errores de la API. `GITHUB_REPOSITORY` con `/`, `?`, `#`, espacio o salto de línea se rechaza. `../x` no saca el token del host. Los nombres de workflow y los números de run o issue no cambian la ruta.
- 3 · Entradas e inyección (8): `parseFailures` con menciones, markdown, HTML, saltos de línea, mayúsculas y `%0a`. `issueBody` sin `@`, enlaces, imágenes ni HTML. `RUN_URL` hostil (7 variantes). `issue.js` de punta a punta, con el payload real enviado a la API saneado. `safeUrl` frente a `http` externo, IMDS `169.254.169.254`, `file:`, `data:`, `javascript:`, `gopher:` y `localhost.evil.com`. Una `PAGES_URL` no válida no genera petición.
- 5 · Automatizaciones (7): solo `schedule` y `workflow_dispatch` sin inputs. Permisos por job: `issues: write` solo en `alert`, `actions: read` solo en `check`. Acciones fijadas por SHA y `persist-credentials: false`. Sin `${{ }}` en `run:`. Sin `SUPABASE_SECRET_KEY` y sin más secretos que `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. Sin `github.event.*` ni `inputs.*`. Los runs se leen de `main` filtrados por evento (`ci.yml`→`push`, `seguridad.yml`→`schedule`).
- 8 · Fuga en logs y auditoría (2): se probó `check.js` completo con errores de red cuyo mensaje contiene la URL, la clave y el token, y con la API de GitHub devolviendo 500 con el token en el cuerpo. Ni el log, ni `GITHUB_OUTPUT`, ni `GITHUB_STEP_SUMMARY` contienen token, clave, URL ni ref de Supabase. `GITHUB_OUTPUT` queda en una sola línea `failures=[a-z0-9,-]*`. Cuando ya hay un issue abierto, se comenta en él en vez de crear otro.

Ejecución local: `node --test 'tests/security/*.test.js'` da 474 pass, 0 fail y 2 skip. Los 2 skip ya existían: necesitan `dist/` y corren en `seguridad.yml` › security-tests.

Resultados del pipeline (rama `item/V-04`, commit `0e8fd08`, antes de este informe):
- CI `success`: https://github.com/apivasa/practica_agente/actions/runs/44639874789. Incluye `scripts/ci/health.sh`, donde la caída simulada produce `failures=pages`.
- Seguridad `success` (gitleaks, semgrep, npm audit, CodeQL, ZAP baseline, pentest RLS/API): https://github.com/apivasa/practica_agente/actions/runs/44639874745
- `salud.yml` no se puede lanzar desde la rama, porque `workflow_dispatch` exige que el workflow exista en `main`. Su primer run real será después del merge.
- Las pruebas nuevas entran en el job `security-tests` (`node --test 'tests/security/*.test.js'`) del run que dispara este commit.

Hallazgos:
1. **H-V04-01 · Baja · 2/5 · `scripts/health/lib.js` `checkHttp` (`redirect: 'follow'`).**
   - Problema: el sondeo sigue redirecciones. Undici reenvía la cabecera `apikey` a otro origen (solo quita `Authorization`) y acepta pasar de `https` a `http`.
   - Reproducción: un servidor local A en 47111 responde 302 hacia B en `localhost:47112`, y `fetch` con `apikey` llega a B con `apikey=sb_publishable_x`.
   - Impacto: ninguno hoy. La clave es publicable, pública por diseño, y las URLs solo las edita un administrador en `vars` y `secrets`.
   - Corrección: `redirect: 'manual'` en el sondeo de Supabase, con 3xx tratado como falla. Para Pages, validar `res.url` con `safeUrl`.
   - Registrado en `docs/seguridad/hallazgos.md`.
2. **H-V04-02 · Info · 5 · `createGitHubClient` (regex de `repo`).**
   - Problema: `../x` pasa la regex y la ruta se normaliza a `/x/...` en `api.github.com`.
   - Impacto: el runner fija `GITHUB_REPOSITORY` y el host no cambia (probado), así que el token no sale de la API de GitHub. Aceptado.
   - Corrección opcional: rechazar los segmentos `.` y `..`.

Revisado y sin hallazgos:
- **Permisos mínimos:** `contents: read` global y permisos por job. `ensureLabel` usa el endpoint `/labels`, que funciona con `issues: write`.
- **Acciones fijadas por SHA:** son las mismas que en `ci.yml`. `persist-credentials: false` en los dos checkouts.
- **Expresiones `${{ }}`:** solo aparecen en `env:` y vienen de `github.token`, `vars`, `secrets`, `needs.check.outputs.failures`, que sale de nombres de check fijos, y de `github.server_url`, `repository` y `run_id`.
- **Disparadores:** no hay `pull_request`, `pull_request_target` ni `workflow_run`. Los workflows vigilados no tienen disparadores desde forks, así que nadie puede fingir un run verde en `main` (T-HEALTH-07).
- **Cuerpo del issue:** es texto fijo más nombres en `[a-z0-9-]` y una URL validada. No admite menciones ni markdown activo.
- **Tokens:** `GITHUB_TOKEN` solo va en `Authorization` hacia `GITHUB_API_URL`. Nunca se imprime y los errores llevan solo método, ruta y estado.
- **Clave secreta ausente:** no hay `SUPABASE_SECRET_KEY` ni `sb_secret_` en el workflow, los scripts ni `health.sh`. `health.sh` toma de `supabase status` solo `API_URL` y `PUBLISHABLE_KEY` locales, sin `set -x`, y rechaza URLs que no sean de loopback.
- **SSRF:** `safeUrl` solo admite `https`, o `http` hacia `127.0.0.1`, `localhost` o `[::1]`. Las URLs vienen de configuración de administrador y no de usuarios.
- **Spam o DoS:** con un issue abierto se comenta en él en vez de abrir otro, `concurrency: salud` y `timeout-minutes` en los dos jobs.

Verificado sin hallazgos: categorías 3 (inyección en el issue y en las salidas), 5 (salvo la Info H-V04-02) y 8. Las categorías 1, 4, 6 y 7 no se ven afectadas por el ítem: no hay tablas nuevas, el front no cambia, no hay dependencias nuevas (solo Node nativo) y ZAP baseline está en verde.
