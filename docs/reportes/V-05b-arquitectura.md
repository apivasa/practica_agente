# V-05b — Informe de arquitectura y salud
Veredicto: VERDE (re-revisión intento 2, SHA 9b4a34a; ver la última sección. Historial: primera revisión VERDE; re-revisión V-05c en 86b447c ROJO por H-ARQ-V05b-08, ya cerrado)
Alineado al diseño: sí. Se mantiene el stack (Pages estático, Supabase, Actions). Se mantiene el orden de jobs del ADR 0015 punto 2 y el punto 6 (sin revisor en `produccion`). La fase 2 era el seguimiento previsto en el punto 5. `paths-ignore` de `docs/**` y `**/*.md` es una lectura válida de «en cada merge a `main`»: esos commits no cambian `dist/` ni las migraciones, y ningún `.md` fuera de `docs/` entra al build (ningún `import` de `.md` en `src/`, `engine/`, `scripts/` ni `vite.config.js`). No hay que cambiar ninguna decisión confirmada.
Requiere decisión del usuario: no. Sí hay compuertas operativas de la usuaria antes del merge y después (ver H-ARQ-V05b-03 y -04). No son desviaciones del diseño.
ADR creados o actualizados: `docs/adr/0015-despliegue-manual-primero.md`. Se añade «Actualización V-05b (fase 2)», el estado queda en fase 2 entregada y el punto 6 ya no lleva `SUPABASE_ACCESS_TOKEN`.
Salud:
- **CI de la rama, run 44840478337 (ae7de7c): `failure`** en el job build. Fallan las pruebas del tester de la fase 1 en `tests/workflows/deploy.test.js`: 883 (solo `workflow_dispatch`), 894 (5 secretos con `SUPABASE_ACCESS_TOKEN`), 898, 899, 912 y 914. Las cuatro últimas no definen `SUPABASE_DB_POOLER_HOST` en el entorno del bash de `verify`, o esperan `SUPABASE_ACCESS_TOKEN`. Es el cambio de comportamiento esperado del ítem, no un defecto de `deploy.yml`. El tester tiene que actualizar esas pruebas: el desarrollador no puede tocarlas. La fusión queda bloqueada hasta que CI quede verde. db (58 s) e integración (84 s) salieron `success`, dentro de base. e2e salió `skipped` porque depende de build. Seguridad 44840478234 seguía en curso.
- `qa-c03.test.js` «líder registrado solo en units.leader_user_id» es un `# TODO` que ya existía (H-C04-QA-01). No hace fallar el run.
- `tests/scripts/db-url-v05b.test.js`: 18/18 en local.
- Workflows programados y `salud.yml`: el ítem no los cambia. `salud.yml` todavía no vigila `deploy.yml` (H-ARQ-V05b-02).
- Runbook actualizado en `docs/operacion.md` › «Despliegue continuo (V-05b)»: disparo, cómo vigilarlo, concurrencia, variable del pooler, pasos de la usuaria (incluido retirar `SUPABASE_ACCESS_TOKEN`), qué pasa si algo falla a mitad, cómo revertir y fusionar de a uno. También tiene diagnóstico nuevo de `migrate-plan` sin `supabase link`.

Hallazgos:
- **Decisiones validadas**
  - **Orden de jobs.** `verify` → `build-pages` → `migrate-plan` → `migrate` → `deploy-pages` (`needs: [build-pages, migrate]`) → `smoke`. Lo reversible falla antes que el `db push`. Si `migrate` falla, el front no se publica. Si `deploy-pages` falla después de migrar, queda BD nueva con front viejo, que el punto 2 obliga a mantener compatible. La tabla de estados y acciones está en el runbook.
  - **Concurrencia** `despliegue-produccion` con `cancel-in-progress: false`. Correcta: un `db push` nunca se corta, y el run que GitHub deja en cola es siempre el más reciente, que incluye a los anteriores.
  - **`--db-url` con CLI 3.2.0.** `db push --db-url` (con `--dry-run` y con `--yes`) y `migration list --db-url` son opciones válidas de la CLI. Sin `link`, el destino es explícito y nunca el stack local. Pooler de sesión: puerto 5432, usuario `postgres.<ref>`, IPv4. La contraseña va codificada con `jq @uri` y enmascarada. El host está restringido por regex, así la contraseña no sale a otro host. La primera evidencia real será el primer run en `main`: hasta entonces no se ha probado contra producción.
  - **`verify` en push.** Solo `GITHUB_EVENT_NAME=push` se libra de `confirm`. El resto de controles (rama `main`, secretos, origen CSP, `disable_signup`) corre en los dos disparadores. Ningún job lee `SUPABASE_SECRET_KEY` ni `SUPABASE_ACCESS_TOKEN`.
  - **`config.toml`.** `minimum_password_length = 12` y `password_requirements = "lower_upper_letters_digits"` van bajo `[auth]`, con claves y valor válidos. La semilla crea usuarios por SQL, así que no le afecta.
- **H-ARQ-V05b-01 (medio, ítem de seguimiento propuesto, no bloquea).** El despliegue no espera al CI del commit fusionado. `main` no tiene protección de rama (la API devuelve 404 «Branch not protected»), así que una fusión squash no exige estar al día. Dos PR con migraciones fusionados seguidos llegarían a producción sin haberse probado juntos, y en paralelo al CI de `main`. Propuesta de ítem (P2, XS): en `verify`, solo con `push`, esperar hasta 15 min a que el run `CI` con `head_sha = GITHUB_SHA` en `main` termine en `success` (necesita `actions: read`), y fallar si termina en otro estado. Mientras tanto: fusionar de a uno (está en el runbook).
- **H-ARQ-V05b-02 (bajo, ítem de seguimiento propuesto).** `salud.yml` solo mira `ci-main` y no el último run `push` de `Despliegue` en `main`. Con despliegue continuo, un fallo de despliegue solo llega por el correo de GitHub. Propuesta: check `deploy-main` en `scripts/health/` (área del desarrollador): último run `push` o `workflow_dispatch` completado y no cancelado en `success`. Mientras tanto, el orquestador lo revisa en el paso 3 del ciclo (runbook).
- **H-ARQ-V05b-03 (compuerta de la usuaria, antes del merge).**
  - Crear la variable `SUPABASE_DB_POOLER_HOST` en el environment `produccion`. El proyecto está en us-east-2: copiar el valor exacto de *Connect → Session pooler*, que puede ser `aws-0-` o `aws-1-`.
  - Confirmar que `produccion` tiene la regla de ramas `main`, que es condición del ADR 0015 punto 5. La sesión no puede comprobarlo (403 en la API de environments y de variables).
  - Si se fusiona sin la variable, el run falla en `verify` sin efecto alguno.
- **H-ARQ-V05b-04 (compuerta de la usuaria, después del merge).**
  - (a) Fijar en el panel de Auth de producción la contraseña mínima de 12 con minúsculas, mayúsculas y dígitos. H-S03-02 solo queda cerrado en local y CI, porque `config.toml` no se aplica con `db push` y `/auth/v1/settings` no expone esa política.
  - (b) Cuando haya un despliegue continuo en verde, borrar `SUPABASE_ACCESS_TOKEN` del environment y del repositorio, y revocarlo en la cuenta de Supabase.
  - El orquestador debe registrar los dos en `docs/pendientes-usuario.md`.
- **H-ARQ-V05b-05 (bajo, documentación).** `docs/despliegue.md`, líneas 12 y 44, sigue listando `SUPABASE_ACCESS_TOKEN` y describe solo la fase 1. Es área del documentador.
- **H-ARQ-V05b-06 (informativo, en el runbook).** Revertir un PR que añadió una migración borra el archivo. `db push` falla entonces porque la versión remota no está en local, y el front revertido tampoco se publica. Se revierte solo el código y el esquema se corrige con una migración nueva.
- **H-ARQ-V05b-07 (informativo).** No hay «desplegar versión anterior», porque `verify` exige `refs/heads/main` y siempre se despliega la cabeza. El rollback del front es un revert en `main`. Es coherente con el diseño y está en el runbook.

## Re-revisión V-05b + V-05c (2026-11-21, SHA 86b447c, PR #45)
Veredicto: ROJO
Alineado al diseño: sí. V-05c cierra H-ARQ-V05b-01 sin cambiar el stack, el orden de jobs ni la regla de no tener revisor en `produccion`. El defecto que bloquea está en cómo interactúa la nueva puerta con la concurrencia de `ci.yml`, y se corrige dentro del ítem.
Requiere decisión del usuario: no.
ADR creados o actualizados: `docs/adr/0015-despliegue-manual-primero.md`. Se reescribe el punto 6 de la «Actualización V-05b» como «Puerta de CI (V-05c)», que añade como requisito que el CI de cada commit de `main` termine, y se actualiza la línea de estado.
Salud:
- **CI de la rama en 86b447c:** CI 44868418993 y 44868415509 `success`. Seguridad 44868418987 y 44868415476 `success`.
- **Workflows programados y `salud.yml`:** sin cambios en este ítem. `deploy-main` (V-04b) ya está en `main`.
- **Runbook:** `docs/operacion.md` › Despliegue continuo tiene la «Puerta de CI», «Fusionar de a uno» actualizado y los fallos nuevos del paso «CI del mismo commit en verde». También corrige la nota de timeouts de `deploy-main` (era ~55 min, ahora son ~75).

Hallazgos:
- **Validado.**
  - `wait-ci.sh` solo espera en `push`. Valida el repositorio, el SHA de 40 hex, los enteros y el token. Filtra por `path` de `ci.yml` (también con sufijo `@ref`), `head_sha`, `event=push` y `branch=main`, y toma el id mayor. Exige `completed` + `success`. Si la API falla, reintenta hasta el tope. Nunca imprime el token.
  - `actions: read` está solo en `verify`. Los topes (20 min de espera, 25 de job) son coherentes con un CI de unos 4 a 5 min.
  - `db-url.sh` hace `{ set +x; } 2>/dev/null` al entrar, y la traza no se reactiva. Es correcto y está documentado.
- **H-ARQ-V05b-08 (alto, bloquea; corrige el desarrollador en `.github/workflows/ci.yml`).** `ci.yml` tiene `concurrency: group: ci-${{ github.ref }}` con `cancel-in-progress: true`, y corre en todo push a `main`, también los de solo `docs/**`. El orquestador sube a `main` un commit de `docs/estado.md` minutos después de cada merge (paso 10, latido, candado). Ese commit cancela el CI del merge. Con V-05c, el despliegue del merge falla en `verify` (`conclusion 'cancelled'`), y el commit de docs no despliega porque `paths-ignore` lo excluye. El código fusionado no llega a producción hasta el próximo merge con código, y `deploy-main` de `salud.yml` queda en **failure** y abre un issue. No es un aviso: el run de Despliegue termina en `failure`, no en `cancelled`, así que la tolerancia a cancelaciones de `assessDeploy` no lo cubre.
  - **Evidencia en `main`.** CI cancelado por el commit siguiente en `[fix] Privilegios explícitos de service_role (#52)` (7b4579d), `[C-05] Correo de alertas por Resend (#49)` (4604747) y `C-05: cerrar alerta CodeQL #18` (f0b7108). Con V-05c, los tres despliegues habrían fallado. Lo normal es que pase en cada merge, no de vez en cuando.
  - **Corrección mínima.** Agrupar por SHA en `main` y no cancelar ahí. Las ramas y los PR siguen igual:
    ```yaml
    concurrency:
      group: ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}
      cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
    ```
    El grupo por SHA es necesario. Con el grupo por `ref` y `cancel-in-progress: false`, GitHub sigue reemplazando el run *pendiente* por el más nuevo, y el CI de un merge en cola se perdería igual. Costo: varios CI de `main` en paralelo. El repo es público (minutos sin costo), y cada job levanta su propio Supabase local, sin recursos compartidos.
  - **Prueba requerida (tester).** `ci.yml` no cancela en `main` y agrupa por SHA en `main`. Hoy ninguna prueba fija la concurrencia de `ci.yml`.
  - **Descartado como solución principal: tolerancia en `salud.yml` o en `deploy-main`.** Taparía la alerta, pero el merge seguiría sin desplegarse. El problema es de disponibilidad de la entrega, no de ruido en el monitoreo. `salud.yml` no necesita cambios.
  - **Opcional (P3, no bloquea).** Si el CI de A sale `cancelled` y entre A y la cabeza de `main` solo cambió `docs/**` o `*.md`, `wait-ci.sh` podría esperar el CI de la cabeza. Con la corrección de arriba no hace falta.
- **H-ARQ-V05b-09 (bajo, ítem de seguimiento; área del desarrollador, `scripts/health/lib.js`).** Con `verify` en 25 min, la suma de timeouts de `deploy.yml` es de unos 75 min. Supera `DEPLOY_RULE.maxPendingMin = 60`. Un run legítimo que espere al CI cerca del tope, más migraciones lentas, podría salir como «atascado». Propuesta: subir `maxPendingMin` a 90, o derivarlo de la suma de timeouts con una prueba que los ate. Ya está anotado en el runbook.
- **H-ARQ-V05b-10 (informativo).** El despliegue de un commit posterior sigue esperando en cola (`despliegue-produccion`, sin cancelar) mientras `verify` del anterior espera al CI. Con dos merges seguidos hay hasta unos 10 min de cola. Es aceptable.

## Re-revisión intento 2 (2026-11-21, SHA 9b4a34a, PR #45)
Veredicto: VERDE
Alineado al diseño: sí. Los cambios se quedan en la concurrencia de CI, un umbral de salud y los mensajes de `wait-ci.sh`. No se toca el stack, el orden de jobs ni las reglas del ADR 0015.
Requiere decisión del usuario: no. Siguen en pie las compuertas operativas de H-ARQ-V05b-03 y -04 (secretos y primer despliegue continuo).
ADR creados o actualizados: `docs/adr/0015-despliegue-manual-primero.md`, punto 6. Se añade «Implementado en V-05c»: en `main` el CI ya no se cancela. También se añade el coste en minutos de runner.
Salud:
- **CI de la rama en 9b4a34a:** CI y Seguridad `success`, en los dos eventos (push y pull_request). El `failure` de 83ce89e era la prueba de QA `qa-v05c` escrita antes de la corrección, que es lo esperado.
- **Runbook:** `docs/operacion.md`. La tabla de checks de `deploy-main` pasa de «> 60 min» a «> 90 min». La nota de timeouts ya no deja H-ARQ-V05b-09 abierto. «Puerta de CI» y el fallo `cancelled` dicen que en `main` el CI ya no se cancela y que solo una cancelación manual lo provoca.
- **Workflows programados y `salud.yml`:** sin cambios. `salud.yml` no necesita tocarse: `DEPLOY_RULE` vive en `scripts/health/lib.js`.

Hallazgos:
- **H-ARQ-V05b-08: cerrado.** `ci.yml` usa `group: ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}` y `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`, tal como se propuso. En `main` cada SHA tiene su propio grupo, así que el CI del merge no se cancela ni se reemplaza en cola. En los PR (`refs/pull/<n>/merge`) y en `item/**` y `fix/**`, la cancelación por `ref` sigue igual. Lo fija `tests/workflows/qa-v05c.test.js` (`cancelsOnMain`).
- **H-ARQ-V05b-09: cerrado.** `DEPLOY_RULE.maxPendingMin = 90` está por encima de la suma de timeouts de `deploy.yml`: 25 + 10 + 10 + 15 + 10 + 5 = 75 min. Las pruebas de V-04b (`health-deploy`, `qa-v04b`, `security/health-deploy-v04b`) ya usan el nuevo valor. No se exige derivar el umbral de los timeouts con una prueba que los ate (ver P3 abajo).
- **`wait-ci.sh`: validado.** Solo `workflow_dispatch` se exime, y cualquier otro evento falla. Eso es coherente con `deploy.yml`, que solo tiene `push` y `workflow_dispatch`. El filtro jq añade `head_sha` y `event` como defensa en profundidad. Si a un run le falta uno de esos campos, el filtro lo acepta, pero la consulta ya filtra por los dos, así que es aceptable. El mensaje final distingue tres casos: tope vencido con un run visto, fallos de la API (con el último error saneado: sin token, sin `::` y recortado a 200 caracteres) y run ausente. El mensaje de `cancelled` ya no promete un redespliegue.
- **Coste de no cancelar en `main` (valorado, no bloquea).** En los últimos 12 CI de `main`, 4 salieron `cancelled`. Con el cambio, esos runs terminan. Cada CI de `main` dura unos 4 a 5 min de pared y unos 8 min facturables (4 jobs con redondeo). Con unos 10 merges por ciclo, el extra ronda los 80 min de runner por ciclo. El repo es público y en runners estándar los minutos son gratis, así que el coste real es nulo. Tampoco hay contención: cada job levanta su propio Supabase local. Solo se ven varios CI de `main` en paralelo durante unos minutos. Si el repo pasara a privado, la mitigación sería saltar el CI de `main` en los push que solo cambian `docs/**` o `*.md`, ya que esos no despliegan. Queda anotado en el ADR 0015 punto 6.
- **P3 (opcional, no bloquea).** Si alguien sube algún `timeout-minutes` de `deploy.yml` y la suma pasa de 90, `deploy-main` podría dar un falso «atascado». Una prueba que compare la suma de timeouts con `DEPLOY_RULE.maxPendingMin` lo evitaría. Puede ir en un ítem de seguimiento.
- **Documentación fuera de mi área.** `docs/despliegue.md` línea 74 todavía dice «más de 60 min». Le toca al documentador cambiarlo a 90.
- **H-ARQ-V05b-10:** sin cambios (informativo).

