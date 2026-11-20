# ADR 0014 — Salud del sistema (V-04)

Estado: Aceptado (arquitecto-SRE, 2026-11-19; revisable)
Ítem: V-04 (`.github/workflows/salud.yml`, `scripts/health/`, `scripts/ci/health.sh`)

## Contexto
El diseño pide que un workflow programado detecte caídas de la web y de Supabase y que alerte si un cálculo programado no corrió o falló. El stack no tiene servidor propio (ADR 0001), así que la vigilancia vive en GitHub Actions. El repositorio es público, lo que limita qué puede contener una alerta.

## Decisión
1. **Un workflow `salud.yml` cada 6 h** (`41 */6 * * *`, minuto no redondo para esquivar la carga de los cron en punto) y `workflow_dispatch`. No tiene disparador de push ni de PR. En CI se prueba con `scripts/ci/health.sh`, que corre contra Supabase local en el job `integration` e incluye una simulación de caída.
2. **Lógica en Node puro** (`scripts/health/lib.js`, `fetch` nativo, sin dependencias npm), con el reloj, `fetch` y el cliente de GitHub inyectados. No es lógica de negocio, por eso no va en `engine/`. Solo reutiliza `businessDate` del motor para la fecha de Guayaquil.
3. **Reglas como configuración.** `WORKFLOW_RULES` define, por workflow, el evento, la antigüedad máxima o el criterio mensual, el paso obligatorio y la duración máxima. Añadir un workflow vigilado es añadir una fila.
4. **Producción como guarda.** Con `vars.EVALUATION_ENABLED != 'true'`, se omiten la disponibilidad y la exigencia de ejecución de las evaluaciones (ADR 0008). El estado `active` de los workflows, el run semanal de seguridad y CI en `main` se vigilan siempre.
5. **Sin clave secreta.** Supabase se sondea en `/auth/v1/health` con la clave publicable. La comprobación de `audit_log` en la BD queda manual: necesitaría `SUPABASE_SECRET_KEY` en un workflow que no la requiere para nada más. Que el paso "Evaluar" se omita o falle ya se detecta por la API de Actions.
6. **Alerta = issue con la etiqueta `salud`.** Solo el job `alert` tiene `issues: write`. Un único issue abierto acumula comentarios (sin duplicados). El cuerpo lleva solo los nombres de los checks (saneados con `[a-z0-9-]`), la hora y el enlace al run. Los detalles quedan en el log y el resumen del run. Esto no contradice el punto 7 del ADR 0008: las alertas de negocio siguen en la tabla `alerts`, y el issue es solo operativo.
7. **El registro de la acción automática es el propio issue** (autor bot, fecha, enlace). No toca la BD.

## Consecuencias
- `salud.yml` no puede vigilarse a sí mismo si GitHub lo deshabilita por inactividad. Lo cubre el paso 3 del ciclo del orquestador (runbook).
- Si el plan gratuito pausa el proyecto pese al sondeo de Auth, se añadirá una consulta PostgREST liviana con un ADR nuevo.
- Los tiempos base de `salud.yml` se miden tras su primer run programado en `main`.
