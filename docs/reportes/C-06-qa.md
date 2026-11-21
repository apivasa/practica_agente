# C-06 — Informe QA

Veredicto: VERDE (condicionado a la huella de gitleaks del hallazgo QA-C06-1; ver abajo)

Rama: `item/C-06`. Código revisado: 847cf6e (desarrollador) más el runbook del arquitecto-SRE (759b491) y las pruebas de seguridad (3aa6d7e).

## Criterio de aceptación (plan maestro, fila C-06)

| Punto | Estado | Evidencia |
|---|---|---|
| H-ARQ-C05-01: fila `correo-alertas.yml` en `WORKFLOW_RULES`, con su prueba | Cumplido | `qa-c06 [H]`: la fila existe y exige producción. El paso `Enviar correos` existe en el workflow. Falla si el workflow está deshabilitado (aun sin producción), si el run falló, si tiene más de 30 h o si el paso se omitió con producción activa. `qa-v04 [C]` ahora espera 5 workflows. `qa-v04 [E]` pasa con el runbook del arquitecto. |
| H-C05-01: no se envía si el destinatario perdió el rol o la unidad, o si está bloqueado; se audita `alert_email_skipped` | Cumplido | `qa-c06 [S]`, 10 casos. Reproduje el hallazgo: el líder pierde el rol después de creada la alerta y el correo no sale. También probé: traslado a otra unidad, comité que deja el comité, gestora o custodio que no habilitan el correo, bloqueo futuro (+1 s), bloqueo vencido o igual a ahora (sí envía) y usuario borrado o inexistente. La omisión no consume intentos, no deja `alert_email_failed` y no se reintenta aunque el usuario recupere el rol. La auditoría no lleva correos ni la clave. |
| H-C05-02: `sanitizeError` redacta `sb_secret_` y JWT | Cumplido | `qa-c06 [R]`, 4 casos: no queda ningún fragmento de la clave; no quedan cabecera, payload ni firma del JWT (tampoco tras `Bearer`); varias credenciales en un mismo mensaje. De extremo a extremo, un error 500 y uno de red con credenciales no llegan ni al log ni a `audit_log`. |
| H-ARQ-C05-02: exit 1 solo si todo falla por 401/403 | Cumplido | `qa-c06 [X]`, 8 casos. Todo 401, todo 403 o una mezcla de ambos → 1, con un `::error::` que remite a la clave y al remitente. En estos casos sale 0: si se envía al menos uno; si hay un 401 junto a un 500, un 429 o un error de red; si hay un 401 junto a un destinatario sin correo; si solo hay omisiones; si no hay pendientes. Tras 3 intentos con 401, la siguiente corrida sale 0. |
| H-ARQ-C05-04: `APP_URL` con valor por defecto | Cumplido | `qa-c06 [U]`, 4 casos. Si la variable falta, está vacía o tiene solo espacios, se usa `DEFAULT_PAGES_URL`, la misma URL de `salud.yml`. El correo lleva ese enlace en el HTML y en el texto (comparo la URL parseada, como pide F-08). Un `http:` da 2 y no envía nada. |
| QA-C05-1: las alertas que salen de la ventana sin enviarse se auditan una vez | Cumplido | `qa-c06 [V]`, 5 casos. Una alerta vencida no se envía, queda `expired` y genera una sola auditoría; en 2 corridas más no se repite. Borde: `sent_at` igual al inicio de la ventana se envía; 1 ms antes vence. No vencen las alertas ya enviadas, las ya omitidas ni las que agotaron sus 3 intentos. Sí se audita la que tenía 2 intentos. Se respeta `lookbackDays` configurado. |
| pgTAP por rol de las columnas nuevas de `alerts` | Cumplido | `supabase/tests/123_qa_c06.test.sql`, 26 casos (CI `db (pgTAP)` en verde). Hay un caso por rol que debe y otro que no debe: el destinatario ve su omisión y la sigue marcando como leída, pero no la desmarca; el otro líder no ve la alerta ajena ni puede marcar la propia; el custodio no ve ni marca nada; comité y gestora leen pero no escriben; anon no toca nada; el backend marca y audita. Cubre además los 4 motivos admitidos, el motivo vacío rechazado y la omisión intacta al final. |

## Pruebas añadidas
- `tests/scripts/qa-c06.test.js`: 35 casos ([S] 10, [R] 4, [X] 8, [U] 4, [V] 5, [H] 4).
- `supabase/tests/123_qa_c06.test.sql`: 26 casos pgTAP.
- `tests/scripts/qa-v04.test.js`: caso [C] actualizado de 4 a 5 workflows, porque el criterio de C-06 lo vuelve obsoleto. Al caso [E] no le cambié nada: pasa con el runbook nuevo.

## Resultado CI
- CI en 1083d09: verde (build, unit, lint; db pgTAP; integración; e2e). https://github.com/apivasa/practica_agente/actions/runs/44870633717
- Seguridad en 1083d09: rojo solo por gitleaks (historial), a causa de mi commit 632991f (hallazgo QA-C06-1). Las demás tareas, en verde. https://github.com/apivasa/practica_agente/actions/runs/44870633714
- Local en el árbol fusionado: 2282 pruebas, 0 fallos.

## Cobertura engine/
99,9 % de líneas. Todos los archivos están al 100 %, salvo `commitment.js` (99,35 %, línea 37, previa a C-06). `alert-email.js`: 100 % de líneas y 98,15 % de ramas.

## Hallazgos
- **QA-C06-1 (media, del tester, bloquea el check de gitleaks).** Mi commit 632991f subió en `tests/scripts/qa-c06.test.js:309` un JWT ficticio literal: cabecera HS256, payload `{"role":"service_role"}` y firma inventada; no es un secreto real. Ya lo cambié por un JWT armado en ejecución, pero el historial no se reescribe. Corrección: añadir a `.gitleaksignore` (fuera de mi carpeta; le toca a seguridad o al orquestador) la huella
  `632991f37c7f2c403a7518b8bd64d5480456f42a:tests/scripts/qa-c06.test.js:jwt:309`.
  Para reproducirlo: run de Seguridad 44870633714, tarea «gitleaks (historial completo)».
- **QA-C06-2 (baja, observación).** Un destinatario con rol vigente y sin correo válido sigue contando como fallo con intento (`alert_email_failed`) y no como omisión. Es coherente con C-05 y el criterio no lo cubre. Se registra solo para el runbook.
- Sin hallazgos en el código de la app.
