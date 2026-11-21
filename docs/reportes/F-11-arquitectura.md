# F-11 — Informe de arquitectura y salud
Veredicto: ROJO
Alineado al diseño: sí (stack, orden de jobs del ADR 0015 y motor puro intactos). Lo que falla es operativo: el paso nuevo convierte una carrera inofensiva entre merges en un run rojo, y la comprobación se puede saltar con `rerun-failed-jobs`. Las dos cosas se corrigen dentro del ítem.
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0015-despliegue-manual-primero.md` (punto 8 nuevo: commit vigente en `main`, una sola lista de «solo documentación», carrera entre merges seguidos, comprobación antes de los efectos, timeouts)
Salud: el CI de `item/F-11` (e5a34ce) está en **rojo**. Fallan 4 pruebas de `build`: `runEmailStep` («fallos de Resend: ::warning:: y código 0», «errores de la BD: código 1») y `C-05 QA reintentos y errores de Resend` (dos subpruebas). Esas pruebas usan BD falsas sin los métodos de C-06, y el nuevo fail-closed (H-C06-01) las corta con código 2. Seguridad sale en verde en e5a34ce. En `main`, la cabeza 6980452 está en curso y el anterior (3c9d350) salió verde en CI, Seguridad y Despliegue. La suma de timeouts de `deploy.yml` es 25+10+10+15+10+5 = 75 ≤ 90 (`DEPLOY_RULE.maxPendingMin`), y la prueba P3 la fija. El paso nuevo añade unos 30 s en el peor caso (3×10 s) dentro de los 25 min de `verify`.

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
