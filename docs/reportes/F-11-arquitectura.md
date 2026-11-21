# F-11 — Informe de arquitectura y salud
Veredicto: VERDE (intento 2, cabeza ed73630). H-ARQ-F11-01 a 05 están cerrados. Dos rojos de CI impiden fusionar, pero quedan fuera del código del desarrollador: H-ARQ-F11-06 es del tester y H-ARQ-F11-07, de seguridad. Ver «Intento 2».
Alineado al diseño: sí. Se mantienen el stack, el orden de jobs del ADR 0015 y el motor puro. El único `if:` de la cadena depende de una salida de `verify`, no del evento.
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0015-despliegue-manual-primero.md`. El punto 8 se escribió en el intento 1. En el intento 2 se detalla la implementación: salida `deploy`, `if` solo en `build-pages`, modo `--strict` en `migrate` y `deploy-pages`, y por qué `migrate-plan` no lo lleva.
Salud: el CI de `item/F-11` (ed73630) está en **rojo** en dos jobs. (1) En `build` falla 1 de 2874 pruebas: `tests/workflows/deploy.test.js:247`, «ningún paso de la cadena se salta por evento», ve el `if:` nuevo de `build-pages` (H-ARQ-F11-06). (2) En Seguridad, `gitleaks` encuentra la clave ficticia que cita el informe de seguridad en el commit a9fecda (H-ARQ-F11-07). Los demás jobs están en verde: db, integración, CodeQL, semgrep, DAST, pentest, npm audit y pruebas de seguridad. Las 4 pruebas C-05/C-06 del intento 1 ya pasan (H-ARQ-F11-05 cerrado). En `main`, 6980452 salió verde en CI y en Seguridad; acce1f9 está en curso. Los timeouts de `deploy.yml` siguen sumando 75 ≤ 90. El paso `--strict` añade como mucho unos 30 s dentro de `migrate` (15 min) y de `deploy-pages` (10 min).

## Intento 2 (cabeza ed73630)

### Verificación de H-ARQ-F11-01..05
- **01, cerrado.** Primer intento superado por código: `::warning::`, `deploy=false` y salida 0. Si falta `GITHUB_OUTPUT`, falla cerrado. Un intento > 1 o desconocido da `::error::` y 1. `behind`, `diverged`, `unknown` y la API caída fallan siempre. Solo `build-pages` lleva `if: needs.verify.outputs.deploy == 'true'`, y `migrate-plan`, `migrate`, `deploy-pages` y `smoke` se saltan por `needs`: la conclusión del run es `success`. `workflow_dispatch`, la punta y «solo docs» escriben `deploy=true`. Hay pruebas para cada caso y una que fija el `if` único y la cadena de `needs`. `assessDeploy` da ok a un run `success` con jobs saltados, también con prueba. Revisé que, si `verify` falla, la salida no queda escrita y nada corre.
- **02, cerrado.** `migrate` y `deploy-pages` hacen checkout sin credenciales persistidas y su segundo paso es `check-main-tip.sh --strict`, antes de `setup-cli` o `deploy-pages`. En `--strict` no se escribe en `$GITHUB_OUTPUT` y un run superado falla siempre. `contents: read` en `deploy-pages` es el permiso mínimo para el checkout y la consulta. No le pongo reparo a que `migrate-plan` no tenga el paso: solo hace un dry-run.
- **03, cerrado.** El filtro `doc` se aplica a `filename` y también a `previous_filename` cuando existe. Un `previous_filename` que no sea string cuenta como código. Si `files` no es arreglo, pasa de 300 entradas o tiene una entrada sin nombre, el resultado es `unknown` y falla cerrado en cualquier intento.
- **04, cerrado.** La constante `DOC_PATHS_IGNORE` está comentada con su traducción a predicados. La prueba compara la constante, `paths-ignore` y el número de predicados del filtro.
- **05, cerrado.** El tester completó las BD falsas (5b44639) y esas pruebas pasan en CI.
- **`wait-ci.sh`.** Ahora exige `head_sha == $sha` y `event == "push"`, sin valores por defecto: un run sin esos campos no cuenta. Es correcto (H-QA-V05c-03).
- Ejecuté localmente (node 22) las suites de F-11, la de QA de F-11 y las de seguridad de V-05c y F-11: 229/229 en verde.

### H-ARQ-F11-06 (bloquea el merge; área del tester): una prueba de V-05b contradice H-ARQ-F11-01
`tests/workflows/deploy.test.js:247` prohíbe cualquier `if:` en `verify`, `build-pages`, `migrate-plan` y `migrate`. La regla que protege (ADR 0015, V-05b) es que ningún job se salte **según el evento**, porque eso volvería a abrir el camino sin confirmación ni puerta de CI. El `if` de `build-pages` lo pedí yo en H-ARQ-F11-01 y no depende del evento. El cambio va en la prueba, no en el workflow, y el desarrollador no puede tocarla (CLAUDE.md §1). Corrección para el tester: en esos cuatro jobs, prohibir los `if:` que nombren `github.event`, `github.event_name`, `inputs.` o `github.ref`, y permitir solo, y exactamente, `if: needs.verify.outputs.deploy == 'true'` en `build-pages`. La prueba H-ARQ-F11-01 de `tests/scripts/f11-fixes.test.js` ya fija que ese es el único `if` de nivel job.

### H-ARQ-F11-07 (bloquea el merge; área de seguridad): gitleaks del historial completo
La línea 69 de `docs/reportes/F-11-seguridad.md`, en el commit a9fecda, cita literalmente la clave ficticia (`re_TESTKEY_...`) para justificar la entrada de `.gitleaksignore`, y esa cita genera una huella nueva: `a9fecdafc152454404ef864e9e228972f5e81130:docs/reportes/F-11-seguridad.md:generic-api-key:69`. El commit ya está publicado en la rama, así que no se puede reescribir. Corrección para seguridad: añadir esa huella exacta a `.gitleaksignore` con su justificación y, en la punta, reescribir la cita sin el literal (por ejemplo, «la clave ficticia de la línea 178»). Así el informe no vuelve a generar la huella en commits futuros. No es un secreto real.

### Cambios del arquitecto en el intento 2
- `docs/operacion.md`, caso «Falla `verify`, paso Commit vigente en main». El primer intento superado ahora es un **aviso** con run `success` (ya no hay «mientras tanto»). Un relanzamiento superado da error y no se relanza más. El error de `--strict` en `migrate` o `deploy-pages` tiene su propio procedimiento. Hay un caso nuevo para `unknown` (lista de archivos ausente o truncada), y se mencionan los renombrados y la prueba que ata las dos listas.
- `docs/adr/0015-despliegue-manual-primero.md`, punto 8: los detalles de implementación descritos arriba.

## Intento 1 (cabeza e5a34ce): veredicto ROJO

## Hallazgos

### H-ARQ-F11-01 (medio, bloquea): falso fallo cuando dos merges con código llegan seguidos
Caso: el run D1 del merge A está en `verify`, esperando su CI unos 5 min. Mientras tanto se fusiona B con código, y D2 queda en cola en `despliegue-produccion`. Al terminar la espera, `check-main-tip.sh` ve que la punta es B, con código, y D1 termina en `failure`. Antes de F-11, D1 publicaba A y D2 publicaba A+B sin problema. Ahora hay dos efectos sin que exista ningún defecto:
- `deploy-main` de `salud.yml`: si corre mientras D2 está en cola o en curso, el último run completado es D1 (`failure`), así que falla y abre el issue `salud`. Ese issue no se cierra solo.
- El paso 3 del ciclo del orquestador ve un Despliegue rojo en `main` y puede abrir un `fix/main-<fecha>` innecesario. En modo acelerado los merges seguidos son frecuentes.

Corrección pedida (desarrollador, `scripts/ci/check-main-tip.sh` y `deploy.yml`):
- Si el run queda superado por un commit con código y es su primer intento (`GITHUB_RUN_ATTEMPT == 1`), es la carrera prevista. El script emite `::warning::` (o `::notice::`), escribe `deploy=false` en `$GITHUB_OUTPUT` y sale con 0.
- `verify` expone ese output. `build-pages` lleva `if: needs.verify.outputs.deploy == 'true'`, y los jobs siguientes se saltan en cadena. La conclusión del run es `success` y no se publica nada.
- Si es un relanzamiento (`run_attempt > 1`), se mantiene el `::error::` y el exit 1 actuales.
- `behind`, `diverged`, la API caída y la entrada inválida siguen fallando cerrado.
- Faltan pruebas para los dos casos de `run_attempt`, para la salida `deploy=false` y para el `if` de `build-pages`.

### H-ARQ-F11-02 (medio, bloquea): `rerun-failed-jobs` se salta la comprobación
`rerun-failed-jobs` no repite los jobs que salieron verdes. Si `verify` pasó y después falló `migrate` o `deploy-pages`, al relanzar los jobs fallidos con un commit más nuevo con código ya en `main`, el run viejo publica su `dist/` anterior. Esto es justo lo que H-V05c-01 quería impedir, y además es el procedimiento que el runbook recomienda para `deploy-pages`.

Corrección pedida: repetir el paso «Commit vigente en main» (el mismo script, con `GH_TOKEN: ${{ github.token }}` y `contents: read`) como primer paso de `migrate` y de `deploy-pages`, antes de cualquier efecto. Ahí, un run superado debe fallar siempre, aunque sea el primer intento: si `verify` vio la punta, este caso solo aparece en un relanzamiento o en una carrera muy larga, y el run más nuevo ya lo cubre. Con este diseño `deploy-pages` puede tener que fallar. Como alternativa aceptable, puede saltarse a sí mismo y a `smoke` con la misma salida. Lo que no puede hacer es publicar.

### H-ARQ-F11-03 (bajo, bloquea por ser trivial): renombrados de código a `docs/`
El filtro jq solo mira `.filename`. Un renombrado `src/x.js → docs/x.js` cuenta como «solo documentación», y se aceptaría desplegar el commit anterior aunque `dist/` cambia. Corrección: exigir que también `previous_filename`, cuando exista, cumpla `startswith("docs/") or endswith(".md")`. Falta una prueba con un archivo `renamed`.

### H-ARQ-F11-04 (bajo, bloquea): la lista de «solo documentación» está en dos sitios y nada los ata
`on.push.paths-ignore` de `deploy.yml` (`docs/**`, `**/*.md`) y el filtro del script tienen la misma lista, pero escrita en dos lugares y sin una prueba que los ligue. Corrección: una prueba en `tests/scripts/` que lea `paths-ignore` de `deploy.yml`, compruebe que es exactamente `['docs/**', '**/*.md']` y que el script contiene los dos predicados (`startswith("docs/")`, `endswith(".md")`). Mejor todavía: que el script tenga la lista en una constante comentada y que la prueba compare ambas. Si alguien amplía una de las dos sin la otra, la prueba falla. La semántica coincide en lo que importa: `**/*.md` de GitHub incluye los `.md` de la raíz, igual que `endswith(".md")`.

### H-ARQ-F11-05 (bloquea el merge, fuera de mi área): CI en rojo por pruebas de QA anteriores a H-C06-01
Las 4 pruebas que fallan (C-05 y C-06) son del tester y construyen la BD falsa sin `recipientAccess`, `expiredEmailAlerts` ni `markAlertsEmailSkipped`. Ahora el fail-closed es el comportamiento correcto que pide H-C06-01, así que el arreglo está en esas pruebas (área del tester): añadir los tres métodos a las BD falsas. El desarrollador no debe tocarlas (CLAUDE.md §1). El orquestador debe pasárselo al tester en este mismo intento.

### Revisado sin hallazgos
- **Motor (`engine/xlsx.js` `numberText`, `engine/measurements-input.js`).** Sigue siendo una función pura y local de `xlsx.js`, sin duplicados: CSV y XLSX convergen en `validateMeasurementInput`. Los negativos con exponente se expanden y quedan dentro de `NEGATIVE_NUMBER_RE`, con el mensaje «≥ 0». Lo comprobé con `-1E+21`, `-9.99E-8`, `-1.5E+300` y `-1E-25`. Este último da `"-0"`: se rechaza bien y el texto del mensaje (`"-0"`) es solo informativo. El recorte del valor a 30 caracteres evita mensajes de 300 dígitos.
- **`wait-ci.sh`.** Quitar `\r` en `clean_error` es correcto (H-V05c-03a), y los mensajes nuevos avisan de no relanzar runs superados.
- **`scripts/lib/email.js`.** El fail-closed `missingEmailDbMethods` devuelve código 2 sin enviar nada. Es coherente con ADR 0017: configuración o capa de BD inválida = 2, y `salud.yml` lo ve por `correo-alertas`.
- **Seguridad del script.** No imprime el token, neutraliza `::` y `\r` en los errores, valida el SHA y el repositorio, y falla cerrado ante una API caída o una respuesta inesperada. Con 300 archivos o más no se puede afirmar «solo docs» y se falla. Si `gh` se cuelga, el tope es el timeout del job, que termina en `timed_out` (cerrado).

### Cambios del arquitecto en esta revisión
- `docs/adr/0015-despliegue-manual-primero.md`: punto 8 con la decisión y los requisitos H-ARQ-F11-01 a 04.
- `docs/operacion.md`: caso nuevo «Falla `verify`, paso Commit vigente en main» con cada mensaje y qué hacer, y en la tabla de fallos, matiz de relanzar solo si el commit sigue siendo la punta.
- `.github/workflows/salud.yml`: el comentario decía 60 min. Ahora dice 90 (`DEPLOY_RULE.maxPendingMin` desde V-05c). Solo cambia el comentario.

### Para la siguiente revisión
Cuando H-ARQ-F11-01 esté implementado, actualizaré el runbook: el caso de primer intento pasará a ser un aviso y se quitará el «mientras tanto» de `docs/operacion.md`.
