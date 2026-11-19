# C-03 + C-04 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: dos workflows programados con la clave secreta (`evaluacion-mensual.yml`, `ritmo-diario.yml`; `schedule` + `workflow_dispatch` con input `as_of`); `scripts/evaluate.js` y `scripts/lib/` (escriben `evaluations`, `alerts` y `audit_log` con la clave secreta, que salta RLS); columna `alerts.dedupe_key` (unique) y CHECK `alerts_kind_allowed`; job `integration` en `ci.yml` contra Supabase local; semilla ampliada (excepciones y compromisos ficticios).

## Revisión (categorías 5 y 8)
- **Workflows.** Tienen `permissions: contents: read` a nivel de workflow y ningún permiso por job. Las acciones están fijadas por SHA, el checkout usa `persist-credentials: false` y se instala con `npm ci --ignore-scripts --omit=dev`. Los únicos disparadores son `schedule` y `workflow_dispatch`, que exige escritura en el repo: ningún PR ejecuta código con la clave. Los secretos llegan solo como `secrets.*` → `env:` y ningún `echo` imprime una variable con secreto. `inputs.as_of` pasa por `env: AS_OF` y se usa entrecomillado (`--as-of="${AS_OF}"`), sin interpolarse en `run:`. Hay una guarda doble (secretos presentes y `vars.EVALUATION_ENABLED == 'true'`) y todos los pasos posteriores llevan `if: steps.check.outputs.ready == 'true'`. Ambos comparten un grupo `concurrency` sin cancelación.
- **`evaluate.js` / `config.js` / `db.js`.** Los errores muestran solo `message`, nunca la clave ni las cabeceras. Se rechazan las claves legadas (JWT), las publicables y las URL `http` que no sean locales (`localhost.attacker.invalid` tampoco pasa). `--as-of` acepta solo una fecha real `YYYY-MM-DD` y no admite argumentos desconocidos: las pruebas de inyección de shell o de argumentos se rechazan.
- **Datos manipulados.** No cuentan como resueltas las mediciones futuras, las de otro trimestre ni las `detected`. Los valores no finitos se anulan. Un dato cargado después del cierre no reescribe el mes cerrado ni su candado. Los snapshots del ritmo solo se leen si `actor = 'system:evaluate'`, y `authenticated` no puede escribir `audit_log` ni `alerts`, así que no puede reservar una `dedupe_key` para silenciar una alerta. Leer una alerta (`read_at`) no impide las siguientes.
- **Auditoría.** Todas las evaluaciones escritas (`evaluation_upsert` y `escalation_applied`), las alertas insertadas (`alert_sent`) y las excepciones vencidas (`exception_expired`, una sola vez) quedan auditadas con `actor = 'system:evaluate'`. La auditoría no contiene la clave ni la URL.
- **Migración de dedupe.** Es aditiva y no tiene `grant`, `policy`, `security definer` ni `drop`. `dedupe_key` no se puede insertar ni actualizar desde `authenticated`. La 041 sigue en verde (CI run 44606812249, job `db`) y se añade la 043.
- **Semilla.** Sigue siendo ficticia: correos `@example.test`, UUID sintéticos, motivos marcados como "ficticio" y ninguna clave.

## Pruebas de seguridad añadidas
| Archivo | Casos | Categoría |
|---|---|---|
| `tests/security/automation-c03.test.js` | 51: estáticas por workflow (8 × 2), `integration.sh` (1), `parseArgs` con 11 cargas de inyección + argumentos (13), `readConfig` sin fuga (6), CLI `evaluate.js` sin fuga en 3 rutas de error (3), `db.js` (3), auditoría (3), datos manipulados (4), migración (1), semilla (1) | 3, 5, 8 |
| `tests/security/workflows.test.js` | +2 reglas para todos los workflows: inputs solo por `env:`; `SUPABASE_SECRET_KEY` solo con `schedule`/`workflow_dispatch` y guarda de activación (10 casos nuevos) | 5 |
| `supabase/tests/security/043_security_alerts_dedupe.test.sql` | 10: privilegios de `dedupe_key`, sin INSERT en alerts, anon, RLS, unique, CHECK de `kind`, `measurements.created_at` forzado (H-C03-04) | 1, 8 |
| `tests/security/api/{matrix.js,rls-matrix.test.js,idor-escalation.test.js}` | Fixtures adaptadas al CHECK nuevo: `kind` válido + `dedupe_key`, para que la negación venga de los privilegios y no del CHECK. Se suman intentos de reservar una `dedupe_key` (POST) y de cambiarla (PATCH) | 1 |

`node --test 'tests/security/*.test.js'`: 337/337 sin omitidos (local).

## Intento 2 (tras 108e179)
- `--reprocess`: el input `reprocess` pasa ahora por `env: REPROCESS` y se usa solo en `[ "${REPROCESS}" = "true" ]` (antes se leía `$GITHUB_EVENT_PATH` con `jq`). La regla de `automation-c03.test.js` admite `AS_OF` y `REPROCESS` y prohíbe `GITHUB_EVENT_PATH` y `EVALUATE_ALLOW_FUTURE:` en los workflows programados. El cambio en `evaluacion-mensual.yml` lo hizo seguridad con permiso puntual del orquestador.
- Pruebas CLI nuevas: fecha futura → sale 2 sin conectar; `EVALUATE_ALLOW_FUTURE=1` con host remoto → sale 2; con URL local inalcanzable → llega a conectar y falla sin la clave. El caso "backend inalcanzable" usa una fecha pasada.
- 043: `has_column` como aserción pgTAP directa (antes iba envuelta en `ok()` y rompía el job `db`).
- `node --test 'tests/security/*.test.js'`: 346/346, sin omitidas.

## Resultados del pipeline (intento 1, HEAD e580c45)
- Seguridad: https://github.com/apivasa/practica_agente/actions/runs/44606812102. Pasaron gitleaks, semgrep, npm audit, CodeQL (JS y Actions) y `tests/security`. **Falló `pentest-api`**, pero no por una vulnerabilidad: el `before` insertaba alertas con `kind: 'idor-fixture'` y el nuevo `alerts_kind_allowed` las rechaza con `23514`. La migración tiene razón y las fixtures estaban mal; quedan corregidas en este cambio (sin commit, por indicación). Hay que verificarlo en el próximo run.
- CI: https://github.com/apivasa/practica_agente/actions/runs/44606812249 (verde, incluidos pgTAP y `integration`).
- ZAP: no aplica (el ítem no cambia el front).

## Hallazgos (detalle en `docs/seguridad/hallazgos.md`)
- **H-C03-01 · Media · 5 · CORREGIDO (108e179)** · `scripts/lib/dates.js:79-89`. `--as-of` no tiene límite de rango. Reproducción con la BD falsa y la semilla: `runDaily({asOf:'2027-02-12'})` el 09-02 da 4 alertas `exception_expired` anticipadas y su auditoría con fecha futura; luego `runDaily({asOf:'2027-02-11'})` (el día real) da 0 alertas y 0 auditorías, porque la `dedupe_key` ya estaba consumida y la alerta real queda silenciada. En modo mensual, una fecha futura cierra el mes en curso con datos parciales y una pasada vuelve a cerrar meses viejos. Requiere permiso de escritura en el repo. Corrección: rechazar `as_of` > hoy (America/Guayaquil) y los re-cierres sin una bandera explícita que quede auditada.
- **H-C03-02 · Media · 5** · La clave está en los secretos del repositorio y no en un environment restringido a `main`: cualquier workflow de una rama del mismo repo podría leerla. Corrección: environment `produccion` con regla de ramas = `main` y `environment: produccion` en los jobs. Crear los secretos es compuerta del usuario (V-05).
- **H-C03-03 · Baja · 1/8** · `commitments_*`. El custodio puede relajar `green_override` o `package_by_category` de cualquier unidad, también en periodos cerrados, y quitar un candado si se re-evalúa. Queda auditado y el diseño le da esa potestad. Corrección: congelar los compromisos de periodos ya evaluados.
- **H-C03-04 · Baja · 8 · CORREGIDO (108e179, trigger `measurements_force_created_at`)** · El INSERT en `measurements` se concede sobre toda la tabla, así que el custodio fija `created_at`, que se usa como desempate. Corrección: grant por columnas o trigger con `now()`.

## Verificado sin hallazgos
5 (permisos, SHA, disparadores, inputs por `env`, secretos fuera de los logs, guarda `EVALUATION_ENABLED`), 8 (auditoría de cada efecto, auditoría no editable, semilla ficticia), 2 (solo claves `sb_secret_`, sin legadas), 1 (`dedupe_key`/`alerts` sin privilegios nuevos).
