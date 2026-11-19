# ADR 0008 — Evaluación programada y alertas (C-03, C-04)

Estado: Aceptado (arquitecto-SRE, 2026-11-19; revisable)
Ítems: C-03 (`evaluacion-mensual.yml`, `ritmo-diario.yml`, `scripts/evaluate.js`), C-04 (`scripts/lib/alerts.js`, migración `20261120120000_alerts_dedupe.sql`)

## Contexto
El diseño fija que GitHub Actions programados evalúan colores y escaladas y envían las alertas (ADR 0001). No dice cómo se activa en producción, dónde se guarda el estado diario del ritmo, qué mes cierra la corrida mensual ni por qué canal se notifica. Ninguna de estas decisiones cambia una regla confirmada.

## Decisión
1. **Guarda de producción.** Los dos workflows corren solo si existen los secretos `SUPABASE_URL` y `SUPABASE_SECRET_KEY` y la variable de repositorio `vars.EVALUATION_ENABLED` vale `'true'`. Si no, terminan en verde con un `::warning::` y no hacen nada. La variable se activa tras el primer despliegue (V-05, compuerta del usuario). Así un cron no escribe en una BD a medio publicar.
2. **Snapshot del ritmo en `audit_log`.** El estado diario del paquete (`packageStatus`) se guarda como `audit_log` con `action='pace_snapshot'`, `entity='pace'` y `entity_id='<unit_id>:<indicator_id>'`. No se crea una tabla nueva: el modelo sigue siendo las 9 tablas del diseño más `audit_log` (ADR 0005). Se escribe un snapshot por día y por par unidad-indicador solo si cambia (comparación de JSON canónico, porque jsonb reordena claves). El índice `audit_log_action_entity_idx` sostiene la lectura. Si el volumen crece (más de unos 100 000 snapshots), se pasa a una tabla propia con un ADR nuevo.
3. **La mensual cierra el mes anterior.** Con `as_of` (por defecto hoy en America/Guayaquil), evalúa el mes calendario anterior a `as_of` (`monthToClose`). El cron del día 1 a las 06:07 de Guayaquil cierra el mes que terminó. Para reprocesar un mes M se usa `workflow_dispatch` con `as_of` = primer día de M+1.
4. **Reglas de disparo** (los 4 disparadores del diseño, tipos cerrados por `alerts_kind_allowed`):
   - `color_change`: cambia el color global de la unidad, o cambia el nivel de candado con el mismo color (por ejemplo, rojo en mes 2 que congela). Un verde sin evaluación previa no alerta.
   - `pace_behind`: la unidad pasa de "al día" a "atrasada" según `paceStatus().behindAny`, o está atrasada en su primer snapshot del trimestre. No se repite cada día.
   - `critical_intake`: `recalculateOnNewCritical` indica que la meta cambió con delta mayor que 0. La clave incluye el nuevo total, así que el mismo recálculo nunca alerta dos veces.
   - `exception_expired`: avisa el día del vencimiento (`expires_today`) y cuando ya venció (`expired`), con una ventana de 7 días hacia atrás.
   - Destinatarios: los líderes de la unidad y todo el comité (diseño § Alertas), con una fila por destinatario.
5. **Idempotencia.** `alerts.dedupe_key` es única (`<kind>:<disparador>:<destinatario>`) y la inserción ignora duplicados. `evaluations` solo se reescribe si la fila cambia (upsert por `unit_id,indicator_id,month`). Correr dos veces la misma fecha no duplica evaluaciones, alertas ni auditoría (lo verifica `scripts/ci/integration.sh`). Un reproceso que cambia el color o el nivel sí genera una alerta nueva, y es correcto que lo haga.
6. **Auditoría (CLAUDE.md §4).** Actor `system:evaluate`. Se registran `evaluation_upsert` (indicador), `escalation_applied` (candado de la unidad), `alert_sent` (cada alerta nueva), `exception_expired` (vencimiento) y `pace_snapshot`. Solo se audita lo que realmente se escribió.
7. **Canal de notificación: tabla `alerts` en la app.** No se abren issues de GitHub por alerta: el repositorio es público y el payload contiene nombres de unidades y estado de candados. Las alertas se leen en el front (RLS de `alerts`: cada destinatario ve las suyas). Un canal externo (correo o push) sería un ítem nuevo, con sus secretos como compuerta del usuario.
8. **Compromiso trimestral sin `package_by_category`.** El ritmo diario lo omite y lo deja en el log (`Sin paquete por criticidad ...`), sin marcar error. Es un dato de configuración incompleto del custodio, no un fallo del sistema.
9. **Q-03 (ADR 0003, punto 4).** `YELLOW_MONTH2_ESCALATES_LIKE_RED = false` está en `scripts/lib/build.js` como único punto de configuración que se pasa al motor. Cuando el usuario responda Q-03, se cambia solo ahí.

## Consecuencias
- Toda la lógica (color, escalada, ritmo, recálculo) sigue en `engine/`. `scripts/lib/` solo traduce filas a contratos del motor, decide alertas a partir de las salidas del motor y persiste.
- Las Actions siguen siendo el único backend privilegiado (ADR 0001). `authenticated` no puede hacer INSERT en `alerts`, `evaluations` ni `audit_log`.
- Los dos workflows comparten `concurrency: evaluacion-produccion` sin cancelar la corrida en curso. GitHub guarda como máximo una corrida pendiente por grupo: si llega una tercera, la pendiente se cancela. El runbook lo cubre: se relanza a mano.
