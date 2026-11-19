# V-01 + V-02 + V-03 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: tres vistas de solo lectura (`#/lider`, `#/comite`, `#/gestora/completitud`) que pintan datos de `units`, `indicators`, `evaluations` (razón, restricciones), `targets`, `commitments`, `measurements`, `exceptions` (motivo, ref. de change) y el `payload` JSON de `alerts`; una sola escritura nueva desde el front (`alerts.read_at`); `scripts/ci/seed-evaluations.sh`, que usa la clave secreta **local** de Supabase en los jobs e2e de `ci.yml` y `dast` de `seguridad.yml`. No hay migraciones ni tablas nuevas: RLS y privilegios no cambian.

## Pruebas de seguridad añadidas o actualizadas

| Archivo | Casos | Categoría |
|---|---|---|
| `tests/security/front-v01-v03.test.js` (nuevo) | 11: XSS de `alertsInbox`, `exceptionsTable`, `escalationInfo`/`colorBadge`, `monthPicker` con payloads (solo texto, clases por lista blanca, sin `on*`); vistas V-01..V-03 sin sumideros HTML; `describeAlert` con payload no objeto, `message` no string y `__proto__` (sin contaminación de prototipos); etiquetas sin claves heredadas; `alerts.js` solo `select` + `update({ read_at })` con `.eq('id').is('read_at', null)` y filtro por destinatario; `evaluations`/`targets` solo lectura; sin claves secretas en `src/data`; `/gestora/completitud` solo para la gestora | 1, 3, 4 |
| `tests/security/workflows.test.js` (regla actualizada) | 2: `EVALUATE_ALLOW_FUTURE` solo lo exportan `scripts/ci/integration.sh` y `scripts/ci/seed-evaluations.sh` (se recorre `scripts/` entero); ambos con `set -euo pipefail`, sin xtrace, guarda local antes del `export`, `::add-mask::` y sin imprimir la clave ni pasarla a `GITHUB_ENV`/`GITHUB_OUTPUT`. Además, en `ci.yml` el paso corre en el job con `supabase start`, sin `secrets.*`, sin permisos de escritura y sin que la clave llegue al build | 5, 6 |
| `e2e/security/csv-injection.spec.js` | 5 (antes `test.fixme`, ahora activos): en `#/custodio/mediciones` (custodio2 › AVAIL), un CSV con una fila válida y otra con `=HYPERLINK(...)`, `+cmd\|...`, `@SUM...`, `-2+3+cmd...` o `\t=1+1` muestra el error "posible fórmula" como texto, deja el botón de guardar deshabilitado y no envía ningún POST/PATCH a `/rest/v1/measurements` (todo o nada). Sin diálogos, sin violaciones de CSP y sin nodos inyectados | 3 |
| `e2e/security/dashboards-payload-xss.spec.js` (nuevo) | 2: líder y comité con respuestas de `alerts`, `evaluations` y `exceptions` sustituidas por filas hostiles (`page.route`): `payload.message`, `kind` desconocido, `sent_at`, color, nivel, restricciones, razón, motivo y `change_ref` se ven literales y no ejecutan nada | 3, 4 |
| `e2e/security/xss.spec.js` | rutas ampliadas: `#/gestora/indicadores`, `#/gestora/completitud`, `#/comite/excepciones`, `#/custodio/compromisos`, `#/custodio/mediciones` | 4 |

Otra sesión de seguridad trabaja en paralelo en este mismo worktree. Suyos son `e2e/security/dashboards-v01-v03.spec.js` (IDOR del líder por la red y por la API con `eq`/`or=`/embebidos, redirección de rutas de otros roles, negación de escrituras en `alerts`, PATCH de "Marcar como leída" con cuerpo solo `read_at`, XSS almacenado en excepciones) y el paso `seed-evaluations.sh` en `seguridad.yml › dast`. No dupliqué esos casos. Reviso en estático que ese paso cumple las mismas reglas que el de `ci.yml`.

Ya existían y siguen cubriendo la BD, sin cambios: `tests/security/api/idor-escalation.test.js` (el destinatario solo cambia `read_at` y no puede tocar `payload`, `recipient_user_id`, `kind` ni `dedupe_key`; no puede marcar alertas ajenas; `in=`/`or=` hacia otra unidad devuelven solo lo propio) y `rls-matrix.test.js` (lectura por rol de todas las tablas).

## Resultados del pipeline
- `node --test 'tests/security/*.test.js'` en local: 454 pruebas, 452 pasan, 0 fallan, 2 se omiten. Las 2 omitidas ya existían y quedan fuera de este ítem.
- Último commit de la rama (`8403b5a`), antes de mis cambios: CI en verde (https://github.com/apivasa/practica_agente/actions/runs/44635617337) y Seguridad en verde (https://github.com/apivasa/practica_agente/actions/runs/44635617324). Este último incluye gitleaks, semgrep, CodeQL, npm audit, el pentest RLS/API y ZAP baseline.
- Las e2e nuevas o activadas (`csv-injection`, `dashboards-payload-xss`, rutas nuevas de `xss`) **todavía no han corrido en CI**: lo harán cuando el orquestador haga commit y push. Si alguna falla, el veredicto pasa a revisión.

## Hallazgos
- **Informativo · 5 · `scripts/ci/seed-evaluations.sh:16` (y `integration.sh`).** La guarda `case http://127.0.0.1:*` es un patrón glob y también aceptaría `http://127.0.0.1:1@host-remoto`. No es explotable: la URL sale de `supabase status` local y no la controla un atacante. El control efectivo es `allowFutureFromEnv` (`scripts/lib/dates.js:86-92`), que compara el `hostname` ya parseado. No hace falta corregirlo.
- **Informativo · 3.** No hay exportación CSV en la app. Si se añade, `csv-injection.spec.js` debe cubrir que la salida nunca empiece por `= + - @ \t \r`. Está anotado en la cabecera del archivo.

## Verificado sin hallazgos
1 (el líder solo lee su unidad, RLS sin cambios, la única escritura nueva es `read_at`), 3 (fórmulas CSV rechazadas en la pantalla real; el `payload` JSON de alerts es inerte), 4 (todo el DOM pasa por `el()`/`textContent`, las clases CSS van por lista blanca y el único `href` es una ruta constante), 5 (`ci.yml`: acciones fijadas por SHA, `permissions: contents: read`, sin `secrets.*` en el job e2e; la clave secreta local queda enmascarada y no sale del script), 6 (sin dependencias nuevas), 8 (semilla sin cambios y ficticia).
