# V-04b — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: check `deploy-main` en `scripts/health/lib.js` (`DEPLOY_RULE`, `assessDeploy`, `checkDeploy`) y `scripts/health/check.js` (estado `warn` → `::warning::aviso`). Lee `GET /repos/{repo}/actions/workflows/deploy.yml` y `.../runs?branch=main&per_page=20` con el `GITHUB_TOKEN` del job `check` de `salud.yml` (`contents: read`, `actions: read`, sin cambios). Imprime en el log y en `$GITHUB_STEP_SUMMARY` un detalle con `status`, `conclusion` y `html_url` del run. El issue `salud` (job `alert`) no cambia: solo nombres de check y enlace al run de salud. Amenaza nueva T-JOB-12 en `docs/seguridad/modelo-amenazas.md`.

Pruebas de seguridad añadidas: `tests/security/health-deploy-v04b.test.js` — 28 casos, todos en categoría 5 (automatizaciones):
- Inyección de comandos de workflow / markdown / HTML desde `display_title`, `name`, `head_branch`, `head_commit.message`, `actor` en runs `success`, `failure` y `cancelled`: no llegan a log, summary, `$GITHUB_OUTPUT` ni issue (5).
- Runs de otros eventos (`pull_request`, `pull_request_target`, `workflow_run`, `repository_dispatch`, `schedule`; p. ej. fork con rama `main`) no provocan falso fallo ni tapan uno real (5).
- `warn` no oculta fallos: cancelado tras fallo, cancelado con run atascado, `skipped`/`neutral` encima de `failure`, conclusiones desconocidas (`timed_out`, `startup_failure`, `action_required`, `stale`, otra) fallan, código de salida 1 si otro check falla (10).
- Token: no aparece en log/summary/output/detalle con 401 y cuerpo que lo contiene; solo viaja en `Authorization` hacia `api.github.com`, nunca en la URL; error de fetch recortado (3).
- Permisos de `salud.yml`: raíz `contents: read`; `check` solo `contents`/`actions` en lectura; `alert` solo `contents: read` + `issues: write`; sin `pull_request*` ni clave secreta; `alert` solo recibe `FAILURES`, `RUN_URL` y el token (5).

Resultados locales: `node --test 'tests/security/*.test.js' 'tests/scripts/*.test.js'` → 840 pruebas, 837 pasan, 0 fallan, 2 omitidas condicionales previas (requieren `dist/`, corren en `seguridad.yml` › security-tests) y 1 `todo` previo (H-C04-QA-01). Ninguna prueba desactivada por este ítem.

Resultados del pipeline: gitleaks · semgrep · npm audit · ZAP · pentest RLS/API corren en `seguridad.yml` sobre el PR de `item/V-04b`. El ítem no toca BD, front ni dependencias: el riesgo para esos jobs es nulo y la revisión de este informe se basa en las pruebas locales anteriores.

Hallazgos:
- H-V04b-01 · Baja · 5 · `scripts/health/check.js:47` y `assessDeploy` en `scripts/health/lib.js`: el detalle se imprime sin quitar CR/LF ni `::`. Con un `conclusion` o `html_url` simulado que traiga `\n::error::x`, la línea inyectada llega al log como comando de workflow. Hoy no es explotable porque GitHub genera esos campos (valores enumerados y URL con id numérico) y los campos que controla un atacante no se usan. Corrección sugerida: sanear `detail` en `result()` (CR/LF → espacio, neutralizar `::` y `%`) y validar `html_url` contra `^https://github\.com/<owner>/<repo>/actions/runs/\d+$`. Registrado en `docs/seguridad/hallazgos.md`.

Verificado sin hallazgos: 5 (inyección desde campos controlables, falsos positivos o negativos por runs de fork u otros eventos, `warn` que no oculta fallos, fuga del token, permisos mínimos de `salud.yml`, issue sin detalles). Las categorías 1–4 y 6–8 no aplican: el ítem no toca BD, Auth, front, dependencias ni datos.
