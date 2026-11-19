# Motor de escalada (candados) — C-01

Funciones puras en `engine/escalation.js` (ESM, sin dependencias). Las usan el front y las GitHub Actions.

## API

- `unitColor(colors)`: devuelve el peor color de los indicadores (rojo > amarillo > verde). Ignora `not_evaluated`. Si no queda ningún color evaluado, devuelve `not_evaluated`.
- `quarterOf('YYYY-MM')`: devuelve `'YYYY-Qn'` (trimestre calendario).
- `evaluateEscalation(history, { yellowMonth2EscalatesLikeRed = false, activeExceptions = [], asOf })`
  devuelve `{ level, restrictions, reason, monthsInBreach, suppressedRestrictions, appliedExceptions, expiredExceptions, revokedExceptions, authorizedStarts }`.
- `carryOver({ packageTotal, resolved, newCriticalByMonth: [m1, m2, m3] })` devuelve `{ effectiveTotal, pendingCarry }`.
  `effectiveTotal = packageTotal + m1 + m2` y `pendingCarry = max(effectiveTotal - resolved, 0) + m3`.

`history` contiene los meses del trimestre actual: como máximo 3, consecutivos y sin huecos, en orden ascendente y ninguno posterior al mes de `asOf`. `asOf` y `expiresOn` deben ser fechas reales del calendario (se rechaza `2026-02-31`). Cada excepción necesita un `id` de texto no vacío. Si algo no cumple, la función lanza `RangeError` o `TypeError`.

## Tabla de verdad

`monthsInBreach` es la racha de meses amarillos o rojos con la que termina el historial. Un mes `green` o `not_evaluated` corta la racha y reinicia el conteo.

| Racha | Último color | Flag Q-03 | Nivel | Restricciones |
|---|---|---|---|---|
| 0 | verde / sin evaluar / sin datos | — | `normal` | — |
| 1 | amarillo o rojo | — | `restricted` | `no_new_change`, `no_backlog_additions`, `prioritize_run` |
| 2 o 3 | rojo | — | `frozen` | `freeze_all_change`, `all_capacity_to_run` |
| 2 o 3 | amarillo | `false` (por defecto) | `restricted` | igual que el mes 1 |
| 2 o 3 | amarillo | `true` | `frozen` | igual que rojo |

## Excepciones

Una excepción está vigente si `expiresOn >= asOf` (se comparan fechas `YYYY-MM-DD` en America/Guayaquil). Las vencidas se ignoran y sus ids se devuelven en `expiredExceptions`.

- `scope: 'all'` vigente: el nivel pasa a `exception`, sin restricciones. Lo que se suspendió se devuelve en `suppressedRestrictions`. Este alcance tiene prioridad sobre `change_start`.
- `scope: 'change_start'` vigente: quita `no_new_change` cuando esa restricción está activa, es decir en `restricted`. En `frozen` el congelamiento sigue igual (restricciones y `appliedExceptions` no cambian) y la excepción se reporta en `authorizedStarts: [{ id, change_ref }]` como inicio puntual autorizado (ADR 0003, C-02).
- Una excepción con `revokedOn` (fecha `YYYY-MM-DD` en America/Guayaquil) menor o igual que `asOf` está revocada: se ignora y su id va en `revokedExceptions`. `changeRef` es opcional en el motor (filas previas a C-02); la BD lo exige al comité para `change_start`.

## Excepciones (`engine/exceptions.js`, C-02)

- `EXCEPTION_MAX_DAYS = 90`: igual que `private.exception_max_days()` en la BD.
- `exceptionStatus({ expiresOn, revokedOn }, asOf)` devuelve `'active' | 'expired' | 'revoked'`.
- `validateExceptionDraft(draft, today)` valida el formulario del comité (unidad, alcance, motivo, change si es `change_start`, vencimiento entre hoy y hoy + 90 días) y devuelve los errores por campo.
- `addDays`, `maxExpiry`: aritmética de fechas de calendario.
- `exceptionFromRow(row)`: fila de `public.exceptions` (`expires_on`, `change_ref`, `revoked_at`) al formato del motor; `revokedOn` es la fecha de `revoked_at` en America/Guayaquil. La usan el front y las Actions (`scripts/lib/build.js`, `scripts/lib/alerts.js`).
- `evaluateEscalation` clasifica cada excepción con `exceptionStatus` (regla única).
