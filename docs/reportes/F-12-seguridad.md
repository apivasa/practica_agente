# F-12 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no

Superficie nueva: la primera función de `public` que PostgREST ve por `/rest/v1/rpc`: `public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)`. Está en la migración `20261202120000_alert_email_expired_rpc_f12.sql` y la usa `scripts/lib/db.js` con la clave secreta. Marca `expired` y escribe `alert_email_skipped` en `audit_log` en una sola sentencia. También cambia `scripts/ci/check-main-tip.sh`: `workflow_dispatch` ya no está exento (H-F11-02), el `status` de compare se sanea (H-F11-05) y el mensaje explica el rojo esperado de `--strict` (H-F11-06). El modelo de amenazas tiene las filas nuevas T-F12-01..05 y la fila T-API-07 actualizada.

Revisado sobre `item/F-12` @ c8229db (más ddf9afa, que es el informe de arquitectura). Las pruebas se publicaron en d94e175.

## Pruebas de seguridad añadidas o actualizadas

| Archivo | Casos | Categorías |
|---|---|---|
| `tests/security/api/alert-email-expired-f12.test.js` (nuevo) | 19. Para cada uno de los 8 actores (7 roles más anon): 4 variantes de POST (normal, `Content-Profile`, `Prefer: params=single-object`, parámetros extremos) y una de GET, todas denegadas, sin marcar ni auditar nada. Más: suplantación por cabecera; 8 entradas de inyección o fuera de rango contra el backend (→ 400, sin efecto); backend con exactamente una fila de auditoría por alerta e idempotencia; para cada actor, ni DELETE, ni PATCH, ni INSERT en la auditoría, ni desmarcar la alerta | 1, 3, 8 |
| `supabase/tests/security/054_security_alert_email_expired_f12.test.sql` (nuevo) | 14. La única función propia de `public` es esta; INVOKER; `search_path=""`; sin SQL dinámico; EXECUTE no está concedido a PUBLIC, anon, authenticated ni authenticator; ninguna función de `public` es ejecutable por usuarios; el líder recibe 42501; **con EXECUTE concedido por error, sigue en 42501** (defensa en profundidad); nada marcado ni auditado; id hostil → 22P02; ventana fuera de rango; service_role marca; service_role no puede editar la auditoría | 1, 3, 8 |
| `tests/security/deploy-f12.test.js` (nuevo) | 49. Dispatch con y sin `--strict`, en los intentos 1, 2 y 7, con API caída, superado por código y compare caído: nunca `deploy=true` y el token no aparece en la salida. Dispatch con la punta o solo con docs → 0. Variantes del nombre del evento. Sin salida temprana. Pasos de `deploy.yml`. 13 `status` hostiles × push/dispatch × con/sin `--strict`: ninguna línea `::` inyectada. 5 `status` que no son texto. Estático de la migración (revoke y grant, sin definer ni dinámico). La RPC solo se llama desde `scripts/lib/db.js` y no desde `src/`. Correo: con la RPC no hay UPDATE ni `insertAudit` aparte. Si la RPC cae no hay fallback ni envío y la clave no se filtra. `createDb` pasa los parámetros tipados y filtra ids | 1, 3, 5, 8 |
| `tests/security/deploy-f11.test.js:100` (actualizado, no omitido) | 1. «workflow_dispatch aplica la regla de punta»: API caída → 1 (y sí consulta `commits/main`); punta → 0; superado por código → 1 | 5 |
| `tests/security/api/matrix.js` | `RPC_ALLOWLIST = ['mark_alerts_email_expired']`, con la justificación al lado. Desbloquea `rls-matrix.test.js` › catálogo y OpenAPI | 1 |

En local: `node --test 'tests/security/*.test.js'` → 1275 pasan, 0 fallan.

## Resultados del pipeline (d94e175)

- Seguridad: https://github.com/apivasa/practica_agente/actions/runs/44888979667, **success**. gitleaks (historial completo) ✓, semgrep ✓, CodeQL (actions, JS/TS) ✓, npm audit ✓, DAST (e2e de seguridad y ZAP baseline) ✓, `tests/security` ✓. Pentest API ✓: 583 pasan y 0 fallan, entre ellas las 19 de F-12 y el catálogo de `rls-matrix` con la RPC ya en la lista permitida.
- CI: https://github.com/apivasa/practica_agente/actions/runs/44888979674. pgTAP ✓ (incluye 054 y 124) e integración ✓. **build ✗ por 5 pruebas que no son de seguridad** y que siguen exigiendo el comportamiento viejo, «workflow_dispatch se exime»: `tests/scripts/f11-fixes.test.js:122` y `:215` (desarrollador), y `tests/scripts/qa-f11.test.js:68`, `:330` y `:396` (tester). Hay que actualizarlas a la regla nueva (lo hacen sus dueños). No es un hallazgo de seguridad, pero el merge necesita CI en verde.

## Hallazgos

| ID | Severidad | Categoría | Ubicación | Reproducción | Corrección sugerida |
|---|---|---|---|---|---|
| H-F12-01 | Info | 8 · Auditoría | `scripts/lib/email.js` (rama `else if (ids.length > 0)` de la ruta `expired`) | Una BD sin `markAlertsEmailExpired` vuelve al UPDATE y `insertAudit` por separado, que no es atómico. `createDb` siempre implementa el método, así que en producción esta rama no se alcanza. | Exigir el método en `REQUIRED_C06_DB_METHODS` (o crear una lista F-12) y quitar el fallback |
| H-F12-02 | Info | 1 · RPC | `mark_alerts_email_expired` (`p_before`, `p_skipped_at`) | `p_before` lo pone quien llama; con una fecha futura marca alertas recientes. Solo service_role puede llamarla, y ya tiene UPDATE directo en `alerts`: no da ninguna capacidad nueva. | Opcional: calcular el corte dentro de la función y rechazar `p_before > now()` |

Registrados en `docs/seguridad/hallazgos.md`. En el mismo archivo, H-F11-02 y H-F11-05 pasan a **Corregido** y H-F11-06 a **Aceptado y documentado**. Falta reflejar H-F11-06 en `docs/despliegue.md`, que es tarea del documentador.

## Verificado sin hallazgos

- **1 · RPC y RLS:** anon y los 7 usuarios de rol reciben 401/403 en la RPC por todas las variantes probadas, y la BD confirma que no se marcó ni auditó nada. SECURITY INVOKER con `search_path=''`: aunque EXECUTE quedara abierto por error, el usuario no tiene UPDATE de `email_skipped_at` ni INSERT en `audit_log`. Ninguna otra función de `public`.
- **3 · Inyección:** los parámetros están tipados y no hay SQL dinámico. Los valores hostiles terminan en 400/22P02 sin efecto. En `check-main-tip.sh`, `HEAD_SHA` y la punta se validan contra `^[0-9a-f]{40}$`, el repo contra la regex de siempre, y `status` queda en `[a-z_]`.
- **5 · Actions:** el dispatch sigue la regla de punta con y sin `--strict`. Falla cerrado si la API cae (en commits o en compare, en cualquier intento), sin `deploy=true` y sin imprimir el token. La lista de eventos sigue cerrada. `deploy.yml` no tiene `if:` ni `continue-on-error` en los pasos de la compuerta.
- **8 · Auditoría:** la marca y la auditoría van en el mismo CTE (la atomicidad está probada en `124_*` con un trigger que falla). Es idempotente. `audit_log` es inmutable incluso para service_role y la auditoría no guarda correos.
- **6 · Secretos:** la huella nueva de `.gitleaksignore`, `933e2770b1053e574fca0c90f1adab617fd62360:tests/scripts/f12-fixes.test.js:generic-api-key:151`, es exacta: en ese commit la línea 151 es `const CONFIG = { apiKey: 're_F12TESTKEY_no_leak_1234', ... }`, una clave ficticia con el mismo formato que las de F-11. En c8229db ya se arma en tiempo de ejecución. gitleaks del historial completo ✓.
