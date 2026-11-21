# S-05c — Informe de arquitectura y salud
Veredicto: VERDE (intento 2; el intento 1 fue ROJO por A-1)
Alineado al diseño: sí. A-1 quedó corregido en 3d993e6: ninguna sonda puede crear filas aunque `anon` tuviera INSERT (ver «Intento 2»). En el intento 1 las sondas no eran estrictamente no destructivas: la de `audit_log` podía dejar una fila imborrable.
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno. El ítem respeta ADR 0014 (salud; no toca `salud.yml`) y ADR 0015 (fase B manual, solo desde `main`, environment `produccion`).
Salud: el ítem no cambia workflows. `seguridad.yml` › `s05-fase-b` sigue igual: `workflow_dispatch` con `fase_b != no` y `github.ref == refs/heads/main`, y ejecuta `node --test tests/security/prod/fase-b.test.js` con `S05_MODE`. El módulo nuevo `tests/security/prod/anon-write-probes.js` no es `*.test.js`, así que no lo recoge ningún glob. La prueba estática `tests/security/anon-write-probes-s05c.test.js` entra en security-tests (`tests/security/*.test.js`) sin red ni BD. Alcance de hosts sin cambios (`guardedFetch`). No lancé workflows. El run de `seguridad.yml` del PR lo enlaza el orquestador.

## Hallazgos

### A-1 (bloqueante) — sonda de `audit_log` y de `units`: una fila creada no se podría borrar
- `audit_log` es solo de inserción: trigger `audit_log_append_only` (BEFORE UPDATE OR DELETE, `20261119120300_hardening.sql:145`) y `revoke delete` incluso a `service_role`. La sonda `{actor, action, entity}` cumple todas las restricciones. Si `anon` tuviera INSERT (justo el caso que la prueba busca), quedaría una fila permanente en la auditoría de producción.
- El comentario de `anon-write-probes.js` («units y audit_log llevan la marca … para localizarlas y borrarlas») y el procedimiento de `docs/seguridad/pentest-preproduccion.md:139` («La gestora la borra desde la app») no valen para `audit_log`.
- `units` crearía una fila real (que sí se puede borrar). Es aceptable, pero se puede evitar igual.
- **Corrección:** cuerpos con columnas reales, tipos válidos y una restricción garantizada a fallar, como ya hacen `exceptions` y `user_roles` con su FK. PostgreSQL comprueba el privilegio (`42501`) antes que las restricciones. Si `anon` tuviera INSERT, la respuesta sería `23xxx`, la prueba fallaría igual y **no se crearía ninguna fila**. Por ejemplo:
  - `audit_log: { actor: MARK, action: MARK, entity: MARK, details: null }`: `details` es `not null` → `23502`.
  - `units: { name: ' ' }`: `check (length(trim(name)) > 0)` → `23514`.

  Hay que ajustar `anon-write-probes-s05c.test.js`. Debe comprobar que cada sonda trae al menos una violación garantizada (FK inexistente, NOT NULL a null o CHECK), y no solo «marca para borrar». También hay que actualizar el comentario del módulo y la línea 139 de `pentest-preproduccion.md`.

### Verificado sin hallazgos
- Columnas y enums de las 4 sondas contra `supabase/migrations/20261119120000_data_model.sql`: `exceptions` (`unit_id`, `scope`, `reason`, `expires_on`; `approved_by` con default) y `user_roles` (`user_id`, `role`) son correctas. `kpi_manager` cumple `user_roles_scope`.
- `privilegeDenialProblem` es estricto y coherente con el objetivo (H-QA-S05b-01).
- Prueba de enumeración en la suite `roles`: 2 intentos fallidos, sin fuerza bruta, solo contra hosts del proyecto.
- La lógica de prueba no duplica `engine/`. No hay configuración de KPI quemada.

### Nota en `docs/operacion.md` (hecha en este informe)
Paso 1 de «Activación de producción (P-05)»: tras el merge de S-05c, relanzar la fase B `anonimo` desde `main` para confirmar `401 42501` en las 4 tablas. La nota dice también que un `PGRST204`, un `22xxx`/`23xxx` o un `401` sin `42501` son fallos reales y que la prueba no se relaja.

## Intento 2 (commit 3d993e6)
Veredicto: VERDE. A-1 queda corregido.

Lo comprobé contra `supabase/migrations/` (incluidas las migraciones posteriores que redefinen restricciones o añaden triggers):
- `units: { name: '   ' }` cae en `check (length(trim(name)) > 0)`, que nunca se borra. Ningún trigger BEFORE INSERT en `units` → `23514`.
- `exceptions`: `unit_id` apunta a un id que no existe. `exceptions_unit_id_fkey` se recrea en `hardening.sql:118` sobre `public.units(id)` → `23503`. `reason` en blanco cae en el CHECK → `23514`. Además, el trigger BEFORE INSERT de C-02 rechaza `expires_on = 2099-01-01` por el tope de vigencia, y no reescribe `reason` ni `unit_id`. Hay tres causas independientes de fallo.
- `audit_log: { actor: null }`: `actor text not null` no tiene default ni trigger BEFORE INSERT → `23502`. `audit_log_append_only` sigue vigente: si se creara una fila, no se podría borrar.
- `user_roles`: FK a un `auth.users` que no existe → `23503`. Además, `unit_leader` sin `unit_id` incumple `user_roles_scope` → `23514`.
- En cualquier caso, la sentencia se revierte entera, también los triggers AFTER de auditoría. No queda ninguna fila.

La prueba estática `anon-write-probes-s05c.test.js` exige cada violación contra el esquema. Comprueba la columna en el `create table`, que no haya default en el caso NOT NULL, que ningún `new.<col> :=` reescriba la columna, que el CHECK no se borre, que la FK borrada se recree sobre la misma tabla y que los ids no estén en la semilla. Se ejecuta en `security-tests` sin red.

El comentario del módulo y `pentest-preproduccion.md:139` («No hay nada que limpiar») ya son correctos. El veredicto exige «permission denied» (H-QA-S05c-02), que es coherente. Salud: no cambian workflows ni `salud.yml`, y no lancé ninguno. Hallazgos nuevos: ninguno.
