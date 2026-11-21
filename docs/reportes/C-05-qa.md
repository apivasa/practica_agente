# C-05 — Informe QA
Veredicto: VERDE

Revisión independiente del envío de alertas por correo (Resend) en la rama `item/C-05` (código del desarrollador en 29dc6e0). Las pruebas se escribieron a partir del criterio de aceptación y de `docs/diseno.md` ("correo vía Resend a cada destinatario, las mismas alertas de su bandeja"). Las alertas se generan con la evaluación real (`runMonthly` / `runDaily`) sobre el escenario semilla en memoria. Resend se simula con un `fetch` inyectado: ninguna prueba hace llamadas de red.

## Criterio de aceptación
| Punto | Estado | Evidencia |
|---|---|---|
| Resend simulado: una alerta → un correo por destinatario | cumplido | Cada fila de `alerts` produce un POST con `to` de un solo elemento (sin cc ni bcc), dirigido al correo de su `recipient_user_id`. Cada disparador llega al líder de su unidad y al comité, un correo a cada uno. La gestora no recibe nada. |
| Correr dos veces no reenvía | cumplido | La segunda corrida no llama a Resend ni añade auditoría. Reprocesar la evaluación tampoco reenvía. Una alerta nueva sale sola. El `Idempotency-Key` se mantiene igual entre reintentos. En SQL, la marca condicional `where emailed_at is null` no se aplica una segunda vez. |
| Sin secreto el workflow no falla y lo anota | cumplido | Con `RESEND_API_KEY` ausente, vacía o con solo espacios, el paso termina con código 0, emite `::notice::` y no toca la BD ni Resend. El paso del workflow no está condicionado al secreto y no usa `continue-on-error` ni `\|\| true`. |
| El correo no expone datos de otras unidades | cumplido | Cada correo nombra solo su unidad: no aparecen nombres ni ids de otras unidades, ni correos o ids de otras personas, ni claves internas. Solo se usan `unit_name` y `message` del payload. El RLS de `alerts` no cambió (pgTAP por rol). |
| Cada envío en auditoría | cumplido | Hay una fila `alert_emailed` por correo enviado, con `entity_id` = alerta, `unit_id`, `recipient_user_id`, `provider_id` y el número de intento, sin el correo del destinatario. Los fallos quedan como `alert_email_failed`. Un envío que otra corrida concurrente ya había marcado no se audita dos veces. |

También se cubrieron los bordes que pidió el orquestador:
- **Error de Resend:** el error 5xx persistente se reintenta 3 veces (una por corrida) y luego se deja de intentar. Un 429 seguido de un éxito queda enviado con 2 intentos.
- **Límite de intentos:** con 2 intentos previos todavía se hace el tercero; con 3 ya no.
- **Fallos que no detienen el resto:** un fallo en una alerta no frena las demás, y el paso termina en 0 con `::warning::`.
- **Red caída:** se registra como fallo, con el intento y la auditoría correspondientes.
- **Destinatario sin correo válido** (ausente o con varios separados por coma): no se llama a Resend y el fallo queda auditado.
- **Escape HTML:** nombres y mensajes con `<img onerror>` o `<script>` llegan escapados. El asunto queda en una sola línea aunque haya intento de inyectar `\r\nBcc:` o marcas bidi.
- **Ventana de 7 días:** una alerta de justo 7 días atrás se envía; una de 7 días y 1 ms, no. El rango configurable va de 1 a 31.
- **Enlace a la app:** solo se acepta https sin credenciales.
- **Fugas en errores:** si Resend devuelve la clave o el correo en el mensaje de error, no llegan ni al log ni a la auditoría.

## Pruebas añadidas
- `tests/scripts/qa-c05.test.js`: 31 casos (de extremo a extremo con la evaluación real, idempotencia, reintentos, ventana, ausencia de secreto, inspección estática del workflow, aislamiento entre unidades, escape, auditoría).
- `tests/engine/qa-c05.test.js`: 14 casos (contenido del correo, etiquetas compartidas con la bandeja, saneamiento, topes, enlace).
- `supabase/tests/121_qa_c05.test.sql`: 22 aserciones pgTAP. Cubren estructura, tope de `email_attempts` (100 sí, 101 no) e idempotencia de la marca. Por rol: el líder no puede desmarcar `emailed_at` (ni junto con `read_at`), crear o borrar alertas, ni falsificar `audit_log`. Ningún líder ve alertas de otra unidad. Comité, gestora, custodio y anon no pueden reiniciar intentos ni desmarcar.

## Resultado CI
Run en b3f8cbc, que incluye estas pruebas: CI `success` (build: lint, 2003 pruebas unitarias con 0 fallos y build; pgTAP; integración contra Supabase local con `email-integration.js`; e2e). Seguridad `success`.
- https://github.com/apivasa/practica_agente/actions/runs/44857340610

Hubo dos runs intermedios en rojo:
- c4544c4 y a0163ef: un error de lint `no-control-regex` en `tests/security/automation-c05.test.js`. El archivo es de seguridad, no mío, y lo corrigió seguridad en b3f8cbc.
- c4544c4: mi primer pgTAP usaba un CTE de escritura anidado; lo corregí en a0163ef.

## Cobertura engine/
99,96 % de líneas (`engine/alert-email.js`: 100 % de líneas y 98,15 % de ramas). La meta es ≥ 95 %. Medida con `node --test --experimental-test-coverage --test-coverage-include='engine/**'`.

## Hallazgos
Ninguno bloqueante.
1. **Baja (diseño a confirmar).** Una alerta que sale de la ventana de 7 días sin haberse enviado nunca se envía, y tampoco queda registro de que se omitió. Esto pasa, por ejemplo, si el workflow estuvo apagado o si `RESEND_API_KEY` se configura más tarde. Evita inundar de correos al activar el envío, pero no queda rastro. Reproducir: una alerta con `sent_at` = ahora − 7 días − 1 ms no produce llamada ni auditoría (caso "ventana de 7 días" en `tests/scripts/qa-c05.test.js`).
2. **Baja.** La protección contra duplicados en Resend (`Idempotency-Key`) dura 24 h. Si Resend aceptó el correo pero falló la marca `emailed_at`, y la siguiente corrida exitosa llega más de 24 h después, el destinatario recibiría el correo dos veces. Hoy el workflow corre dos veces al día, así que es poco probable. Reproducir: caso "Idempotency-Key estable…", con un intervalo de más de 24 h entre corridas.
3. **Informativo.** El envío real a Resend no está verificado: falta el secreto `RESEND_API_KEY`, que es compuerta del usuario (P-09). Todo lo verificado usa Resend simulado.
