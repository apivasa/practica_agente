# fix-deploy-linked — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. `supabase db push --dry-run`, `db push` y `migration list` en `.github/workflows/deploy.yml` pasan a `--remote` (CLI 3.2.0 apuntaba por defecto al stack local 127.0.0.1:54322).
Pruebas de seguridad añadidas: ninguna nueva (categoría 5 cubierta por las 2 pruebas nuevas de `tests/workflows/deploy.test.js`: todo comando de BD lleva `--remote`, sin `--local|--db-url|--password|-p|--include-seed|--debug`, y contraseña por env).
Resultados del pipeline: `node --test 'tests/**/*.test.js'` local en 2509482: 1756 pass, 0 fail, 2 skipped (preexistentes, no introducidos por este cambio). gitleaks/semgrep/ZAP no aplican al diff (solo YAML de workflow, sin secretos literales).

Verificado sin hallazgos (categoría 5):
- La contraseña (`SUPABASE_DB_PASSWORD`) y el token (`SUPABASE_ACCESS_TOKEN`) llegan solo por `env:` desde `secrets.*`; ningún `echo`, `--password`, `-p` ni `--db-url` en línea de comandos.
- Sin `--include-seed` ni `--debug` (H-F03-07 se mantiene).
- El dry-run sigue en un paso previo y distinto al `db push` real (job `migrate-plan` y paso previo en `migrate`); orden dry-run → push → list verificado por prueba.
- Jobs con `environment: produccion` y disparo solo `workflow_dispatch` con confirmación escrita; `--remote` no amplía el destino más allá del proyecto enlazado por `supabase link --project-ref`.

Evaluación de `--yes` en el `db push` real:
- Seguridad: aceptable. La compuerta real es el disparo manual + environment `produccion` + dry-run previo, no el prompt interactivo; en CI sin TTY el prompt no aporta control humano.
- Conveniencia: haría el comportamiento determinista (no depender de cómo la CLI resuelve un prompt sin TTY).
- No se añade en este fix: las pruebas del tester (`tests/workflows/deploy.test.js`) fijan las líneas exactas con `/supabase db push --remote\s*$/` y `/^\s*(run:\s*)?supabase\s+(db\s+push|...)/`; cualquier ubicación de `--yes` las rompe y seguridad no puede modificar `tests/workflows/`. Queda como recomendación Baja: si el run real de deploy se queda esperando confirmación, el desarrollador añade `--yes` y el tester ajusta las regex en el mismo cambio.

Hallazgos: ninguno de severidad Media o superior.
