# F-12 — Informe QA

Veredicto: VERDE (código de la app). El merge sigue esperando el punto (e): el workflow Seguridad está en rojo en `9b5960d` por un hallazgo de gitleaks en `docs/reportes/F-12-seguridad.md`, que no es código de la app ni de QA (ver H-QA-F12-04).

Rama revisada: `item/F-12` desde `c8229db` (desarrollador) hasta `9b5960d` (incluye los commits de arquitectura y seguridad). Pruebas QA publicadas en `f669885`.

## Criterio de aceptación

| Punto | Estado | Evidencia |
|---|---|---|
| (a) `check-main-tip.sh` ya no exime `workflow_dispatch`: un dispatch superado por código falla, también con `--strict`; un disparo nuevo en la punta despliega | Cumplido | `qa-f12.test.js` [a]: en la punta da 0, consulta `commits/main` y deja `deploy=true`. Si está superado, da 1 sin `deploy=` en los intentos 2, 5 y vacío, y da 1 con `--strict` en los intentos 1, 2 y vacío. Una matriz de paridad (6 escenarios × 2 intentos × con y sin `--strict`) da para dispatch el mismo código, la misma salida `deploy=` y las mismas llamadas a la API que para push. `verify` exige `refs/heads/main` y `confirm` antes del paso. Ver la nota H-QA-F12-01 sobre el intento 1 sin `--strict`. |
| (b) el `status` de compare impreso solo contiene `[a-z_]` en una línea | Cumplido | 9 valores maliciosos (`\n::error::`, `\r\n::add-mask::`, U+2028, U+2029, NUL, `%0A`, mayúsculas, guion) con y sin `--strict`: la salida tiene una sola línea, un solo comando de workflow y el status coincide con `^[a-z_]+$`. Un status anómalo con solo docs detrás nunca se toma por «solo documentación». |
| (c) H-F11-06 documentado en el mensaje y en el script | Cumplido | Con `--strict` en el intento 1, el `::error::` cita H-F11-06 y dice «no relances este run», tanto en push como en dispatch. No aparece en relanzamientos, ni sin `--strict`, ni con `behind`. Hay comentario en el script y en el job `deploy-pages` de `deploy.yml`. |
| (d) la ruta `expired` marca y audita de forma atómica vía la RPC `public.mark_alerts_email_expired`, con EXECUTE solo para service_role | Cumplido | pgTAP `125_qa_f12`: la gestora (authenticated) recibe 42501. Bordes: `sent_at` igual al corte no se marca, intentos = tope − 1 sí, intentos = tope no, una alerta ya omitida por otro motivo no se sobrescribe y una vencida fuera de `p_ids` no se toca. Cada id marcado tiene una sola fila de auditoría con sus datos. **Atomicidad de un lote de 2**: si falla la auditoría de una alerta, ninguna queda marcada ni auditada. Se validan los rangos de la ventana (0 y 366 se rechazan, 31 se acepta) y los nulos. En JS: si la RPC falla no se marca ni se audita por otra vía, `runEmailStep` termina distinto de 0, la clave no se filtra, la RPC recibe el mismo corte y tope que la consulta, y `createDb` siempre la expone. anon, authenticated (líder), service_role y PUBLIC ya estaban cubiertos en `124_*`. |
| (e) CI, Seguridad y CodeQL en verde sin desactivar pruebas | Parcial | En `9b5960d`: CI verde (unit 3069/0 fallos, pgTAP 48 archivos y 1235 pruebas, integración y e2e), los dos CodeQL verdes, Seguridad rojo solo en **gitleaks** (H-QA-F12-04). No se desactivó ni se saltó ninguna prueba. |

## Pruebas añadidas o actualizadas
- `tests/scripts/qa-f12.test.js` (nuevo): 40 casos ([a] 11, [b] 20, [c] 3, [d] 6).
- `supabase/tests/125_qa_f12.test.sql` (nuevo): 19 aserciones pgTAP.
- Actualizadas al comportamiento nuevo, sin borrar ni saltar ninguna. Los casos `workflow_dispatch` ahora simulan `commits/main` y `compare` y esperan la regla de push:
  - `tests/scripts/f11-fixes.test.js`: el caso de exención (ahora: en la punta da 0 y consulta `commits/main`; superado por código da 1) y el caso `deploy=true` con dispatch.
  - `tests/scripts/qa-f11.test.js`: [P1] exención (ahora con `[COMMITS]` en las llamadas; superado da 1 con `[COMMITS, COMPARE]`), [P1-a] `deploy=true` con dispatch y [P1-b] `--strict` con dispatch en la punta.

## Resultado CI
- CI run 44889499214 (`9b5960d`): success. Build, lint y unit: 3069 pruebas, 0 fallos. db (pgTAP): `124_*` ok, `125_qa_f12` ok, Result: PASS. Integración y e2e: success.
- Seguridad run 44889499173 (`9b5960d`): failure solo en gitleaks. CodeQL (js/ts y actions), semgrep, pentest API, DAST, npm audit y tests/security: success.
- En local, la suite unitaria completa (`node --test`, antes del commit de seguridad `d94e175`) solo fallaba en `tests/security/deploy-f11.test.js:100`, que es de seguridad y ellos lo actualizaron en `d94e175`.

## Cobertura engine/
99,9 % de líneas (todos los archivos están al 100 % salvo `commitment.js`, con 99,35 %, línea 37). F-12 no toca `engine/`. Meta ≥ 95 %: cumplida.

## Hallazgos
- **H-QA-F12-01 (informativo).** Un dispatch superado por código en el **intento 1 sin `--strict`** sale con 0, `::warning::` y `deploy=false`: el run queda verde sin publicar y no «falla» en sentido literal. Es la misma regla que push (H-ARQ-F11-01, carrera prevista) y nunca publica un commit superado. Si se relanza (intento > 1) o se usa `--strict`, falla. Para reproducirlo: `GITHUB_EVENT_NAME=workflow_dispatch GITHUB_RUN_ATTEMPT=1` con `commits/main` ≠ `HEAD_SHA` y compare `ahead` con `src/…`. Sin acción salvo que el usuario quiera rojo literal también en el intento 1.
- **H-QA-F12-02 (informativo).** El status se sanea **antes** de compararse en el shell. Un status como `"ahead\n"` no es `ahead` para jq, así que no cuenta como «solo docs». En el shell queda como `ahead` y en el intento 1 se trata como carrera prevista (`deploy=false`, o «Rojo esperado» con `--strict`). Falla cerrado y nunca publica. El único efecto es un mensaje algo engañoso ante una respuesta anómala de la API.
- **H-QA-F12-03 (baja).** `scripts/lib/email.js` conserva la ruta no atómica (`markAlertsEmailSkipped` + `insertAudit`) cuando la BD no implementa `markAlertsEmailExpired`, y `REQUIRED_C06_DB_METHODS` no lo exige. `createDb` siempre lo implementa (probado), así que en producción se usa la RPC. Pero una capa de BD nueva sin ese método volvería en silencio al comportamiento no atómico. Sugerencia: exigirlo en `runEmailStep` (fail-closed, como en H-C06-01). Para reproducirlo: `sendAlertEmails` con una BD simulada sin `markAlertsEmailExpired` no avisa.
- **H-QA-F12-04 (media, bloquea (e), no es código de la app).** gitleaks (historial completo) falla en `9b5960d`: `docs/reportes/F-12-seguridad.md:41`, regla `generic-api-key`, huella `9b5960d73d35ba884b7e419cabc00a22e74f0675:docs/reportes/F-12-seguridad.md:generic-api-key:41`. El informe de seguridad cita en esa línea el literal de la clave ficticia de una prueba. Lo corrige seguridad en su informe: no poner el literal, o añadir la huella a `.gitleaksignore` si es ficticio. QA no toca ese archivo.
