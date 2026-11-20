# M-14 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí. La migración solo aprieta nueve CHECK `_safe` y conserva sus nombres. No hay columnas ni tablas nuevas, ni funciones o RPC, y no cambian los grants. La regla del tope sigue con su fuente de verdad en la BD y con una sola constante en `engine/numeric.js`.
Requiere decisión del usuario: no. Aplicar la migración en producción sigue la compuerta habitual de `migrate`, con la verificación previa.
ADR creados o actualizados: `docs/adr/0005-modelo-datos-y-rls.md`. La sección de la regla compartida ahora dice "M-09..M-14". El "Límite conocido (H-ARQ-M13-01)" se reemplazó por "Borde exacto (M-14, cierra H-ARQ-M13-01)", que explica por qué el borde es 2^53 − 0,5, por qué el motor no cambia y cómo redefinir un CHECK `_safe`: `DROP` + `ADD` con el mismo nombre en un solo `ALTER`, sin `NOT VALID`.
Salud: **el CI de la rama está en rojo** en `0325618`. Fallan `db (pgTAP)` y `build`, y también `pruebas de seguridad` del workflow Seguridad. La causa no es un defecto de la migración: hay pruebas de regresión anteriores de tester y seguridad que fijan el borde viejo (ver H-ARQ-M14-01). El `main` está en verde (CI y Seguridad en `ccaaa08`). Los workflows programados siguen sin activarse (compuerta V-05) y M-14 no los toca. El runbook se actualizó en `docs/operacion.md`, en Despliegue: verificación previa de M-14.

## Verificación

1. **Coherencia con `engine/numeric.js`.** `JSON.parse` redondea al `double` más cercano y resuelve los empates al par. En [2^52, 2^53) los `double` van de 1 en 1, así que el punto medio entre 2^53 − 1 y 2^53 es 2^53 − 0,5, y el empate cae en 2^53. Lo comprobé con `node` y `isSafeMagnitude`:
   - `9007199254740991.4` → 9007199254740991: pasa.
   - `9007199254740991.49999999999999999999` → 9007199254740991: pasa.
   - `9007199254740991.5` → 9007199254740992: se rechaza.
   - Lo mismo en negativos.

   Con `abs(v) < 9007199254740991.5`, cualquier `numeric` que pasa la BD se lee en JS con |v| ≤ 2^53 − 1, y cualquiera que se rechaza se lee con |v| ≥ 2^53. La equivalencia es exacta. `SAFE_ABS_LIMIT = 2^53` puede quedar igual: entre 2^53 − 1 y 2^53 no existe ningún `double`, así que en JS `< 2^53` y `<= 2^53 − 1` son el mismo predicado. Los `.abs()` de jsonpath trabajan sobre el `numeric` exacto de JSONB, igual que `abs()` en las columnas.
2. **Trigger de M-09 y `_whole`.** El trigger exige un entero ≤ 2^53 − 1, y `commitments_package_by_category_whole` exige un entero ≥ 0. Todo entero ≤ 2^53 − 1 es exacto en `double` y cumple el CHECK nuevo, así que no hay contradicción ni zona muerta. Un VULN de 9007199254740991.5 lo frena primero el CHECK (se evalúa antes del trigger), con 23514 igual que antes. `091_qa_m09` acepta cualquier mensaje y sigue pasando.
3. **Orden de los constraints.** PostgreSQL evalúa los CHECK en orden alfabético de nombre. Como los nombres se conservan, el orden no cambia. Hay un solo cambio visible: `9007199254740991.9999` en `package_by_category` ya no lo reporta `_whole`, sino `commitments_package_by_category_safe`, que va antes por orden alfabético y ahora también lo rechaza. Es lo correcto, y el runbook lo deja escrito.
4. **Atomicidad.** Cada tabla cambia en una sola sentencia `ALTER TABLE` (varios `DROP` y `ADD`), que es atómica: no existe un instante sin restricción. Además, `db push` aplica el archivo en una sola transacción. Si alguna fila no cumple, falla el archivo completo y siguen vigentes los CHECK de M-11 y M-12. No hace falta `begin` explícito, igual que en M-10..M-12.
5. **Bloqueos en producción.** Cada `ALTER` toma `ACCESS EXCLUSIVE` y revisa la tabla completa en `indicators`, `commitments`, `targets` y `measurements`. Con el volumen académico son milisegundos. El riesgo es esperar a lecturas de una evaluación en curso. El runbook pide no lanzarla durante `evaluacion-mensual` ni `ritmo-diario`. No vale la pena usar `NOT VALID` + `VALIDATE` para reducir el bloqueo: dejaría el CHECK sin validar entre las dos sentencias y la guarda de seguridad lo prohíbe.
6. **Verificación previa.** Las cuatro consultas del final del archivo son de solo lectura y correctas:
   - Con columnas NULL, `not (abs(NULL) < x)` da NULL y no devuelve la fila. Es correcto, porque NULL está permitido.
   - El jsonpath `strict` no falla en producción, porque M-12 ya garantiza que `thresholds_by_category` y `package_by_category` son objetos.
7. **No es migración destructiva** en el sentido de CLAUDE.md §3: no borra tablas, columnas ni filas, y el `DROP CONSTRAINT` se reemplaza en la misma sentencia. La compuerta del usuario es solo la del primer despliegue o de `migrate`, como siempre.
8. **Tipos de columna.** Todas son `numeric` sin escala, así que no hay redondeo en la BD antes del CHECK. `package_total`, `target_value` y `measurements(…).value` en VULN ya exigen ≥ 0, y el borde negativo solo aplica a umbrales, overrides y `value` de mediciones en promedios.

## Hallazgos

- **H-ARQ-M14-01 (bloquea el merge por CI, no por diseño).** Hay pruebas anteriores que codifican el borde viejo y ahora fallan. No se arregla tocando la migración: las deben actualizar sus dueños.
  - Tester:
    - `supabase/tests/111_qa_m11.test.sql`, pruebas 11 y 32: `lives_ok` con ±9007199254740991.5 en umbrales y `package_total`. La 39 falla en cascada.
    - `supabase/tests/113_qa_m12.test.sql`, pruebas 12, 13 y 23: `lives_ok` con ±9007199254740991.5 en `thresholds_by_category` y `measurements.value`.

    El cambio es pasar a `9007199254740991.4` en los `lives_ok` y agregar un `throws_ok` en `.5`.
  - Seguridad:
    - `supabase/tests/security/049_security_numeric_safe_cap_m11.test.sql`, prueba 3, y `050_security_json_shape_m12.test.sql`, prueba 3: buscan el literal `9007199254740992` en `pg_get_constraintdef`. Deben buscar `9007199254740991.5`.
    - `050`, prueba 27: espera el mensaje de `_whole` para `9007199254740991.9999`, y ahora lo reporta `commitments_package_by_category_safe`.
    - `tests/security/engine-m13.test.js:105`, "sin drop posterior": prohíbe cualquier `drop constraint <nombre>_safe`. La guarda debe aceptar el patrón de redefinición de M-14 y exigir que la última aparición de cada nombre sea un `add constraint` sin `not valid` (lo registra el ADR 0005).
- **H-ARQ-M14-02 (proceso, para el orquestador).** El desarrollador modificó `supabase/tests/112_json_shape_safe_m12.test.sql`, que es una prueba del tester: dos casos pasaron de `.5`/`.9999` a `.4`. CLAUDE.md §1 dice que el desarrollador nunca toca pruebas del tester para hacerlas pasar. El cambio es técnicamente correcto, porque la semántica cambió a propósito, pero lo debe ratificar o rehacer el tester.
- **H-ARQ-M14-03 (Baja, desarrollador).** El comentario de cabecera de `engine/numeric.js` dice que la BD rechaza "todo valor con |v| >= 2^53". Ahora rechaza |v| ≥ 2^53 − 0,5, que es lo mismo después de `JSON.parse`. Conviene ajustar el comentario. No cambia ninguna función.
- **H-ARQ-M14-04 (Baja, documentador).** `docs/modelo-datos.md:44` todavía describe la diferencia BD/motor de H-ARQ-M13-01 como vigente. Hay que actualizarlo a "cerrada por M-14".
- **H-ARQ-M14-05 (salud CI, observación).** En `ccaaa08`, `e2e (Playwright)` falló en la rama `item/M-14` y pasó en `main` con el mismo SHA. Es posible que sea intermitente. Si se repite, propongo un ítem para identificar la prueba e2e inestable.
