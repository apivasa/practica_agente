# Modelo de amenazas (borrador, actualizado en F-03+F-04+F-06)

Estado: borrador. Cubre la superficie construida hasta M-01 (motor `engine/`). Se amplía en S-02 con Supabase (Auth, RLS, RPC), el front en GitHub Pages y los workflows programados.

## Activos

| Activo | Por qué importa |
|---|---|
| Color de cada indicador por unidad | Decide los candados sobre la capacidad de la unidad. Un color falso aplica o quita restricciones indebidamente. |
| Configuración de indicadores (tipo, sentido, ventana, umbrales, umbrales por categoría, muestra mínima) | Quien la altera cambia el resultado de todas las unidades. |
| Mediciones cargadas por custodios | Entrada principal del motor. |
| Compromisos, metas y excepciones | Modifican el efecto del color. |
| Auditoría de acciones automáticas | Evidencia de candados, alertas y vencimientos; no debe ser editable. |
| Credenciales: `SUPABASE_SECRET_KEY` (solo en Actions), sesiones de usuario | Dan acceso a los datos. |

## Actores

| Actor | Confianza | Puede (según diseño) |
|---|---|---|
| Gestora de KPIs | Alta | Define indicadores, umbrales y custodios. |
| Custodio | Media | Carga mediciones de **su** KPI (CSV o formulario). |
| Comité de delivery | Alta | Ve todas las unidades, decide escaladas, aprueba excepciones. |
| Líder de unidad | Baja respecto a datos ajenos | Solo ve su unidad. Interés en mejorar su color o quitar candados. |
| Anónimo / Internet | Nula | Ve el front estático público. |
| GitHub Actions (cálculo programado) | Alta, con clave secreta | Ejecuta el motor y escribe colores, candados y auditoría. |

## Superficie actual (M-01)

- `engine/` — funciones puras ESM (`validateIndicator`, `normalizeIndicator`, `measure`, `parseDay`, `evaluateColor`). Sin red, sin E/S, sin dependencias.
- Entradas no confiables que llegarán al motor: configuración de indicador (gestora, vía BD), mediciones (custodios, vía CSV/formulario/BD), `asOf`, `target`, `category` (Actions y front).
- Salidas que se mostrarán en el front: `color`, `reason` (texto que incluye valores y nombres de categoría) y mensajes de error.

## Amenazas STRIDE (motor)

| ID | STRIDE | Amenaza | Control | Prueba |
|---|---|---|---|---|
| T-ENG-01 | Tampering | Prototype pollution con claves `__proto__`/`constructor` en `thresholdsByCategory`, `category` o `appId`. | `hasOwnProperty` para elegir umbral; copia defensiva; `Map` en coverage. | `tests/security/engine-m01.test.js` (categoría 3, pollution) |
| T-ENG-02 | Tampering | Valores NaN/Infinity/strings en umbrales, valores, `target`, `windowDays`, `minSample` que fuerzan un color. | Validación `Number.isFinite`/`Number.isInteger`; mediciones no finitas se ignoran; `value` no finito lanza. | idem (números no finitos) |
| T-ENG-03 | Tampering | Fechas malformadas o de otro periodo cuelan datos en la ventana. | Regex anclada `YYYY-MM-DD` + verificación de calendario UTC. | idem (fechas) |
| T-ENG-04 | DoS | Arreglos enormes, `windowDays` gigante, miles de categorías, ReDoS. | Algoritmos O(n), sin iterar por días; regex sin cuantificadores anidados. | idem (complejidad) |
| T-ENG-05 | Elevation / Tampering | Ejecución de código vía `eval`/`Function`/RegExp dinámica. | No existen en el motor. | idem (categoría 6) |
| T-ENG-06 | Information disclosure / XSS | `reason` y errores reflejan nombres de categoría; si el front los inserta como HTML hay XSS almacenado. | El front debe renderizar con `textContent`. | Pendiente: prueba XSS del front (V-xx / S-02). |
| T-ENG-07 | Tampering / DoS | Valores extremos (p. ej. `1e308`) desbordan la suma a `Infinity` y rompen la evaluación; negativos sesgan el resultado. | Pendiente: validación de rango en BD/CSV (CHECK) y manejo por indicador en Actions. | Ver hallazgos H-M01-02. |
| T-ENG-08 | Tampering | `sampleSize` no numérico salta la muestra mínima. | Pendiente (H-M01-01). | Ver hallazgos. |

## Activos de datos (F-03)

| Tabla | Sensibilidad | Lee | Escribe |
|---|---|---|---|
| `user_roles` | Crítica (autorización) | propio usuario; gestora y comité todo | solo gestora |
| `units` | Media | gestora, comité, custodios; líder solo la suya | gestora |
| `indicators` | Alta (umbrales) | cualquier usuario con rol | gestora |
| `commitments` | Alta | gestora, comité; custodio de su KPI; líder de su unidad | custodio de su KPI (insert/update) |
| `measurements` | Alta (entrada del color) | ídem `commitments` | custodio de su KPI (insert/update) |
| `targets` | Media | gestora, comité, custodios; líder de su unidad | gestora |
| `evaluations` | Alta (decide los candados) | gestora, comité; custodio de su KPI; líder de su unidad | solo backend (`service_role`) |
| `exceptions` | Alta (levanta candados) | gestora, comité; líder de su unidad | comité (insert/update, `approved_by = auth.uid()`) |
| `alerts` | Baja | destinatario; gestora y comité | backend; el destinatario solo `read_at` |
| `audit_log` | Alta (evidencia) | gestora y comité | solo triggers `security definer` y backend |
| `auth.users` (semilla) | Crítica | Supabase Auth | gestora vía panel/Auth admin |

Roles de BD: `anon` (sin privilegios), `authenticated` (todos los usuarios; el rol de negocio sale de `user_roles`, nunca del JWT) y `service_role` (Actions con la clave secreta, BYPASSRLS).

## Amenazas STRIDE (datos y RLS, F-04)

| ID | STRIDE | Amenaza | Control | Prueba |
|---|---|---|---|---|
| T-DB-01 | Elevation | Usuario se asigna rol o cambia su unidad o KPI en `user_roles` | Solo la gestora escribe (políticas con WITH CHECK); la autorización no lee el JWT | `supabase/tests/security/040_*` §1–4, 011, 013 |
| T-DB-02 | Elevation / Spoofing | JWT con `role:service_role`, `app_metadata.role` o claims inventados bajo rol `authenticated` | Políticas basadas en `auth.uid()` y `user_roles`; firma del JWT validada por PostgREST | 040 §1 (S-03: JWT manipulado contra PostgREST real) |
| T-DB-03 | Information disclosure | IDOR: líder A lee la unidad B (`or=`, `in=`, joins); custodio X lee Y | RLS por unidad/KPI con funciones de `private` | 040 §3–4, 013, 011 |
| T-DB-04 | Tampering | Custodio mueve una medición o compromiso a otro KPI | WITH CHECK `is_custodian_of(indicator_id)` | 040 §4, 011 |
| T-DB-05 | Tampering / Repudiation | Custodio falsifica `created_by` o `source` y reescribe mediciones sin rastro | **Parcial**: INSERT exige `created_by = auth.uid()`; el UPDATE no lo exige y no hay auditoría | H-F03-01, H-F03-02 |
| T-DB-06 | Elevation | Líder o gestora crea o extiende una excepción; un miembro del comité firma a nombre de otro | Solo el comité; `approved_by = auth.uid()` | 040 §3, 5, 6 |
| T-DB-07 | Tampering | Usuario escribe `evaluations`, `alerts` o `audit_log` (se pinta de verde, fabrica evidencia) | Sin privilegio INSERT/UPDATE/DELETE | 040 §6, 041, 042 |
| T-DB-08 | Tampering / DoS | TRUNCATE (ignora RLS) | TRUNCATE revocado a anon/authenticated | 041, 042 |
| T-DB-09 | Elevation | `security definer` con `search_path` manipulable o invocable por RPC | `search_path=''`, funciones en `private` no expuesto, EXECUTE revocado a PUBLIC/anon | 041 |
| T-DB-10 | Elevation | Tabla, vista o función futura sin RLS o con los grants por defecto de Supabase | Regresión de catálogo en CI | 041, `tests/security/db-static-f03.test.js` (H-F03-04) |
| T-DB-11 | Repudiation | Auditoría alterada o actor falsificado | Solo SELECT para usuarios; actor = `auth.uid()`. **Residual**: `service_role` puede borrar (H-F03-03) | 042, 020 |
| T-DB-12 | Spoofing | La semilla con contraseña conocida llega a producción | `db push` no aplica la semilla; guarda contra `--include-seed`/`db reset --linked` | `tests/security/db-static-f03.test.js` |
| T-DB-13 | Spoofing | Autoregistro abierto | El usuario sin rol no ve nada; **residual**: `enable_signup` activo (H-F03-06) | 014, 040 §2 |

## Pendiente para S-02
Auth y sesión, RLS por rol y tabla, RPC `security definer`, IDOR entre unidades/KPIs, importación CSV (fórmulas, tamaño, unidad ajena), front estático (CSP, secretos en `dist/`, anti-framing), workflows (permisos, SHA, disparo con datos manipulados), cadena de suministro y DAST.
