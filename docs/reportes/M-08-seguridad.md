# M-08 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva:
- Trigger `measurements_category_guard` (AFTER ROW en INSERT y UPDATE de `measurements`). Usa la función `private.check_measurement_category()` con `security definer` y `search_path = ''`.
- CHECK `indicators_cumulative_direction`.
- Descarte por fila compartido entre la evaluación mensual, el ritmo diario y el front (`engine/rows.js` `buildPackageInput`).
- Modelo de amenazas: T-M08-01..04.

Revisado sobre `origin/item/M-08` en `e3d37ff`. El commit de seguridad es `118c119`: un commit de QA lo revirtió por error y `e3d37ff` lo restauró idéntico.

## Corrección del pentest de la API
`tests/security/api/matrix.js` › `measurements.insertBody` mandaba una medición VULN sin `category`. La BD ahora la rechaza con 23514, y eso es correcto. Para el KPI VULN la matriz envía ahora `category: 'P0P1', kind: 'resolved'`.

La negación a los demás roles sigue viniendo de RLS (403), no del trigger. El caso "custodio1 · POST measurements" vuelve a pasar.

## Revisión del trigger
- **Orden respecto a RLS (correcto).** En un INSERT, PostgreSQL evalúa el WITH CHECK de RLS antes de encolar los AFTER ROW triggers.
  - Un rol sin permiso recibe 42501 aunque la fila sea inválida. El trigger no sirve de oráculo de la configuración del indicador.
  - En un UPDATE, el USING filtra las filas ajenas antes de que el trigger se dispare.
  - Probado para el custodio de otro KPI, el líder y el comité.
- **Privilegios de la función (correcto).**
  - `security definer` hace falta para leer `indicators` sin depender de la RLS del que inserta.
  - `search_path = ''` y todos los nombres calificados (`public.indicators`).
  - `revoke all` a `public`, `anon` y `authenticated`. El dueño no es un rol de la API y ningún rol de la API tiene CREATE en `private`.
  - La función solo devuelve `null` o lanza un mensaje fijo, sin datos del indicador.
- **Evasión.**
  - Categoría en minúsculas, con espacio o con payload SQL: rechazadas.
  - UPDATE de una fila válida a categoría nula, desconocida o con valor decimal: rechazado.
  - El custodio no puede quitar las categorías ni cambiar el tipo del indicador.
  - Ni el custodio ni la gestora pueden desactivar el trigger (42501, no son dueños de la tabla).
  - La gestora no puede pasar VULN a "menos es mejor" (23514).
- **Atomicidad.** El `raise` revierte la sentencia entera, incluida la fila de `audit_measurements` que se dispara antes. No queda auditoría de una fila que no existe.

## Pruebas de seguridad añadidas
- `supabase/tests/security/046_security_measurements_guard_m08.test.sql`: 19 casos.
  - Cat. 1: función, privilegios, AFTER ROW, oráculo vía RLS y desactivar el trigger.
  - Cat. 3: variantes de categoría y valor, y UPDATE a inválido.
  - Cat. 1/3: evasión por configuración del indicador.
- `tests/security/api/matrix.js`: dato VULN válido (cat. 1). La matriz completa vuelve a verde.

## Resultados del pipeline (en `e3d37ff`)
- Seguridad, [run 44686868622](https://github.com/apivasa/practica_agente/actions/runs/44686868622): verde.
  - Incluye gitleaks, semgrep, npm audit, CodeQL JS y Actions, `security-tests`, DAST con ZAP baseline y `pentest-api` (531 casos, 0 fallos).
  - El run anterior en `0058e63`, [44684166726](https://github.com/apivasa/practica_agente/actions/runs/44684166726), fallaba solo en "custodio1 · POST measurements".
- CI, [run 44686868638](https://github.com/apivasa/practica_agente/actions/runs/44686868638): verde. En `db (pgTAP)` el archivo 046 da ok (21 archivos, 481 pruebas).

## Hallazgos
- **H-M08-01 · Baja · cat. 3 · `supabase/migrations/20261123120000_measurements_category_guard.sql`** (`new.value < 0 or new.value <> trunc(new.value)`) y `data_model.sql:114`. Accionable por el desarrollador en un ítem de endurecimiento.
  - **Qué pasa:** `numeric` admite `'NaN'` y `'Infinity'`, y PostgREST los acepta como cadena. En PostgreSQL, `NaN >= 0` y `NaN = trunc(NaN)` son verdaderos. Por eso ni el CHECK ni el trigger rechazan `NaN`, `Infinity` ni enteros mayores que 2^53.
  - **Reproducción:** `POST /rest/v1/measurements` como custodio de VULN con `{"value":"NaN","category":"P0P1","kind":"resolved",...}` devuelve 201.
  - **Impacto:** bajo. El motor (`splitMalformed`/`num`) descarta esas filas y las cuenta en el motivo, así que no fuerzan verde ni anulan el mes. Lo que falla es que la BD y el motor no aplican el mismo criterio, aunque el comentario de la migración diga que sí.
  - **Corrección:** en el trigger, `or new.value = 'NaN' or new.value >= 9007199254740992`. En la tabla, `check (value is null or (value >= 0 and value < 'Infinity' and value <> 'NaN'))`. Añadir el caso a la prueba 080.
- **H-M08-02 · Info · cat. 1/3.** La regla se comprueba al escribir la medición, no al reconfigurar el indicador. Las filas antiguas sin categoría las descarta el motor. Aceptado.

Los dos están registrados en `docs/seguridad/hallazgos.md`.

## Verificado sin hallazgos
- **Cat. 1:** RLS antes que el trigger, privilegios y dueño de la función, y no se puede desactivar.
- **Cat. 3:** categoría y valor decimal, en INSERT y en UPDATE.
- **Cat. 5:** el descarte compartido del ritmo diario queda en el motivo y en la auditoría.
- **Cat. 6:** no hay dependencias nuevas.
- **Cat. 8:** la auditoría es coherente con el rechazo.
- **No aplica:** cat. 2, 4 y 7, salvo el DAST verde.
