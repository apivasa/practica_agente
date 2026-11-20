# M-09 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. El ítem endurece superficie que ya existía.
- `targets`: `authenticated` pasa de UPDATE de tabla a `update (target_value)` (H-M07-01).
- `measurements`: CHECK nuevo `measurements_value_finite`. La función `private.check_measurement_category()` se reemplaza: ahora rechaza `NaN` y valores > 2^53 - 1 en VULN (H-M08-01).
- `engine/vulnerabilities.js` `cumulativeThirds`: el redondeo hacia arriba se topa en el total (H-M07-QA-01).
- Modelo de amenazas: T-M09-01..04; T-M07-05 se actualiza.

Revisado sobre `origin/item/M-09` en `2ca4a33`. El commit de seguridad es `d66e022`.

## Corrección de la prueba de seguridad que dejaba CI en rojo
`supabase/tests/security/045_security_targets_m07.test.sql:73`: el `update ... set unit_id` suelto del líder ahora falla con 42501 (privilegio de columna) y abortaba la transacción. Se convierte en `throws_ok(..., '42501', ...)` y el plan pasa de 22 a 23.

La prueba no pierde nada:
- La aserción final de 045 sigue comprobando que la meta de B conserva su `unit_id`.
- La negación es ahora más fuerte: antes venía de RLS (0 filas) y ahora es un error de privilegio.

## Pruebas de seguridad añadidas
`supabase/tests/security/047_security_hardening_m09.test.sql` tiene 22 casos:
- **Cat. 1 (autorización y escalada), 11 casos:**
  - Catálogo, 4 casos: la función reemplazada sigue `security definer` con `search_path=""` y sin EXECUTE para anon ni authenticated; el trigger sigue enganchado y activo; el CHECK está validado (no `NOT VALID`).
  - Evasión del privilegio de columna por la gestora, 4 casos: upsert `on conflict do update set unit_id`, upsert con `set month`, UPDATE que mezcla `target_value` con `indicator_id`, y cambio de `id`. Todos dan 42501.
  - Caso positivo, 1: el upsert que solo toca `target_value` pasa.
  - Líder, 1 caso: tiene el privilegio de columna, pero RLS no le deja actualizar ni su propia unidad.
  - Integridad final, 1 caso: la meta conserva unidad, indicador y mes.
- **Cat. 3 (entradas), 9 casos.** El custodio convierte por UPDATE una fila válida en:
  - `NaN`, `Infinity` o 2^53 en VULN;
  - `'  nan '`, `'inf'` o `-Infinity` en un promedio;
  - también inserta `NaN` con categoría en minúsculas.

  Todos dan 23514. El valor 2^53 - 1 pasa. El valor original se conserva y no queda ninguna medición no finita en la tabla.
- **Cat. 8 (auditoría), 1 caso:** el upsert permitido de la gestora queda en `audit_log`.

Modificado: `045_security_targets_m07.test.sql` (+1 caso, cat. 1).

## Resultados del pipeline (commit `d66e022`)
- CI: success. https://github.com/apivasa/practica_agente/actions/runs/44697207391
  - db (pgTAP): `Files=25, Tests=567, Result: PASS`. 045, 046, 047 y 090 en `ok`.
  - integración, build y e2e: success.
- Seguridad: success. https://github.com/apivasa/practica_agente/actions/runs/44697207360
  - gitleaks, semgrep, CodeQL (JS y Actions), npm audit y pruebas `tests/security`: success.
  - DAST (e2e de seguridad + ZAP baseline): success.
  - pentest API: success. La matriz PATCH de `targets` solo envía `target_value`, así que sigue pasando con el grant de columna.
  - S-05 fase A y B: skipped. Es lo esperado fuera de S-05: solo corren por dispatch o schedule.
- Antes de esta corrección: CI en failure en `2ca4a33` (https://github.com/apivasa/practica_agente/actions/runs/44694258388). La única causa era 045:73.

## Hallazgos
- **H-M09-01 · Baja · cat. 3 · `supabase/migrations/20261119120000_data_model.sql`.**
  - Columnas afectadas: `targets.target_value` (`:135`), `commitments.package_total` (`:96`), `green_override` y `yellow_override` (`:94-95`), y los umbrales de `indicators` (`:40-41`).
  - Problema: la clase de H-M08-01 sigue abierta fuera de `measurements`. En PostgreSQL 16 `'NaN'::numeric >= 0` e `'Infinity'::numeric >= 0` son verdaderos (comprobado). `to_jsonb` los serializa como la cadena `"NaN"` o `"Infinity"`.
  - Reproducción: como gestora, `PATCH /rest/v1/targets?id=eq.<id>` con `{"target_value":"NaN"}`. Se acepta y queda auditado. Lo mismo hace el custodio con `package_total` en `commitments`.
  - Impacto: `engine/rows.js` `num()` convierte el valor en `null`, sin meta, y `formatNumber` muestra `—`. No fuerza colores ni quita candados. Solo pueden hacerlo roles que ya escriben esa columna.
  - Corrección sugerida (trivial y aditiva), una de dos:
    - el mismo CHECK que `measurements_value_finite` en cada columna;
    - un dominio `finite_numeric`.

    Después, añadir los casos a pgTAP. Recomiendo incluirlo en el próximo ítem de endurecimiento. Ya está registrado en `docs/seguridad/hallazgos.md`.

## Hallazgos cerrados
- **H-M07-01: Corregido.** Lo verifican 045 (UPDATE de `unit_id` → 42501), 047 (upsert, UPDATE mixto e `id`) y 090.
- **H-M08-01: Corregido para `measurements`.** Lo verifican 047 (evasión por UPDATE, variantes de escritura de NaN e Infinity, tope 2^53) y 090. El residual en otras columnas se registra como H-M09-01.

## Verificado sin hallazgos
1 (privilegios de columna, RLS, función del trigger), 3 (NaN/Infinity/2^53 en mediciones), 5 y 6 (pipeline sin cambios en workflows; gitleaks, semgrep y npm audit en verde) y 8 (auditoría del cambio permitido).

El motor: `cumulativeThirds` sigue rechazando entradas no finitas o negativas, y el tope en `total` no abre ningún camino nuevo.

No aplican en este ítem: 2, 4 y 7. No hay cambios de front ni de Auth, y ZAP baseline está en verde.
