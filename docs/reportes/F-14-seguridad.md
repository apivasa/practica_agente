# F-14 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. No hay endpoints, tablas, permisos ni workflows nuevos. El cambio endurece el check `deploy-main` de `salud.yml` (`scripts/health/lib.js`): `isolatedFailure` limita el `warn` a un fallo aislado (corrige H-F13-01) y `parseApiTime` rechaza timestamps que no son texto o que pasan de now + `FUTURE_SKEW_MIN` (5 min) dentro de `newerPendingRun` (corrige H-F13-02).

## Pruebas de seguridad añadidas

`tests/security/health-deploy-f14.test.js`: 31 casos, todos de la categoría 5 (automatizaciones). Corren aquí con `node --test` y en CI en el job `pruebas de seguridad (tests/security)` de `seguridad.yml`.

- **H-F13-01, cadenas de fallos (12 casos).** Un control (fallo aislado más pendiente da `warn`). Luego cadenas que tienen que dar `fail`:
  - dos o cuatro `failure` seguidos;
  - un `cancelled`, `skipped` o `neutral` entre dos fallos;
  - un anterior en `timed_out`, en `startup_failure`, con `conclusion` null o con `conclusion` de tipo raro;
  - un `success` de otro evento, que no rompe la cadena.

  También se prueba que `isolatedFailure` falla cerrado si el fallo no está en la lista.
- **H-F13-02, timestamps (16 casos).** Pendientes que no pueden cubrir un fallo:
  - `created_at` 10 h en el futuro, o justo pasado el margen;
  - `run_started_at` en el futuro;
  - `created_at` numérico, `Date`, objeto con `toString` o vacío;
  - `run_started_at` numérico, objeto o ilegible;
  - pendiente anterior al fallo, de `pull_request` o con un `status` desconocido.

  Además: un fallo con `created_at` ilegible o futuro, la tabla de `parseApiTime`, la cota del margen (15 min como máximo) y `newerPendingRun` con entradas nulas.
- **Runs ausentes o malformados (3 casos).** Una entrada `null` en la lista, una basura en medio de una cadena y un `listRuns` que lanza: `checkDeploy` da `fail`.

Regresión local: `tests/scripts/f14-fixes.test.js`, `health-deploy-f13.test.js` y `health-deploy-v04b.test.js` pasan los 80 casos.

## Resultados del pipeline

Run de Seguridad sobre 2cf70c8, que ya incluye `health-deploy-f14.test.js`: https://github.com/apivasa/practica_agente/actions/runs/44901648291. Los runs anteriores sobre 637a7a2 y e8c0961 se cancelaron porque llegaron pushes más nuevos.

| Paso | Resultado |
|---|---|
| pruebas de seguridad (`tests/security`) | success |
| gitleaks (historial completo) | success |
| semgrep (JS, secretos, Actions, SQL) | success |
| CodeQL (actions, javascript-typescript) | success |
| npm audit (producción) | success |
| pentest API (PostgREST/Auth, Supabase local) | success |
| DAST (e2e de seguridad + ZAP baseline) | success |
| S-05 fases A y B | skipped (no se disparan en este evento) |

## Hallazgos

- **H-F14-01 · Info · 5 · `scripts/health/lib.js`, `assessDeploy` (orden de `relevant` y cálculo de `stuck`).**
  - Qué pasa: `parseApiTime` solo se usa en `newerPendingRun`. El orden y el `stuck` siguen con `Date.parse` crudo.
  - Efectos: un `success` con `created_at` 10 h en el futuro se ordena primero y da `ok` aunque detrás haya dos `failure`. Un `created_at` null deja el comparador en NaN y el resultado depende del orden de entrada.
  - Cómo reproducir: `assessDeploy(DEPLOY_RULE, { workflow: { state: 'active' }, runs: [success con created_at = now + 10 h, failure hace 60 min, failure hace 400 min], now })` devuelve `ok`.
  - Por qué no es explotable: estos campos los genera la API de GitHub en ISO 8601 y nadie con acceso al repo los controla. El hallazgo está fuera del diff de F-14 (es código anterior).
  - Corrección sugerida: ordenar con `parseApiTime` (los NaN al final) y tratar como `fail` un run con un timestamp inválido o futuro.
  - Estado: registrado en `docs/seguridad/hallazgos.md`, sin ítem.

Comportamiento por diseño, no es hallazgo: un único fallo sin despliegue anterior en la página (primer despliegue, o historial fuera de los 20 runs) se considera aislado y da `warn` si hay un pendiente nuevo. El pendiente tiene que ser real, posterior al fallo y estar dentro de `maxPendingMin`. Si se atasca o falla, la siguiente corrida alerta.

Docs: `docs/seguridad/hallazgos.md` (H-F13-01 y H-F13-02 corregidos, H-F14-01 nuevo) y `docs/seguridad/modelo-amenazas.md` (T-F14-01).

## Verificado sin hallazgos

- **Cat. 5.** No queda ningún falso verde por cadena de fallos, timestamps manipulados, tipos raros ni runs nulos dentro del diff. El aviso sigue llevando solo `status`, `conclusion` y `html_url`. No hay workflows nuevos.
- **Cat. 6.** No hay dependencias nuevas ni literales con forma de secreto en el diff.
- **Cat. 1–4, 7 y 8.** No aplican: el ítem no toca BD, Auth, entradas de usuario, front ni auditoría.
