# fix/service-role-grants — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna para usuarios finales. La migración `supabase/migrations/20261130120000_service_role_grants.sql` concede de forma explícita a `service_role` (clave secreta `sb_secret_...`, que solo existe en el environment `produccion` de GitHub Actions) los privilegios que el backend ya tenía en local por defecto. Rama `fix/service-role-grants`, commit d9a423c.

Pruebas de seguridad añadidas: ninguna nueva de seguridad. La prueba del desarrollador `supabase/tests/080_service_role_grants.test.sql` (61 casos, el plan cuadra: 1+36+9+5+2+2+3+3) cubre lo concedido y lo negado: sin TRUNCATE en las 9 tablas de negocio, y en `audit_log` sin UPDATE, DELETE ni TRUNCATE (verificado por privilegios y de forma funcional con `42501`). Las pruebas de regresión de `supabase/tests/security/` (040–052) siguen aplicando; 040 y 044 ya tratan `service_role` y no chocan con esta migración.

Resultados del pipeline: revisión estática del diff (sesión de 10 min). El CI de la rama (pgTAP y `seguridad.yml`) lo valida el orquestador antes del merge.

## Verificaciones
| Punto | Resultado |
|---|---|
| No toca `anon` ni `authenticated` | OK: todos los GRANT y REVOKE nombran solo a `service_role`. |
| No concede nada a `PUBLIC` | OK: no hay `to public`, ni `alter default privileges`, ni GRANT sobre funciones. |
| `audit_log` sigue append-only | OK: solo SELECT e INSERT, más REVOKE defensivo de UPDATE, DELETE y TRUNCATE. Siguen activos los triggers `audit_log_append_only` (before update or delete) y `audit_log_no_truncate` (`20261119120300_hardening.sql:145-150`), es decir, defensa en dos capas. |
| TRUNCATE, REFERENCES y TRIGGER | Revocados en las 9 tablas de negocio, así que local y producción coinciden. TRUNCATE salta RLS y los triggers de fila, y quitarlo evita borrar sin dejar rastro en auditoría. |
| Cobertura de tablas | Las 10 tablas de `public` en las migraciones son exactamente las 9 de negocio más `audit_log`. No queda ninguna sin tratar. |
| Secuencia | Solo USAGE y SELECT en `audit_log_id_seq` (sin UPDATE, así que no se puede hacer `setval`). |
| DELETE de `service_role` en tablas de negocio | Aceptable: los fixtures del pentest S-05 y pentest-api lo necesitan. Los triggers de auditoría de fila (`audit_*`) registran los borrados en las tablas auditadas, y la clave solo vive en el environment protegido. |

## Hallazgos
- **Baja · 1 (autorización) · diseño de `service_role`:** `service_role` tiene BYPASSRLS y ahora DELETE en todas las tablas de negocio. Si se filtrara la clave secreta, alguien podría borrar datos de negocio. El borrado queda auditado en las tablas con trigger, pero `commitments`, `evaluations` y `alerts` no tienen trigger de auditoría de borrado. Es un riesgo residual ya aceptado (ver 044) y no hace falta corregirlo ahora. Propuesta para `docs/seguridad/hallazgos.md`: a futuro, que los fixtures del pentest usen un rol dedicado de pruebas con DELETE y dejar `service_role` sin DELETE en producción.
- **Informativo · operación:** los privilegios se dan por tabla y no por privilegios por defecto (bien hecho: así no se conceden permisos de más a tablas futuras). Cada tabla nueva tendrá que añadir su GRANT a `service_role` en su migración, o el backend fallará en producción con `permission denied`. Conviene que la regla "tabla nueva sin GRANT explícito de `service_role`" se compruebe en pgTAP.

Verificado sin hallazgos: 1 (no se amplía nada a anon, authenticated ni PUBLIC), 8 (auditoría inmutable, también para `service_role`). Las categorías 2–7 no aplican: el diff solo trae SQL de privilegios.
