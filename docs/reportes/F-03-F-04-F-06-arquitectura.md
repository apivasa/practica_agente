# F-03-F-04-F-06 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0005-modelo-datos-y-rls.md` (Aceptado)
Salud:
- **CI de la rama:** el run 44595920560 (commit e58be3f) está en verde.
  - Job `db`: 63 s en total. 51 s son para levantar Postgres y aplicar las 3 migraciones y la semilla, y 4 s para pgTAP (8 archivos, 164 pruebas, PASS).
  - Referencia: unos 70 s según el orquestador, y 53 s en el último run verde de `main` (44594989347). El aumento frente a `main` (+10 s) se debe al arranque con migraciones; está dentro de lo esperado.
  - Jobs `build` 7 s y `e2e` 28 s, sin cambios.
- **`main`:** el último run completo está en verde. Hay un fallo aislado (44594670904), seguido de runs verdes: no es un patrón intermitente.
- **Workflows programados y `salud.yml`:** todavía no existen (C-03, V-04). No hay nada que monitorear.

Hallazgos:
1. **Alineación correcta.**
   - Están las 9 tablas del diseño más `audit_log`, que exige CLAUDE.md. Todas con RLS.
   - Los enums SQL coinciden con `engine/`: `measurement_type`, `direction`, `frequency`, `data_source`, `color`, `escalation_level` y `exception_scope` (`change_start | all`).
   - Los 7 atributos del indicador genérico son columnas o configuración. No hay ningún KPI quemado en el esquema.
   - El check de coherencia de umbrales replica la regla de `validateIndicator`. Es una validación de integridad, no lógica de cálculo duplicada.
2. **Las 4 decisiones del desarrollador quedan aceptadas** y registradas en el ADR 0005:
   - permisos solo desde `user_roles`;
   - lecturas añadidas para custodio y gestora, mientras el líder sigue limitado a su unidad;
   - la gestora no escribe mediciones;
   - revoke/grant explícito en cada migración.
3. **(Medio, M-05) `commitments.package_total` no alcanza para el caso vulnerabilidades.** El motor de M-05 necesita el paquete partido en P0/P1 y P2/P3, y distinguir lo detectado de lo resuelto. Propuesta en el ADR 0005, como migración aditiva dentro de M-05:
   - `commitments.package_by_category jsonb`;
   - `measurements.kind` (`resolved | detected`).
   Hay que fijar en M-04 si `measurements.value` es incremental o acumulado: la semilla dice "acumuladas" y el motor suma.
4. **(Bajo, M-03)** Faltan los overrides de umbral por categoría en `commitments` y un check de coherencia de los overrides con `direction`.
5. **(Bajo, C-02)** Coherente con la decisión 2 del ADR 0003. Falta `exceptions.change_ref`, obligatorio con `scope = 'change_start'`. Opcional: `revoked_at`.
6. **(Bajo, C-03/C-04)**
   - Ninguna prueba demuestra todavía que `service_role` puede insertar y hacer upsert en evaluations, alerts y audit_log (secuencia incluida).
   - Para la idempotencia de las alertas conviene `alerts.dedupe_key unique` y restringir `alerts.kind`.
   - El upsert de evaluations queda cubierto por `unique nulls not distinct`.
7. **(Bajo)** `units.leader_user_id` e `indicators.custodian_user_id` son informativos y pueden quedar desalineados con `user_roles`. M-02 debe escribir los dos, y hace falta una prueba de coherencia.
8. **(Bajo)** No se auditan las modificaciones de measurements, targets ni units. Recomendado en M-04 para el `update` de measurements.
9. **Guarda contra olvidar el revoke (para el tester; no implementada).** Prueba `supabase/tests/030_privileges.test.sql` basada en el catálogo:
   - `anon` sin privilegios en `public`;
   - `authenticated` sin `TRUNCATE`, `REFERENCES` ni `TRIGGER`;
   - los privilegios de `authenticated` iguales a una lista permitida;
   - toda tabla de `public` con `relrowsecurity`;
   - las funciones `security definer` no ejecutables por `public` ni `anon`.

   Complemento recomendado para el desarrollador: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ...`. Detalle en el ADR 0005.
