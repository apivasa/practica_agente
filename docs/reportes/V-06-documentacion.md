# V-06 — Documentación (manuales por rol y guía de indicadores)

Veredicto: VERDE (documentación al día con `main` tras PR #21)
Autor: documentador. Revisión pendiente: arquitecto-SRE (criterio de aceptación).

## Qué cubre

Base: rama `origin/docs/lote-2` (commit e566638), reutilizada y verificada contra el código de `main`. Se corrigieron los puntos que no coincidían con el código.

| Archivo | Contenido |
|---|---|
| `README.md` | Qué existe en `main` (PR #12 a #21), qué falta (V-04, V-05, S-05, C-05, V-07, pantalla de `targets`), cómo correr en local con la semilla, usuarios ficticios, comandos, pruebas, workflows y estructura del repo. |
| `CHANGELOG.md` | Una línea por ítem desde F-01 hasta V-06, la más reciente arriba. |
| `docs/modelo-datos.md` | Tablas, columnas, restricciones y matriz RLS por rol, tomadas de `supabase/migrations/`. |
| `docs/indicadores.md` | Los 7 atributos, ejemplos (AVAIL, MTTR, OBS, VULN), compromisos con umbral negociado, captura manual y CSV, color, caso vulnerabilidades, candados y excepciones. |
| `docs/manual-gestora.md` | Login, Indicadores (alta, edición, activar, custodio) y Completitud. |
| `docs/manual-custodio.md` | Compromisos y Mediciones (manual y CSV). |
| `docs/manual-comite.md` | Matriz unidad × indicador, alertas, excepciones (aprobar y revocar). |
| `docs/manual-lider.md` | Pantalla única: resumen, indicadores, meta, ritmo, excepciones y alertas. |

## Verificado contra el código

- Rutas y menús: `src/lib/route-logic.js`.
- Textos de pantalla y columnas: `src/views/**`, `src/views/dashboard-parts.js`, `src/lib/dashboard.js`, `src/lib/exceptions-logic.js`.
- Límites: 30 alertas (comité), 50 (líder), 20 últimas mediciones, vista previa CSV de 50, CSV 1 MB y 5000 filas (`engine/measurements-input.js`).
- RLS: `20261119120100_rls_policies.sql`, `20261119120300_hardening.sql`, migraciones de excepciones.
- Horarios: `cron` de `evaluacion-mensual.yml` (11:07 UTC = 06:07 Guayaquil) y `ritmo-diario.yml` (11:23 UTC = 06:23).
- Semilla: `supabase/seed.sql` (correos `@example.test`, todos ficticios).

## Ajustes respecto a `docs/lote-2`

- Inicio de gestora y custodio: muestran un texto fijo con lo que hace el rol, no solo el nombre.
- Pantalla "Sin acceso" para cuentas sin rol.
- Etiquetas de alcance distintas entre la pantalla Excepciones y los tableros: documentadas como equivalentes.
- `change_start` con la unidad congelada: el motor calcula `authorizedStarts`, pero no se guarda ni se muestra. Los manuales ya no dicen que la app lo muestre.
- README: S-05 como requisito previo de V-05; `engine/dates.js` en la estructura.

## Incoherencias para el orquestador (no resueltas)

1. **Color mensual de vulnerabilidades sin separar criticidad.** `docs/diseno.md` fija el cumplimiento en 96 % P0/P1 y 85 % P2/P3. La evaluación mensual (`scripts/lib/build.js`) suma todo lo resuelto y lo compara con una sola meta de `targets` y el umbral general. El cumplimiento por criticidad solo se usa en el ritmo diario y en la vista del líder.
2. **Metas mensuales (`targets`) sin pantalla.** El diseño las lista como tabla del modelo. Solo la gestora puede escribirlas por RLS, pero ninguna pantalla lo permite. Sin meta del mes, VULN queda "Sin evaluar". El motor sí calcula las metas de un tercio para el ritmo, pero la evaluación mensual no las usa.
3. **"El comité decide escaladas"** (diseño, Roles). En la app el candado lo calcula la evaluación. El comité solo puede aprobar o revocar excepciones.
4. **Inicio puntual con la unidad congelada.** `authorizedStarts` (ADR 0003) no se persiste en `evaluations` ni se ve en pantalla.
5. **Alertas.** El diseño dice "envían notificaciones". Hoy solo existen dentro de la app (C-05 espera Q-04).
6. **Etiquetas de alcance de excepciones** distintas entre `src/lib/exceptions-logic.js` y `src/lib/dashboard.js` (incoherencia de interfaz, no de diseño).
7. **Edición de excepciones.** La BD permite editar una excepción propia (acortar o alargar el vencimiento dentro del tope), pero no hay pantalla para hacerlo.
