# V-05 — Informe de arquitectura y salud
Veredicto: VERDE (intento 2). Hay una corrección documental obligatoria para el documentador antes del PR (hallazgo 1).
Alineado al diseño: sí. El stack es Pages + Supabase + Actions, sin servidor propio. El ítem no trae tablas ni columnas nuevas, la semilla nunca va a producción y se cumple la CSP de ADR 0011. La lógica no se duplica: el origen de producción se lee de `src/security/csp.js` y no se copia.
Requiere decisión del usuario: no. No cambia ninguna decisión confirmada. El primer despliegue y la configuración de environments, secretos y Auth son compuertas ordinarias (CLAUDE.md §3) y van en un único pendiente (hallazgo 4).
ADR creados o actualizados: `docs/adr/0015-despliegue-manual-primero.md`. Es nuevo y Aceptado; se renumeró desde 0014 porque V-04 ya usó ese número para `0014-salud-del-sistema.md`. Se agregó el punto 6: sin revisor en `produccion`, y un environment aparte para `migrate` si se quiere aprobación. `docs/operacion.md`: conflicto con `main` resuelto conservando la restauración de V-04 y la salud, más la sección «Despliegue» con fallos por job (incluidos «Origen de producción», «Registro cerrado en Auth» y `migrate-plan`). `docs/despliegue.md`: referencias a ADR 0015.
Salud: CI y Seguridad en `success` sobre 674a8b1. El único rojo de la rama fue CI en c6db2bf (unitarias): pruebas de QA del intento 1 que no coincidían con el nuevo `deploy.yml`, corregidas en 9ca94c5. Es un defecto real, no intermitencia. `deploy.yml` no se ha ejecutado nunca: no hay base de duración. `salud.yml` ya está en `main` (V-04). Tras el primer despliegue y P-05, vigila Pages, Supabase (y evita la pausa por inactividad) y los crons. Los crons ahora declaran `environment: produccion`, y `salud.yml` detectaría un run en `waiting` como «último run hace N h» (ver hallazgo 1).

## Revisión de los hallazgos del intento 1
1. **Auth abierta en producción: cerrado.**
   - `verify` lee `GET /auth/v1/settings` con la clave publicable y falla si `disable_signup` no es `true`. No imprime la clave, tiene timeout de 20 s y un mensaje claro si el proyecto está pausado.
   - `docs/despliegue.md` lista los ajustes del panel: registro, Site URL y Redirect URLs, contraseña mínima y `pg_graphql`.
   - No se usa `config push`.
2. **Orden de jobs: cerrado.** El orden es `verify` → `build-pages` → `migrate-plan` → `migrate` → `deploy-pages` (needs `[build-pages, migrate]`) → `smoke`. Un build o un `dist/` defectuoso ya no toca la base.
3. **Parada inexistente tras el dry-run: cerrado.**
   - `migrate-plan` es un job propio que solo corre el dry-run. `migrate` repite el dry-run justo antes de aplicar, por si la aprobación llega tarde.
   - La guía distingue correctamente los casos «con revisor» y «sin revisor».
   - El problema que trae la recomendación de revisor está en el hallazgo 1 de esta sección.
4. **Menores: cerrados.** `smoke` exige 200 también en el JS principal. `migrate` deja `supabase migration list` en el log como evidencia del criterio «migraciones aplicadas». La restauración de `docs/despliegue.md` remite a `docs/operacion.md`.
5. **Extras correctos del intento 2:**
   - el paso «Origen de producción» compara `SUPABASE_URL` con `PRODUCTION_SUPABASE_ORIGIN` antes de migrar, así que unos secretos que apunten a otro proyecto no migran una base equivocada;
   - `deploy.yml` ya no lee `SUPABASE_SECRET_KEY` (mínimo privilegio, y la regla de `workflows.test.js` queda intacta en la fase 2);
   - `evaluacion-mensual.yml` y `ritmo-diario.yml` declaran `environment: produccion` (H-C03-02). Como los secretos de repositorio siguen visibles desde un environment, nada se rompe mientras el usuario no los mueva.

## Hallazgos del intento 2
1. **Obligatorio antes del PR (documentador, paso 8): `docs/despliegue.md` recomienda un revisor requerido en `produccion`.** Desde este ítem, los crons también usan ese environment. Con revisor, cada run de `ritmo-diario` y `evaluacion-mensual` quedaría en `waiting`, y los candados y las alertas dejarían de aplicarse solos. Es la misma observación que H-V05-QA-05 (QA) y H-V05-02 (seguridad), que la dejaron como decisión de arquitectura. **Decisión (ADR 0015 punto 6):** `produccion` lleva regla de ramas = `main` y **sin** revisor. Si se quiere aprobación antes de `db push`, va en la fase 2 con un environment aparte (`produccion-migraciones`) declarado solo por `migrate`. Cambios en `docs/despliegue.md`:
   - Requisitos previos, punto 2: cambiar «Recomendado: revisor requerido» por «Sin revisor requerido: lo usan también los crons de evaluación (ADR 0015 punto 6)».
   - «Puntos de parada»: la parada de la fase 1 es el disparo manual con `confirm` más el dry-run en el log de `migrate-plan`. La variante con revisor pasa a la fase 2 con `produccion-migraciones`.
   - «Primer despliegue», paso 3: quitar las aprobaciones por job, o remitirlas a la fase 2.

   No requiere cambiar código. Si el desarrollador prefiere crear ya `produccion-migraciones` en `migrate`, también es válido, pero suma una compuerta más al usuario. No lo recomiendo para la fase 1.
2. **Menor: referencias al ADR viejo fuera de mi carpeta.**
   - `.github/workflows/deploy.yml` (líneas 13 y 103) y `tests/workflows/deploy.test.js` (línea 117) todavía dicen «ADR 0014». Hoy ese número corresponde a «Salud del sistema». Que el desarrollador y el tester cambien `0014` por `0015` en esos comentarios cuando vuelvan a tocar la rama; no bloquea.
   - `docs/reportes/V-05-qa.md` (línea 13) también: lo corrige QA.
3. **Ya no aplica: environment `produccion` inexistente.** Si no existe, GitHub lo crea vacío en el primer run y los secretos de repositorio siguen accesibles, así que el workflow funciona. Es aceptable para la fase 1, porque el disparo es manual y lo hace el usuario y `verify` exige `main`. Pero no protege nada hasta que el usuario configure la regla de ramas y mueva los secretos.
4. **Para el orquestador: un único pendiente al usuario.** Debe agrupar estos pasos:
   - autorizar el primer despliegue;
   - ajustar Auth en el panel (registro cerrado, Site URL, contraseña mínima, `pg_graphql`);
   - crear `produccion` con *Deployment branches* = `main`, **sin revisor**, y copiar ahí los 6 secretos. Borrar los de repositorio solo después de comprobar con una corrida manual de `ritmo-diario` que el paso «Evaluar» se ejecuta;
   - sacar el volcado lógico previo (aunque en el primer despliegue la base está vacía).
5. **Para el orquestador: plan.** Hay que hacer dos cambios en `docs/plan-maestro.md`:
   - agregar el ítem de fase 2, «deploy.yml en push a main», con las condiciones de ADR 0015 punto 5;
   - reordenar S-05 para que dependa del primer run de V-05 (ADR 0015 punto 4). Sin el primero, V-05 quedaría `Hecho` sin «en cada merge a `main`».
6. **Riesgo aceptado:** `despliegue-produccion` y `evaluacion-produccion` son grupos de concurrencia distintos. Un despliegue con migraciones de `evaluations`, `alerts` o `audit_log` no debe coincidir con el cron mensual del día 1. Está documentado en `docs/operacion.md` › Despliegue. Unificar los grupos haría que un despliegue largo retrase el cierre mensual, así que no lo cambio.
