# S-01 — Informe de arquitectura y salud
Veredicto: ROJO
Alineado al diseño: sí (stack intacto: solo GitHub Actions; no toca front, Supabase ni `engine/`)
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0007-pipeline-seguridad.md` (nuevo, Aceptado); `docs/adr/0004-disparadores-ci.md` (punto 3: endurecimiento de `lockfile.yml` y disparo de `seguridad.yml`)
Salud: CI run 44597648985 `success` (build 16 s, db 69 s, e2e 26 s; ~70 s de pared, sin regresión frente a 44594674729: 23/74/26 s). Seguridad run 44597649643 `success` (~50 s de pared, CodeQL JS 50 s es el más largo). Único fallo de Seguridad en la rama (44595333304) causado por la rama de ensayo y corregido. Sin pasos intermitentes. `salud.yml`, `evaluacion-mensual` y `ritmo-diario` aún no existen; sin producción. Tiempos base y runbook iniciados en `docs/operacion.md`.

## Verificación de lo pedido
- **Acciones por SHA:** todas las `uses:` de `ci.yml`, `lockfile.yml` y `seguridad.yml` fijadas a SHA de 40 hex con `# vX`; Dependabot `github-actions` semanal las mantiene. Correcto.
- **CLI Supabase 3.2.0:** `version: latest` sustituido por versión fija; job `db` pasa con esa CLI. Correcto.
- **`npm ci --ignore-scripts` + `npm rebuild esbuild`:** build y e2e pasan (run 44597648985). Playwright instala navegadores con `npx playwright install`, no depende de postinstall. Correcto.
- **Ningún paso desactivado:** `ci.yml` conserva lint, `test:unit`, build, pgTAP, e2e y artefacto de Playwright; no hay `continue-on-error`, `|| true` ni `if:` que salte pasos. `test:unit` incluye ahora `tests/security/**` (más cobertura, no menos).
- **`lockfile.yml` solo en `item/**` y `fix/**`:** sigue regenerando cuando hace falta: `package.json` solo llega a `main` por PR desde esas ramas o por Dependabot (`dependabot/**`), que actualiza el lockfile él mismo. `ensayo/**` no lo necesita. Correcto, salvo el hallazgo 1.
- **`dependabot.yml`:** dos ecosistemas, semanal, lunes, America/Guayaquil. Sus PRs se validan por `pull_request` (no por `push`, que no incluye `dependabot/**`); suficiente.

## Hallazgos
1. **[Bloqueante, corregible en el ítem] `lockfile.yml` no relanza `seguridad.yml`.** `seguridad.yml` (jobs `npm-audit` y `security-tests`) usa `npm ci` sin fallback. Al cambiar `package.json` en una rama: el run de Seguridad del push falla por lockfile desincronizado, y el commit del bot (hecho con `GITHUB_TOKEN`) no dispara Seguridad; `lockfile.yml` solo lanza `ci.yml`. El orquestador vería Seguridad en rojo en la rama y gastaría un intento. Corrección en el paso "Lanzar CI sobre el commit del lockfile":
   ```
   gh workflow run ci.yml --ref "${GITHUB_REF_NAME}"
   gh workflow run seguridad.yml --ref "${GITHUB_REF_NAME}"
   ```
   y un caso en `tests/security/workflows.test.js` que exija ambos `gh workflow run`. (`seguridad.yml` ya tiene `workflow_dispatch` y el job tiene `actions: write`.)
2. **Rama atrasada respecto a `main`** (base `15edb12`; `main` añadió C-01, docs y ADR 0003). No hay cambios en `.github/` en `main`, así que no hay conflicto; el run `pull_request` del PR validará el merge.
3. **Baja · semgrep por `pip` sin hash** (`semgrep==1.185.0` sin `--require-hashes`). Riesgo residual aceptable para un repo de práctica; registrado en ADR 0007. Si se quiere cerrar, usar la imagen `semgrep/semgrep` fijada por digest.
4. **Workflow programado nuevo** (`seguridad.yml`, lunes 06:17 UTC = 01:17 Guayaquil). Cuando exista `salud.yml`, debe vigilarlo junto con `evaluacion-mensual` y `ritmo-diario`. GitHub desactiva `schedule` tras 60 días sin actividad en el repo: `salud.yml` también debe detectarlo.
5. **H-007 (configuración del repo)** secret scanning, push protection y Dependabot security updates desactivados: ya registrado por seguridad como pendiente del usuario; no bloquea.
6. **ADR 0004 estaba desactualizado** (permisos a nivel de workflow, disparo en `main`): actualizado en este informe.
