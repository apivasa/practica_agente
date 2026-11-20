# V-06 — Informe de arquitectura y salud

Veredicto: VERDE
Alineado al diseño: sí (la documentación describe con exactitud lo construido; las brechas diseño↔código que reporta el documentador son de implementación, no de documentación, y se clasifican abajo)
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (las decisiones técnicas de los ítems propuestos se registran como ADR cuando se construyan)
Salud: CI y Seguridad en verde en `item/V-06` y en los últimos runs cerrados de `main` (hay un run en curso en `main` al revisar). `evaluacion-mensual` y `ritmo-diario` aún no tienen corridas programadas (el primer cron diario es 2026-11-20 11:23 UTC) y en producción no actúan hasta `EVALUATION_ENABLED` (V-05). `salud.yml` no existe todavía (V-04 pendiente). Este ítem solo cambia documentación: no afecta CI ni a los workflows.

## Verificación de exactitud (contra `main`)

Revisé `README.md`, `docs/indicadores.md`, `docs/modelo-datos.md` y los cuatro manuales contra el código:

| Afirmación | Fuente verificada | Resultado |
|---|---|---|
| Matriz RLS por rol (10 tablas × 4 roles), sin DELETE en mediciones, compromisos y excepciones, `alerts.read_at` como única escritura | `20261119120100_rls_policies.sql`, `20261119120300_hardening.sql`, `20261122120100_exceptions_business_date.sql` | Exacta |
| Meta acumulada: sin meta → "sin evaluar"; meta 0 → 100 %; "detectada" no suma; ventana ampliada a 92 días | `engine/measure.js` (`cumulativeTarget`), `scripts/lib/build.js`, `engine/rows.js` (`isResolved`) | Exacta |
| Umbral de cumplimiento por criticidad = `thresholds_by_category.*.green`, con 96/85 por defecto | `engine/rows.js` (`buildPackageInput`), `engine/vulnerabilities.js` (`DEFAULT_COMPLIANCE_THRESHOLDS`) | Exacta |
| Color mensual de VULN agrega todo lo resuelto contra una sola meta de `targets` | `scripts/lib/build.js` (`evaluateIndicatorMonth`) | Exacta |
| Rutas y menús por rol | `src/lib/route-logic.js` | Exacta |
| Etiquetas de alcance distintas ("Permite iniciar change" / "Inicio puntual de change") | `src/lib/dashboard.js:30`, `src/lib/exceptions-logic.js:8` | Exacta |
| Límites: 30 alertas (comité), 50 (líder), vista previa CSV de 50 | `src/views/committee/home.js:39`, `src/data/alerts.js:8`, `src/views/custodian/measurements.js:15` | Exacta |
| Textos de pantalla citados (sin rol, credenciales, "No custodias...", "Sin leer", "Solo quien la aprobó...") | `src/views/**`, `src/lib/session.js` | Exactos |
| Horarios 06:07 y 06:23 Guayaquil | `cron` de `evaluacion-mensual.yml` y `ritmo-diario.yml` | Exactos |
| Custodios de la semilla (custodio1 → VULN; custodio2 → AVAIL, MTTR, OBS) y umbrales VULN 96/90, P0P1 96/90, P2P3 85/75 | `supabase/seed.sql` | Exactos |
| Enlace a `docs/operacion.md#reprocesar-un-mes` | `docs/operacion.md:133` | Existe |

Los documentos no presentan como construido nada que no lo esté: dicen de forma explícita qué falta (pantalla de `targets`, canal externo, V-04, V-05, V-07, edición de excepciones). Coherentes con ADR 0003, 0005, 0006, 0008, 0012 y 0013.

## Clasificación de las 7 incoherencias diseño↔código

Clave: (a) desviación de una decisión confirmada, requiere al usuario (regla de parada 2); (b) brecha que se resuelve con un ítem nuevo dentro del diseño; (c) aceptable, basta con documentarla.

### 1. Color mensual de vulnerabilidades sin separar P0/P1 (96 %) y P2/P3 (85 %): (b), prioridad alta

- El diseño fija el cumplimiento por criticidad y el color mensual "contra metas parciales". El modelo genérico ya admite "umbrales opcionalmente por categoría" (`thresholds_by_category`). El motor ya separa criticidades en `packageStatus` y `paceStatus` y calcula las metas acumuladas de 1/3, 2/3 y 3/3 por criticidad (ADR 0006, punto 2).
- La evaluación mensual (`scripts/lib/build.js`) no usa nada de eso: suma P0/P1 y P2/P3 y compara contra una sola meta y el umbral general (96/90 en la semilla). Consecuencias: un P2/P3 al 85 % (lo que pide el diseño) baja el agregado hacia amarillo, y un P0/P1 bajo puede quedar oculto por un P2/P3 alto. Esto afecta directamente al candado, así que conviene corregirlo antes de activar la evaluación en producción (`EVALUATION_ENABLED`, después de V-05).
- No contradice ninguna decisión confirmada. Es un incumplimiento de implementación que se corrige con el stack y las tablas actuales, sin columnas nuevas. La regla para combinar categorías (color de cada categoría con sus umbrales; el indicador toma el peor) sigue el mismo criterio que el color de la unidad ("el peor de sus indicadores"). Se registra como ADR `Aceptado` revisable, igual que se hizo con Q-06.
- **Ítem propuesto M-06** (P0, talla M, depende de M-05 y C-03): "Color mensual por criticidad en indicadores de meta acumulada con categorías".
  - Descripción: función pura nueva en `engine/` que, para un indicador `cumulative_target` con `thresholds_by_category`, calcula por categoría `resuelto acumulado del trimestre × 100 / meta acumulada del mes de esa categoría` sobre el paquete efectivo (`packageStatus`, que incluye P0/P1 de los meses 1 y 2). Colorea cada categoría con su verde y amarillo y da al indicador el peor color. El motivo menciona las dos categorías. La usan `scripts/lib/build.js` (evaluación mensual) y `src/lib/dashboard.js` (vista del líder), sin duplicar código. Los indicadores sin categorías mantienen la ruta actual con `targets`.
  - Criterio de aceptación: pruebas `node:test` con tabla de verdad (P0/P1 en 96 % y P2/P3 en 85 % → verde; P0/P1 en 95 % y P2/P3 en 100 % → no verde; meta 0; categoría sin paquete → sin evaluar con motivo); la integración de CI con la semilla 2027-Q1 da VULN evaluado por criticidad, sin depender de `targets`; ADR nuevo; `docs/indicadores.md` §6 actualizado por el documentador.

### 2. Metas mensuales (`targets`) sin pantalla: (b)

- La tabla existe y la RLS (escritura solo de la gestora) está probada, pero ninguna pantalla la llena. Con M-06, VULN deja de depender de `targets`. Siguen dependiendo de la tabla los indicadores de meta acumulada sin categorías, y la columna "Meta del mes" del líder.
- **Ítem propuesto M-07** (P1, talla S, depende de M-02 y, si se hace después, de M-06): "Pantalla de metas mensuales para la gestora (`#/gestora/metas`)".
  - Descripción: listar, crear y editar `targets` por unidad, indicador y mes, solo para indicadores `cumulative_target`. Botón "Proponer un tercio" que precarga 1/3, 2/3 y 3/3 del paquete del compromiso trimestral con la función del motor (sin repetir la regla en `src/`). Validación de `target_value ≥ 0` y del mes `AAAA-MM`. Los cambios quedan auditados por el trigger existente.
  - Criterio de aceptación: e2e con rol gestora (crea, edita y precarga); e2e o API que muestre que custodio, comité y líder no pueden escribir; la evaluación mensual de un indicador sin categorías pasa de "Sin evaluar" a un color tras cargar la meta; manual de la gestora actualizado.

### 3. "El comité decide escaladas": (c)

- El diseño define los candados como reglas deterministas por color e historial ("Reglas de escalada"), y su principio es controlar por resultados. La app aplica esas reglas de forma automática y auditada, y el comité decide sobre ellas con las excepciones (suspender todo o autorizar un inicio). Leído así, el comité "decide" al aprobar excepciones y al intervenir con la información de la matriz y las alertas. No hace falta un candado manual, y agregarlo sí crearía una regla nueva.
- Acción: se queda documentado como está (`manual-comite.md`, "Qué no puedes hacer"). Si el orquestador quiere confirmarlo, puede añadirlo como punto (e) de Q-05, que no bloquea nada y ya tiene un valor por defecto. No requiere notificación.

### 4. Inicio puntual con unidad congelada (`authorizedStarts`) no persistido ni visible, y candado que no refleja excepciones nuevas hasta el siguiente cierre: (b), prioridad baja

- ADR 0012 decide qué devuelve el motor, pero no cómo mostrarlo. La excepción sí se ve en la lista de vigentes, así que se cumple "comunicar". El diseño pide "aplicar y comunicar las restricciones". Que una excepción aprobada hoy (por ejemplo, "arrancar algo urgente") no cambie el candado visible hasta el cierre mensual o un reproceso es una brecha de comunicación, no de reglas.
- **Ítem propuesto V-08** (P2, talla S, depende de V-01, V-02 y C-02): "Candado vigente hoy en los tableros".
  - Descripción: el front calcula el candado del día con `evaluateEscalation` de `engine/`, a partir del historial guardado en `evaluations` y de las excepciones vigentes hoy (America/Guayaquil). Muestra "Inicio autorizado: <ref>" cuando hay `authorizedStarts`. Sin columnas nuevas. El candado guardado sigue siendo el oficial del cierre, y la pantalla distingue "cierre de <mes>" de "hoy".
  - Criterio de aceptación: pruebas unitarias de la lógica compartida; e2e en el que el comité aprueba `all` y el líder ve "En excepción" el mismo día sin reprocesar; `change_start` sobre una unidad congelada muestra "Congelada" más "Inicio autorizado: REF".

### 5. Alertas sin notificación externa: (c), ya cubierta por el plan

- ADR 0008, punto 7, fija como canal la tabla `alerts` dentro de la app, y C-05 (correo) espera Q-04. No hace falta un ítem nuevo ni aplica la regla de parada 2: Q-04 ya está registrada y no bloquea todo lo pendiente.
- Hallazgo menor para el orquestador (dueño de `docs/pendientes-usuario.md`): el valor por defecto de Q-04 dice "bandeja dentro de la app + issue de GitHub", pero ADR 0008, punto 7, descarta los issues por alerta porque el repositorio es público. Conviene corregir ese texto para que el usuario no responda sobre una premisa falsa.

### 6. Etiquetas de alcance distintas entre `exceptions-logic.js` y `dashboard.js`: (b), trivial

- Es un tema de interfaz, no de diseño: un mismo dato tiene dos nombres. La regla de "una sola fuente" también aplica a los textos de dominio.
- **Ítem propuesto V-09** (P2, talla XS, sin dependencias abiertas): "Etiqueta única de alcance de excepción".
  - Descripción: un solo mapa de etiquetas (por ejemplo, el de `src/lib/exceptions-logic.js`) que importa `src/lib/dashboard.js`.
  - Criterio de aceptación: una prueba unitaria verifica que ambas vistas usan la misma etiqueta; los manuales del comité y del líder quitan la nota de equivalencia. Se puede agrupar con V-08.

### 7. Edición de excepciones sin pantalla: (c)

- El diseño no exige editar excepciones: pide motivo, vencimiento y visibilidad. La BD permite editar dentro del tope (ADR 0012), y la pantalla ofrece revocar y crear una nueva, lo que deja mejor rastro de auditoría. Queda documentado en `manual-comite.md`. Si más adelante se pide, sería un ítem P3.

## Hallazgos adicionales

- **H-V06-A1 (c), recomendación de ítem futuro.** `frequency` (`weekly`, `quarterly`) y `source` solo se guardan: la evaluación es mensual para todos, y `docs/indicadores.md` §1 lo dice. El diseño lo pone como atributo del modelo genérico ("ej. mensual"). No es urgente mientras todos los indicadores sean mensuales. Si se configura uno semanal o trimestral, conviene un ítem para que la evaluación respete `frequency`, o validar en la pantalla de indicadores que solo se acepte `monthly` hasta entonces.
- **H-V06-A2.** Orden sugerido para el plan: M-06 antes de activar `EVALUATION_ENABLED` en producción (no bloquea la publicación del front en V-05), luego M-07, y después V-08 y V-09 agrupados.
- Ninguna de las 7 incoherencias es de tipo (a). No se crea ningún ADR `Propuesto` y no aplica la regla de parada 2.
