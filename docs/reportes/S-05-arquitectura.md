# S-05 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí. S-05 no añade código de la app, ni tablas, ni lógica fuera de `engine/`. Solo agrega pruebas, documentación y dos jobs en `seguridad.yml`, que es del rol seguridad. El stack no cambia: Pages, Supabase y Actions, sin servidor propio. Los secretos siguen la política de CLAUDE.md §4: la fase A usa claves locales efímeras y la fase B no usa la clave secreta.
Requiere decisión del usuario: no. H-S05-01, H-C03-02 y H-S05-03 son **compuertas de configuración** de la usuaria (panel de Supabase, environment y secretos de GitHub), no cambios de una decisión confirmada. Ver el punto 4.
ADR creados o actualizados: ninguno en esta rama. Hay un choque de numeración entre ramas abiertas, ver el punto 5: hay que renumerar `0014-despliegue-manual-primero.md` (V-05) a `0015`.
Salud: el run de Seguridad 44661334199 (commit `37a440d`) quedó en verde con 9 jobs y `s05-fase-b` omitido como corresponde. CI 44661334125 también en verde. `main` está en verde: los últimos runs de CI y Seguridad terminaron en `success`, y los de 02:39Z siguen en curso. `salud.yml` todavía no está en `main` (V-04, PR #22 abierto). El job semanal de Seguridad, ahora con `s05-fase-a`, debe quedar bajo su vigilancia, según ADR 0007, consecuencias.

## Hallazgos

### 1. Coste y tiempo de `s05-fase-a` en CI (bajo, no bloquea)
- Duración medida en el run 44661334199:
  - `s05-fase-a`: 5 min 28 s.
  - El job más largo hasta ahora era DAST, con 2 min 50 s.
  - El resto de jobs tarda entre 6 y 90 s.
- Los jobs corren en paralelo, así que **el camino crítico de Seguridad pasa de unos 3 min a unos 5,5 min**. CI (`ci.yml`) no cambia.
- Coste en minutos: el repo es público, así que los minutos de Actions en `ubuntu-latest` no se cobran. El coste real es tiempo de espera del merge: el orquestador espera a Seguridad antes de fusionar.
- Hoy corre en cada `pull_request`, en cada push a `item/**`, `fix/**`, `ensayo/**` y `main`, cada semana y en el `workflow_dispatch` con `fase_b = no`. Con PR abierto, cada push lo ejecuta dos veces: una por `push` y otra por `pull_request`. Son unos 11 min de runner por push y unas 44 000 peticiones de ZAP contra el gateway local.
- El tope es `timeout-minutes: 60`, con `maxScanDurationInMins` de 15 + 20. Si ZAP se alarga, el pipeline puede llegar a unos 40 min antes de fallar.
- **Propuesta (ítem de seguimiento, no bloquea S-05):**
  - Que `s05-fase-a` corra solo en `pull_request` hacia `main`, `schedule` y `workflow_dispatch`, no en `push` a ramas de trabajo.
  - Dentro de `pull_request`, que corra solo si el PR toca `src/`, `supabase/`, `index.html`, `vite.config.*`, `package*.json` o `.zap/`. Se puede detectar con un paso `git diff --name-only origin/main...HEAD` al inicio del job, que lo termine en verde con aviso si no aplica. Así no hace falta una acción de terceros ni un `paths:` a nivel de workflow, que afectaría a los demás jobs.
  - Bajar `timeout-minutes` a 30.
  - Si el workflow se hace obligatorio con *required checks*, un job que se omite queda en `skipped`, que cuenta como aprobado: no rompe la protección de ramas.
- Intermitencia: no hay datos suficientes con un solo run en verde. Antes hubo varios intentos rojos, por filtros de PostgREST y por la sesión, pero fueron de construcción, no intermitentes. Si `[ "$total" -ge 1000 ]` o el conteo de Kong por `docker logs` empiezan a fallar de forma aleatoria, se propone como ítem.

### 2. La fase B no es destructiva y no toca hosts ajenos (cumple, con una corrección menor)
- Lista blanca en código: `guardedFetch` solo admite `apivasa.github.io/practica_agente/*` y `<ref>.supabase.co`. Tiene un tope de 900 peticiones y 120 ms entre ellas. `preprod-s05.test.js` vigila la lista en cada PR.
- No usa `SUPABASE_SECRET_KEY`: la URL y la clave publicable se sacan del bundle publicado. ZAP corre con 1 hilo, 300 ms de retardo y 15 min de tope, sin AJAX spider y sin escaneo activo de la API real. El escaneo activo sobre Pages es contra el sitio del propio repo y con un ritmo bajo: es aceptable.
- Escrituras posibles en producción, solo si existe un fallo que la prueba debe detectar:
  - POST anónimo a `units`, `exceptions`, `audit_log` y `user_roles`.
  - PATCH del rol propio, que se revierte con la gestora de prueba.
  - POST de excepción con una unidad inexistente, que la FK bloquea.

  Todo está marcado con `s05-fase-b` y tiene runbook. Una salvedad: si un POST anónimo a `audit_log` llegara a escribir, la fila no se podría borrar desde la app, porque la tabla es de solo inserción. Habría que limpiarla por SQL en el panel, que es una compuerta de la usuaria. Esto no cambia el veredicto, porque ese caso ya sería crítico y activa la regla de parada 3. Conviene añadirlo en "Si algo sale mal" de `pentest-preproduccion.md`.
- **H-ARQ-S05-01 (bajo, corregir antes de lanzar la fase B):** el guardia `Solo desde main` no protege los pasos con `if: always()`. Si alguien dispara `s05-fase-b` desde otra rama, el guardia falla y la prueba `fase-b.test.js` se omite. Pero `ZAP full scan de Pages` lleva `if: always()` y **se ejecuta igual contra producción**. El daño es mínimo, porque es el mismo sitio y el mismo ritmo, pero el guardia queda sin efecto. Corrección:
  - añadir `id: solo-main` al paso del guardia;
  - en el paso de ZAP y en `Sin alertas de riesgo alto (Pages)`, usar `if: ${{ !cancelled() && steps.solo-main.outcome == 'success' }}`;
  - opcionalmente, que `preprod-s05.test.js` lo exija.

  Puede ir en este PR si hay otra iteración, o en el ítem de fase 2 de V-05. En cualquier caso, debe estar antes del primer disparo de la fase B.

### 3. Secuencia S-05 fase A → primer despliegue → fase B → P-05 (coherente, el plan debe reflejarla)
- La secuencia del informe coincide con ADR 0014-despliegue (V-05), punto 4:
  1. Fase A en verde (este PR).
  2. Se fusiona `deploy.yml`, que queda inerte.
  3. Primer despliegue: compuerta de la usuaria.
  4. Fase B en modo `anonimo` como mínimo.
  5. Solo con la fase B en verde: P-05 (`EVALUATION_ENABLED`) y se anuncia la URL. Si aparece un hallazgo alto, se retira el sitio con *Unpublish*.
- Dependencia cruzada: en `docs/plan-maestro.md`, V-05 depende de S-05, y el criterio de S-05 exige la fase B, que necesita V-05. **El orquestador debe resolverlo en el plan**, sin cambiar el diseño. La forma propuesta:
  - **S-05 = fase A**: `Hecho` al fusionar este PR.
  - **Ítem nuevo S-05b = fase B**: depende del primer run de V-05, es la compuerta de P-05 y su criterio es el run de la fase B enlazado en `pentest-preproduccion.md`.
  - V-05 depende de S-05 (fase A).

  Así ningún ítem queda `Hecho` con su criterio a medias.
- Orden de las compuertas de configuración, dentro de la misma compuerta del primer despliegue, para no notificar dos veces:
  - **Antes del primer `deploy.yml`:** crear el environment `produccion` con regla de ramas `main` (H-C03-02). Si no existe, el primer run lo crea sin protección (ADR 0014-despliegue, consecuencias).
  - **Justo después del primer despliegue y antes de la fase B:** el panel de Auth (H-S05-01), porque la fase B falla si el registro sigue abierto, y desactivar `pg_graphql` (H-S05-03).
  - **Antes de dar de alta usuarios reales:** las cuentas de prueba y `S05_TEST_USERS`, que son opcionales y solo sirven para el modo `roles`.

### 4. ¿Los hallazgos exigen decisión del usuario?
| Hallazgo | Tipo | ¿Cambia una decisión confirmada? | Qué es |
|---|---|---|---|
| H-S05-01 registro abierto en producción | Configuración del panel de Auth | No. El diseño ya supone cuentas creadas por la gestora y `config.toml` ya tiene `enable_signup = false`. Solo falta replicarlo en el proyecto real. | Compuerta de configuración de la usuaria, verificada por `deploy.yml` (ADR 0014-despliegue, punto 3) y por la fase B |
| H-C03-02 environment `produccion` | Secretos y environment de GitHub | No. Endurece el despliegue sin cambiar el stack. | Compuerta "crear o rotar secretos" (CLAUDE.md §3). El cambio de código (`environment: produccion` en `evaluacion-mensual.yml` y `ritmo-diario.yml`) es del desarrollador en V-05 o en la fase 2, y debe ir **antes** de quitar los secretos del repositorio (runbook de `operacion.md`) |
| H-S05-03 `pg_graphql` | Extensión en el panel | No. El front usa PostgREST y no GraphQL, así que desactivarla no quita funcionalidad. | Compuerta de configuración de la usuaria. La fase B verifica que la introspección anónima no publique tablas |

Ninguno activa la regla de parada 2. Se registran en `docs/pendientes-usuario.md` como parte de la compuerta del primer despliegue, que ya está prevista, con una sola notificación.

### 5. Choque de numeración de ADR (debe corregirse antes de fusionar V-05)
- `origin/item/V-04` (PR #22, abierto) trae `docs/adr/0014-salud-del-sistema.md` (2026-11-19). `origin/item/V-05` trae `docs/adr/0014-despliegue-manual-primero.md` (2026-11-20). `main` llega hasta 0013.
- Propuesta: V-04 conserva **0014**, porque es anterior y ya tiene referencias en `operacion.md` y en sus informes. En la rama V-05, el ADR de despliegue se renumera a **0015**:
  - `git mv docs/adr/0014-despliegue-manual-primero.md docs/adr/0015-despliegue-manual-primero.md`;
  - cambiar el título a `# ADR 0015 — …`;
  - cambiar las referencias "ADR 0014" a "ADR 0015" en `docs/operacion.md` de V-05 (líneas 104 y 152) y en `docs/reportes/V-05-arquitectura.md` (líneas 5, 12, 21 y 22).
- Si V-05 se fusiona primero, el `operacion.md` de V-04 sigue diciendo "ADR 0014" y queda bien, porque apunta a salud. Hay que vigilar el conflicto de `docs/operacion.md` entre las dos ramas al fusionar la segunda.
- Este informe y `pentest-preproduccion.md` citan el ADR de despliegue por su nombre y no por su número, salvo el punto 3 de este informe, que lo llama "ADR 0014-despliegue". Con la renumeración pasa a ser 0015.

### 6. Otros (informativos)
- `s05-fase-b` declara `environment: produccion` y lee `secrets.S05_TEST_USERS`. Si se crea `S05_TEST_USERS` como secreto de repositorio y no del environment, cualquier rama lo puede leer. El procedimiento ya dice "del environment `produccion`": hay que mantenerlo así.
- La fase A usa la contraseña de la gestora de la semilla (`Local-Only-Pass-2026`, ficticia y solo local) en la línea de `curl`. Es aceptable porque solo existe en el runner y es pública por diseño en la semilla.
- El `if` de `s05-fase-a` (`github.event_name != 'workflow_dispatch' || inputs.fase_b == 'no'`) funciona bien con `schedule`: `inputs` va vacío y el job corre.
