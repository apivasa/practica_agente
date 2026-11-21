# F-13 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: no hay endpoints, tablas ni permisos nuevos. Cambian dos decisiones de automatización:
- `scripts/lib/email.js`: `runEmailStep` falla cerrado (código 2) si la BD no implementa `markAlertsEmailExpired` (`REQUIRED_F12_DB_METHODS` y `REQUIRED_EMAIL_DB_METHODS`). La ruta `expired` ya no tiene la variante no atómica `markAlertsEmailSkipped + insertAudit`. Cierra H-F12-01.
- `scripts/health/lib.js`: el check `deploy-main` da `warn`, sin abrir issue, cuando el último despliegue fallido tiene un run más nuevo de `deploy.yml` pendiente dentro de `maxPendingMin` (`newerPendingRun`).

## Pruebas de seguridad añadidas

`tests/security/automation-c06.test.js` (categorías 1, 6 y 8):
- 2 pruebas actualizadas, ninguna borrada ni saltada:
  - Línea 279: error de BD con la clave en el mensaje.
  - Línea 300: vencidas auditadas sin datos personales.
  - Las dos fijaban el comportamiento viejo. Ahora el `fakeDb` emula la RPC atómica con las mismas condiciones que el SQL de F-12, y la opción `rpc:false` sirve para la BD sin RPC.
- `createDb` ahora también exige `markAlertsEmailExpired`.
- 11 casos nuevos en el bloque «F-13 vencidas solo por la RPC atómica»:
  - `REQUIRED_EMAIL_DB_METHODS` incluye los cuatro métodos y está congelado.
  - `runEmailStep` sin la RPC da 2. No envía, no marca, no audita, no usa `markAlertsEmailSkipped` y no filtra secretos.
  - 6 valores que no son función en `markAlertsEmailExpired` dan 2.
  - `sendAlertEmails` sin la RPC no marca y registra el error.
  - Si la RPC falla con la clave en el mensaje, nada queda marcado ni auditado, no hay fallback y el error sale saneado.
  - A la RPC solo llegan ids de vencidas, el corte y la ventana.

`tests/security/health-deploy-f13.test.js` (categorías 5 y 6), 41 casos:
- Control `warn`, con cada estado pendiente.
- Sin run nuevo da `fail`.
- 6 eventos ajenos (`pull_request`, `pull_request_target`, `schedule`, `workflow_run`, `repository_dispatch`, sin evento) no cubren el fallo.
- No cubren el fallo un pendiente anterior al fallo, un pendiente con el mismo `created_at`, un pendiente atascado ni un `run_started_at` viejo.
- Un atasco más viejo anula el aviso.
- Si el run que cubría termina en `failure`, el resultado es `fail`.
- Cancelado sobre fallo más un pendiente sigue en `fail`.
- 19 casos de timestamps ilegibles en `created_at` y `run_started_at` del pendiente y en `created_at` del fallo, más entradas basura en `newerPendingRun`.
- Detalle del `warn` exacto: solo `status`, `conclusion` y `html_url`.
- `check.js` con `warn` escribe `::warning:: aviso` con código 0. `deploy-main` no entra en `failures` (no se abre issue) y no salen el token ni campos controlables.
- Un pendiente de `pull_request` no evita el issue.

Sin casos en las categorías 2, 3, 4 y 7: el ítem no las toca. La regresión completa corre en `seguridad.yml`.

Docs: `docs/seguridad/modelo-amenazas.md` (sección F-13: T-F13-01 y T-F13-02) y `docs/seguridad/hallazgos.md` (H-F12-01 corregido, H-F12-02 revisado, H-F13-01 y H-F13-02 nuevos).

## Resultados del pipeline

Run de Seguridad sobre f159e82: success. https://github.com/apivasa/practica_agente/actions/runs/44893577853

| Paso | Resultado |
|---|---|
| gitleaks (historial completo) | success |
| semgrep | success |
| CodeQL (actions, javascript-typescript) | success |
| npm audit (producción) | success |
| DAST (e2e de seguridad + ZAP baseline) | success |
| pentest API (PostgREST/Auth, Supabase local) | success |
| `tests/security` | success |
| S-05 fase A y fase B | skipped (no aplican en PR) |

Seguridad sobre be1f6d3, con las pruebas del tester encima: success. https://github.com/apivasa/practica_agente/actions/runs/44893904840

En local, `node --test tests/security/*.test.js` da 1327 pass, 0 fail y 2 skip. Los 2 skip ya existían: son las pruebas de `dist/` condicionadas, que corren en `seguridad.yml`.

CI sobre f159e82 está en rojo (https://github.com/apivasa/practica_agente/actions/runs/44893577841). Los 32 fallos están todos en `tests/scripts/` (email-c05, email-c06, qa-c05, qa-c06, qa-f11, qa-f12, qa-v04b, f11-fixes, f12-fixes y qa-c03). Son pruebas del tester y del desarrollador que fijan la ruta no atómica vieja. Ninguno está en `tests/security/`, y no es un hallazgo de seguridad. Le toca al tester, que ya empujó be1f6d3 en paralelo.

## Hallazgos

- **H-F13-01 · Baja · 5 · `scripts/health/lib.js`, `assessDeploy` (rama `covering`).**
  - Qué pasa: el aviso no mira lo que hay antes del fallo. Con `[pendiente nuevo, failure, failure, failure]` el check da `warn`.
  - Impacto: si cada corrida de `salud.yml` (cada 6 h) coincide con un run nuevo en cola, una cadena de despliegues fallidos nunca abre issue. El rojo esperado de H-F11-06 es un único fallo seguido del run que lo supera.
  - Quién puede provocarlo: hace falta escritura en `main`, y cada `::warning::` queda en el log.
  - Cómo reproducir: `assessDeploy(DEPLOY_RULE, { workflow: { state: 'active' }, runs: [queued hace 5 min, failure hace 60, failure hace 400, failure hace 800] (todos push), now })` devuelve `warn`.
  - Corrección sugerida: cubrir solo si el despliegue completado anterior al fallo terminó en `success`, o si el fallo tiene menos de `maxPendingMin`. Con dos fallos seguidos, `fail`.
  - Estado: propuesto como ítem.
- **H-F13-02 · Info · 5 · `scripts/health/lib.js`, `newerPendingRun`.**
  - Qué pasa: un `created_at` o `run_started_at` en el futuro hace negativa la antigüedad, así que el run siempre cubre. Además, `Date.parse` convierte valores que no son string (`12` pasa a ser el año 2001).
  - Por qué no es explotable: la API de GitHub genera estos campos en ISO 8601 y nadie los controla.
  - Cómo reproducir: un pendiente con `created_at` = now + 10 h sobre un `failure` da `warn`.
  - Corrección sugerida: rechazar los timestamps que no sean string y los que pasen de now + unos minutos de margen.
  - Estado: registrado.
- **H-F12-02 (revisado, se mantiene aceptado, Info).**
  - Riesgo: `p_before` futuro en `mark_alerts_email_expired` marcaría alertas recientes.
  - Por qué se acepta: solo service_role tiene EXECUTE, y ya puede hacer UPDATE directo en `alerts` y escribir en `audit_log`. La RPC no abre capacidad nueva, y moverle el corte cambia la firma y la semántica a cambio de un beneficio marginal. Acepto el argumento del desarrollador.

## Verificado sin hallazgos

- **H-F12-01 cerrado (cat. 8).**
  - No existe ruta no atómica para `expired`.
  - Sin la RPC, `runEmailStep` da 2 antes de leer alertas o llamar a Resend. `sendAlertEmails` aislado no marca nada.
  - Quitar `canSkip` de la condición no abre nada, porque la marca solo la hace la RPC.
- **El `warn` no tapa un fallo real (cat. 5) en estos casos:**
  - run de otro evento (incluidos PR de fork con rama `main`);
  - run creado antes del fallo o a la vez;
  - run atascado, o un atasco más viejo que convive con el run nuevo;
  - `run_started_at` viejo;
  - timestamps ilegibles para `Date.parse` (fallan cerrado);
  - el run que cubría termina en fallo (`fail` en la corrida siguiente);
  - cancelado sobre fallo.
  - La rama viene filtrada por la API (`branch=main`) y, para `push`/`workflow_dispatch`, solo la elige quien tiene escritura.
- **Sin filtración (cat. 6):** el detalle del `warn` solo lleva `status`, `conclusion` y `html_url`. Los errores de la API de GitHub solo llevan método, ruta y estado HTTP, nunca el token. El mensaje nuevo de `email.js` es estático y los errores de la RPC pasan por `sanitizeError`.
