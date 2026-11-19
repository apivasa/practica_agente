# ADR 0007 — Pipeline de seguridad y cadena de suministro de CI

Estado: Aceptado (decisión técnica, 2026-11-19, ítem S-01; no contradice el diseño)

## Contexto
El diseño fija GitHub Actions para CI/CD y exige que el veredicto de seguridad bloquee el merge. Hace falta un pipeline propio y reproducible que no dependa de servicios con cuenta (el repo es de práctica y sin presupuesto) y que reduzca el riesgo de cadena de suministro en los propios workflows.

## Decisión
1. `.github/workflows/seguridad.yml` separado de `ci.yml`, con jobs paralelos: gitleaks (historial completo de la rama, `--log-opts="--full-history HEAD"`), semgrep (`p/javascript`, `p/secrets`, `p/github-actions`), `npm audit --omit=dev --audit-level=high` + `npm audit signatures`, CodeQL (`javascript-typescript` y `actions`, `security-extended`) y `node --test tests/security/*.test.js` con `dist/` construido.
2. Disparadores: `pull_request`, `push` a `main`, `item/**`, `fix/**`, `ensayo/**`, semanal (lunes 06:17 UTC) y manual.
3. Toda acción de terceros se fija por SHA de commit con comentario `# vX.Y.Z`; Dependabot (`.github/dependabot.yml`, semanal, lunes, America/Guayaquil) propone las subidas de `github-actions` y `npm`.
4. Herramientas fuera de Actions con versión fija: gitleaks 8.30.1 (binario verificado por sha256), semgrep 1.185.0 (pip), CLI de Supabase 3.2.0 (nunca `latest`). Se actualizan por PR revisado.
5. Instalación de dependencias con `--ignore-scripts`; solo `esbuild` se reconstruye (`npm rebuild esbuild`) porque Vite lo necesita. Si una dependencia nueva requiere script de instalación, se añade su `npm rebuild <pkg>` explícito en el mismo PR.
6. `persist-credentials: false` en todos los checkouts salvo `lockfile.yml`, que necesita el token para su `git push`.
7. Las reglas anteriores se hacen cumplir con `tests/security/workflows.test.js`, que corre en `ci.yml` (dentro de `test:unit`) y en `seguridad.yml`.

## Consecuencias
- Tiempo base del pipeline ~50 s en paralelo (CodeQL es el job más largo); no alarga el camino crítico de CI (~70 s, dominado por `db`).
- Dependabot abrirá PRs semanales; pasan por los mismos workflows vía `pull_request`.
- semgrep descarga reglas del registro en cada run: si el registro no responde, el job falla (ver `docs/operacion.md`).
- El workflow semanal cuenta como programado: `salud.yml` (cuando exista) debe vigilar que corrió. GitHub desactiva los `schedule` tras 60 días sin actividad en el repo.
