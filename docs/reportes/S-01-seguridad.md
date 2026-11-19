# S-01 — Informe de seguridad (constructor: seguridad)
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: workflow `.github/workflows/seguridad.yml` (PR, push a `main`/`item/**`/`fix/**`/`ensayo/**`, lunes 06:17 UTC y manual; `contents: read`, `security-events: write` solo en CodeQL); `.github/dependabot.yml` (github-actions y npm, semanal); endurecimiento de `ci.yml` y `lockfile.yml` (H-001..H-005). No toca código de la app.

Pruebas de seguridad añadidas:
- `tests/security/workflows.test.js` — 29 casos. Categoría 5 (por cada workflow: `permissions` explícito sin `write` a nivel de workflow, `uses:` por SHA de 40 hex con `# vX`, sin `pull_request_target`/`workflow_run`, sin expresiones de datos del evento, sin `version: latest`, `persist-credentials: false` salvo `lockfile.yml`, sin imprimir secretos ni `set -x`; `lockfile.yml` solo en ramas de trabajo con `permissions: {}`; `security-events: write` solo en CodeQL; disparadores y herramientas presentes en `seguridad.yml`, sin `continue-on-error` ni `|| true`). Categoría 6 (`npm ci/install --ignore-scripts`, Dependabot para ambos ecosistemas, gitleaks con checksum y `fetch-depth: 0`). Verificado por mutación: con el `ci.yml` de `main` fallan 4 casos (SHA, `latest`, scripts, credenciales).
- `tests/security/static-secrets.test.js` — 3 casos. Categorías 4 y 6: autoverificación de patrones (clave `sb_secret_`, JWT legado, tokens de GitHub, PEM, AWS, nombre de variable secreta; la clave publicable no se marca), `src/`, `engine/`, `index.html`, `vite.config.js` y `.env.example` sin secretos, y `dist/` sin secretos (obligatorio en `seguridad.yml`, que construye antes con `SECURITY_REQUIRE_DIST=1`).
- Total local: 57 casos en `tests/security/` (32 nuevos + 25 de M-01), 57 pasan.

Resultados del pipeline (rama `item/S-01`, commit `442bfe8`):
- Seguridad run 44596743636 — success: gitleaks (41 commits, sin fugas), semgrep 1.185.0 (116 reglas sobre 48 archivos, 0 hallazgos), npm audit `--omit=dev --audit-level=high` + `npm audit signatures`, CodeQL `javascript-typescript` y `actions` (security-extended), pruebas de seguridad. https://github.com/apivasa/practica_agente/actions/runs/44596743636
- CI run 44596743552 — success (build, db pgTAP con CLI 3.2.0, e2e). https://github.com/apivasa/practica_agente/actions/runs/44596743552
- ZAP y pentest RLS/API: no aplican en S-01 (llegan con S-02/S-03 y S-05).

Criterio de aceptación — ensayo de secreto (rama `ensayo/s01-secreto`, no se fusiona):
- `9ffa8b4` siembra `ensayo-secreto.env.txt` con un `ghp_` de 36 caracteres generado al azar (no real). Seguridad run **44595353195**: falla solo `gitleaks` (`RuleID: github-pat`, `leaks found: 1`); el resto de jobs pasa.
- `1e436ba` retira el archivo: el run 44596157187 sigue fallando, porque gitleaks revisa todo el historial de la rama (comportamiento deseado).
- `10add92` (merge con la corrección de abajo): run 44596748478 falla en gitleaks.
- PR/rama limpia pasa: run 44596743636 en `item/S-01`, ejecutado mientras la rama de ensayo existe en el remoto.
- La rama `ensayo/s01-secreto` queda en el remoto: **la debe borrar el dueño** (`git push origin --delete ensayo/s01-secreto`). Mientras exista, sus runs fallan, lo cual es esperado.

Hallazgos:
- Corregido durante el ítem (habría sido Media · 5): con `fetch-depth: 0` el checkout trae todas las ramas remotas y gitleaks usa por defecto `git log --all`; el secreto de la rama de ensayo hizo fallar también `item/S-01` (rerun del run 44595333304, job 135815017056). Ahora se escanea `--log-opts="--full-history HEAD"` (historial completo de la rama o del merge del PR) y una prueba lo exige.
- H-007 · Baja · 6 · configuración del repo · secret scanning, push protection y Dependabot security updates están `disabled` (`gh api repos/apivasa/practica_agente --jq .security_and_analysis`); alertas de Dependabot dan 403. Corrección: el dueño los activa en *Settings → Code security* (gratis en repo público). Pendiente del usuario.
- H-008 · Baja · 6 · `seguridad.yml` job `gitleaks` · el sha256 del binario viene del `checksums.txt` de la misma release. Riesgo residual aceptado; actualizar versión y hash juntos por PR.
- H-001..H-005 → Corregido en `docs/seguridad/hallazgos.md`.

Verificado sin hallazgos: 5 (Actions: permisos mínimos, SHA, sin `pull_request_target`, sin inyección de expresiones, sin secretos en logs), 6 (secretos en historial, SAST, CodeQL, dependencias de producción, firmas del registro), 4 (secretos en `src/` y `dist/`). Categorías 1, 2, 3, 7, 8: no aplican a este ítem.

Versiones fijadas: actions/checkout v7.0.1 `3d3c42e5…`, actions/setup-node v7.1.0 `949feb24…`, actions/upload-artifact v7.0.2 `cf430e03…`, actions/setup-python v7.1.0 `6d4fd22b…`, supabase/setup-cli v3.2.0 `689adcfb…` (CLI 3.2.0), github/codeql-action v4.39.3 `33d7b85d…` (commit del tag anotado), gitleaks 8.30.1, semgrep 1.185.0.
