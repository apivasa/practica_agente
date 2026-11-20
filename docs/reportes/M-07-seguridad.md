# M-07 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ruta `#/gestora/metas` (rol `kpi_manager`) que crea y edita `targets.target_value` por (unidad, indicador, mes) desde `src/data/target-admin.js` (select, luego insert o update por id). Nuevas lecturas: `listIndicatorTargets` (`targets.js`, sigue de solo lectura) y `listIndicatorMeasurements` (`measurements.js`). Cambios en BD: ninguno. Modelo de amenazas: T-M07-01..05 (`docs/seguridad/modelo-amenazas.md`).

Revisado sobre `origin/item/M-07` en `04c90a4`.

## Pruebas de seguridad añadidas
- `supabase/tests/security/045_security_targets_m07.test.sql`: 22 casos.
  - Cat. 1: anon sin privilegios; sin TRUNCATE; custodio, comité, líder y usuario sin rol no crean, editan ni borran metas; IDOR del líder por id y con `or`; el líder no se apropia de la meta de otra unidad cambiando `unit_id`; la gestora crea y edita.
  - Cat. 3: meta negativa, mes inválido y mes con payload SQL rechazados por la BD; duplicado rechazado.
  - Cat. 8: la edición queda en `audit_log` y `audit_log` no es editable.
- `tests/security/front-v01-v03.test.js`: 2 casos nuevos (cat. 1 y 4).
  - Cubre la intención de la regla: solo `src/views/kpi_manager/targets.js` importa `target-admin.js` (recorre todo `src/`). `target-admin.js` solo toca `targets`, sin upsert, delete ni rpc, con un único `update({ target_value })` por id y sin claves.
  - La ruta `/gestora/metas` es `kpi_manager`: los otros roles se redirigen y sin sesión va a login.
  - Sin sumideros HTML en la vista, en `targets-form.js` ni en `target-admin.js`.
  - Se mantiene la prueba de solo lectura de `targets.js`.
- `e2e/security/xss.spec.js`: `#/gestora/metas` en el recorrido de la gestora (cat. 4). Los nombres de unidad con payload salen en la tabla y en el selector; nada se ejecuta y el texto aparece literal.
- `e2e/security/dashboards-v01-v03.spec.js`: el líder que abre `#/gestora/metas` vuelve a `#/lider` (cat. 1).

## Resultados del pipeline (en `04c90a4`)
- Seguridad, [run 44686846449](https://github.com/apivasa/practica_agente/actions/runs/44686846449): verde. Incluye gitleaks, semgrep, npm audit, CodeQL JS y Actions, `security-tests`, `pentest-api` (la matriz cubre `targets` por rol) y DAST (e2e de seguridad + ZAP baseline).
- CI, [run 44686846462](https://github.com/apivasa/practica_agente/actions/runs/44686846462): verde. En `db (pgTAP)`, `045_security_targets_m07.test.sql` da ok (21 archivos, 476 pruebas).

## Hallazgos
- **H-M07-01 · Baja · cat. 1/8 · `supabase/migrations/20261119120100_rls_policies.sql:89`.**
  - Qué pasa: `authenticated` tiene UPDATE de tabla en `targets`. La gestora, y solo ella (probado en 045), puede mover una meta existente a otra unidad, indicador o mes conservando `id` y `created_at`.
  - Reproducir: `PATCH /rest/v1/targets?id=eq.<id>` con `{"unit_id":"<otra unidad>"}` y el JWT de la gestora.
  - Por qué no es grave: no es escalada, porque la gestora ya puede borrar e insertar. Queda en `audit_targets` con old/new, y el front solo envía `{ target_value }` (lo fija la prueba estática).
  - Corrección (accionable por el desarrollador, en un ítem de endurecimiento): `revoke update on public.targets from authenticated; grant update (target_value) on public.targets to authenticated;` más un `has_column_privilege` en pgTAP. Registrado en `docs/seguridad/hallazgos.md`.

## Verificado sin hallazgos
- **Cat. 1:** RLS de `targets` por rol. La lectura de mediciones de la gestora es de la gestora. El módulo de escritura está aislado.
- **Cat. 3:** la validación del front (`buildTargetFields`) está duplicada en la BD con CHECK.
- **Cat. 4:** todo por `el()`/`textContent`; sin `innerHTML`.
- **Cat. 6:** sin dependencias nuevas.
- **Cat. 8:** auditoría de las metas.
- **No aplica:** cat. 2, 5 y 7, salvo el DAST verde.
