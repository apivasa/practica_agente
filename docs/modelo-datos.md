# Modelo de datos y RLS

Fuente: las migraciones de `supabase/migrations/` y los ADR [0005](adr/0005-modelo-datos-y-rls.md), [0008](adr/0008-evaluacion-y-alertas.md) y [0012](adr/0012-excepciones.md). Si este documento y una migración no coinciden, manda la migración.

## Resumen

- 9 tablas del diseño más `audit_log`. Todas en el esquema `public`, todas con RLS activado.
- Los permisos salen **solo** de `user_roles`. Las columnas `units.leader_user_id` e `indicators.custodian_user_id` son informativas: no dan permisos.
- `anon` (sin sesión) no tiene ningún privilegio en ninguna tabla.
- El backend (GitHub Actions con la clave `sb_secret_...`) se salta RLS. Es el único que escribe `evaluations`, `alerts` y `audit_log`.
- Nadie borra mediciones, compromisos ni excepciones: no hay privilegio `DELETE` en esas tablas.
- Las FK hacia `units` e `indicators` son `ON DELETE RESTRICT` en compromisos, mediciones, metas, evaluaciones, excepciones y alertas: no se puede borrar una unidad o un indicador con historial.

## Roles

Enum `app_role`:

| Valor | Rol | Alcance en `user_roles` |
|---|---|---|
| `kpi_manager` | Gestora de KPIs | sin unidad ni indicador |
| `custodian` | Custodio | un `indicator_id` por fila (una fila por indicador custodiado) |
| `committee` | Comité de delivery | sin unidad ni indicador |
| `unit_leader` | Líder de unidad | un `unit_id` por fila |

Un usuario puede tener varias filas y varios roles. Un usuario con sesión y sin filas no ve nada.

Funciones de apoyo (esquema `private`, no expuesto por la API, `security definer`): `has_role(rol)`, `has_any_role()`, `is_leader_of(unidad)`, `is_custodian_of(indicador)`.

## Tablas

### `units` — unidades de delivery
`id`, `name` (única, no vacía), `leader_user_id` (informativa), `created_at`.

### `user_roles` — usuarios y roles
`id`, `user_id`, `role`, `unit_id`, `indicator_id`, `created_at`. Check de alcance según el rol (tabla de arriba). Única por (`user_id`, `role`, `unit_id`, `indicator_id`).

### `indicators` — modelo genérico de indicador
`id`, `code` (único; letras, números, `_` y `-`), `name`, `description`, `measurement_type` (`cumulative_target`, `window_average`, `coverage`), `direction` (`higher_is_better`, `lower_is_better`), `window_days` (> 0, por defecto 30), `green_threshold`, `yellow_threshold`, `thresholds_by_category` (objeto JSON), `frequency` (`monthly`, `weekly`, `quarterly`), `min_sample` (≥ 0), `source` (`manual`, `automatic`), `custodian_user_id` (informativa), `active`, `created_at`.

- Check `indicators_thresholds_coherent`: con "más es mejor", verde ≥ amarillo; con "menos es mejor", verde ≤ amarillo.
- Check `indicators_cumulative_direction` (M-08): un indicador `cumulative_target` no puede ser `lower_is_better`. El motor (`validateIndicator`) aplica la misma regla en el formulario.
- Checks `indicators_green_threshold_finite` e `indicators_yellow_threshold_finite` (M-10): los umbrales no pueden ser `NaN`, `Infinity` ni `-Infinity`. En PostgreSQL `NaN` cuenta como mayor que cualquier número, así que el check de coherencia solo no lo frenaba.

### `commitments` — compromisos por unidad, indicador y periodo
`id`, `unit_id`, `indicator_id`, `period` (`AAAA-Qn` o `AAAA-MM`), `green_override`, `yellow_override`, `package_total` (≥ 0), `package_by_category` (objeto JSON, ej. `{"P0P1": 1500, "P2P3": 500}`), `notes`, `created_by`, `created_at`, `updated_at` (lo pone un trigger).

- Único por (`unit_id`, `indicator_id`, `period`).
- Check `commitments_override_pair`: verde y amarillo negociados van juntos o ninguno.
- Checks `commitments_green_override_finite`, `commitments_yellow_override_finite` y `commitments_package_total_finite` (M-10): si tienen valor, no puede ser `NaN`, `Infinity` ni `-Infinity`. Siguen admitiendo nulo.
- Editables por el custodio: `period`, los dos overrides, `package_total`, `package_by_category`, `notes`. No se pueden cambiar `unit_id`, `indicator_id` ni `created_by`.

### `measurements` — mediciones
`id`, `unit_id`, `indicator_id`, `measured_on` (fecha), `value` (≥ 0), `app_id` y `compliant` (cobertura), `category` y `kind` (`resolved` o `detected`, meta acumulada), `source`, `created_by`, `created_at`.

- `created_at` lo fija la BD al insertar (trigger); el usuario no lo elige.
- El usuario solo inserta con `source = 'manual'`. `automatic` lo pone el backend.
- Editables: `value`, `measured_on`, `app_id`, `compliant`, `category`, `kind`. No se pueden cambiar `unit_id`, `indicator_id`, `created_by` ni `source`.
- En meta acumulada `value` es **incremental**: lo resuelto o detectado ese día. El motor suma.
- Check `measurements_value_finite` (M-09): `value` no puede ser `NaN`, `Infinity` ni `-Infinity`. Aplica a inserciones y ediciones, de todos los roles y del backend.
- Trigger `measurements_category_guard` (M-08, `AFTER INSERT OR UPDATE`, función `private.check_measurement_category`). Si el indicador es `cumulative_target` y tiene `thresholds_by_category`, cada medición (resuelta, detectada o sin `kind`) debe cumplir:
  - `category` es `P0P1` o `P2P3` (exacto, con mayúsculas);
  - `value` es un entero ≥ 0, no nulo y como máximo 2^53 − 1 (9.007.199.254.740.991, el mayor entero seguro de JavaScript; M-09).
  
  Si no, la BD rechaza la fila con el código 23514. Aplica a todos, también al backend. Como el trigger corre después de RLS, un rol sin permiso sigue recibiendo 42501 aunque la fila esté mal. Solo valida filas nuevas o editadas: las anteriores a M-08, o las de un indicador que recibe categorías después, no se revalidan; el motor las descarta y lo dice en el motivo (ver [docs/indicadores.md](indicadores.md#color-mensual)).

### `targets` — metas parciales mensuales
`id`, `unit_id`, `indicator_id`, `month` (`AAAA-MM`), `target_value` (≥ 0, acumulada a ese mes), `created_at`. Única por (`unit_id`, `indicator_id`, `month`).

- Check `targets_target_value_finite` (M-10): `target_value` no puede ser `NaN`, `Infinity` ni `-Infinity`.

La gestora las crea y edita en **Metas** (`#/gestora/metas`, M-07). La pantalla solo cambia `target_value` de una meta existente y no borra metas. Desde M-09 la BD solo permite UPDATE de la columna `target_value` (privilegio por columna); cambiar `unit_id`, `indicator_id`, `month` o `id`, también por upsert, da 42501. Para otra unidad, indicador o mes se crea una meta nueva. La semilla trae metas para 2027-Q1 (un tercio, dos tercios y el total del paquete). Solo las usan los indicadores de meta acumulada sin categorías; VULN no.

### `evaluations` — color por unidad, indicador y mes
`id`, `unit_id`, `indicator_id` (nulo = color global de la unidad), `month`, `color` (`green`, `yellow`, `red`, `not_evaluated`), `value`, `sample_size`, `reason`, `escalation_level` (`normal`, `restricted`, `frozen`, `exception`), `restrictions` (lista), `evaluated_at`.

Única por (`unit_id`, `indicator_id`, `month`), con nulos iguales: permite el upsert idempotente de la evaluación mensual. Solo la escribe el backend.

### `exceptions` — excepciones del comité
`id`, `unit_id`, `scope` (`change_start` o `all`), `reason` (obligatorio, máx. 2000), `change_ref` (máx. 200), `expires_on`, `approved_by`, `created_at`, `revoked_at`, `revoked_by`.

Reglas del trigger `enforce_exception_rules` (solo para usuarios finales):
- Al crear: `approved_by` es quien la crea; vencimiento no anterior a hoy (fecha de America/Guayaquil); `change_start` exige `change_ref`; vencimiento como máximo 90 días después de la creación.
- Al editar: solo quien aprobó; `approved_by`, `unit_id`, `created_at` y `revoked_by` no cambian; acortar siempre se permite, alargar respeta el tope; el nuevo vencimiento no puede quedar en el pasado.
- Revocar: se marca `revoked_at`; la hora y el autor los pone el servidor. Una revocada ya no se edita.

### `alerts` — qué se notificó, a quién y cuándo
`id`, `unit_id`, `recipient_user_id`, `kind`, `payload` (JSON con `message`, `severity` y datos del disparador), `dedupe_key` (única), `sent_at`, `read_at`.

`kind` admite solo `color_change`, `pace_behind`, `critical_intake` y `exception_expired`. `dedupe_key` evita duplicar una alerta por disparador y destinatario. Solo la inserta el backend; el usuario solo puede cambiar `read_at` de las suyas.

### `audit_log` — auditoría
`id`, `actor` (uuid del usuario o `system:<rol>`; las Actions usan `system:evaluate`), `action`, `entity`, `entity_id`, `details` (JSON con `old` y `new`), `created_at`.

- Solo inserción: un trigger bloquea `UPDATE`, `DELETE` y `TRUNCATE`, incluso para el backend.
- Triggers de auditoría en `units`, `user_roles`, `indicators`, `commitments`, `measurements`, `targets` y `exceptions`.
- La evaluación escribe además `evaluation_upsert`, `escalation_applied`, `alert_sent`, `exception_expired`, `pace_snapshot` (estado diario del paquete) y `evaluation_reprocess`.

## RLS por rol

L = lee, E = escribe (insertar o actualizar), B = borra. "—" = sin acceso.

| Tabla | Gestora | Custodio | Comité | Líder |
|---|---|---|---|---|
| `units` | L E B | L (todas) | L | L (su unidad) |
| `user_roles` | L E B (todas) | L (las suyas) | L (todas) | L (las suyas) |
| `indicators` | L E B | L (todos) | L | L |
| `commitments` | L | L E (sus indicadores) | L | L (su unidad) |
| `measurements` | L | L E (sus indicadores) | L | L (su unidad) |
| `targets` | L E B | L (todas) | L | L (su unidad) |
| `evaluations` | L | L (filas de sus indicadores) | L | L (su unidad) |
| `exceptions` | L | — | L E (editar y revocar solo las suyas) | L (su unidad) |
| `alerts` | L (todas) | L (las suyas) | L (todas) | L (las suyas) |
| `audit_log` | L | — | L | — |

Además, cualquier usuario marca como leídas sus propias alertas (`read_at`).

Notas:
- La gestora no escribe mediciones ni compromisos (ADR 0005, decisión 3). Para corregir datos necesita el rol de custodio del indicador.
- El custodio lee todas las unidades y metas porque carga datos de cualquier unidad para su KPI.
- El custodio no lee excepciones.
- Los privilegios de tabla se conceden de forma explícita en cada migración. Las tablas nuevas nacen sin acceso para `anon` y `authenticated`.

## Dónde se prueba

- pgTAP: `supabase/tests/` (esquema, una prueba por rol en `010`–`014`, auditoría, endurecimiento, excepciones) y `supabase/tests/security/` (escalada, privilegios por catálogo, `audit_log` inmutable, deduplicación de alertas).
- Pentest de API: `tests/security/api/` recorre la matriz rol × tabla × operación contra PostgREST (`matrix.js`), IDOR entre unidades e indicadores y JWT manipulados.
