# S-05c — Informe de arquitectura y salud
Veredicto: ROJO
Alineado al diseño: no. Las sondas no son estrictamente no destructivas: si `anon` tuviera INSERT, la de `audit_log` dejaría una fila imborrable (detalle en A-1). Se corrige dentro del ítem.
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
