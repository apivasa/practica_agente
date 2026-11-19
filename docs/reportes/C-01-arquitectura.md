# C-01 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: docs/adr/0003-reglas-escalada.md (Aceptado, nuevo)
Salud: el workflow de salud (`salud.yml`) todavía no existe y no hay producción, así que no hay monitoreo que revisar. CI de la rama: aún sin push (lo hará el orquestador). En local, con Node 22, `node --test tests/engine/escalation.test.js` corre 201 pruebas: 201 pasan y 0 fallan. No hay workflows programados aún (`evaluacion-mensual` y `ritmo-diario` no existen).

Hallazgos:
1. **Funciones puras y sin dependencias.** `engine/escalation.js` es ESM, no importa nada, no lee el reloj y no tiene efectos laterales. Valida sus entradas y es determinista. Cumple ADR 0001 y CLAUDE.md §6.
2. **Reglas de escalada según el diseño.**
   - Racha de 1 mes en amarillo o rojo: `restricted`, con `no_new_change`, `no_backlog_additions` y `prioritize_run`.
   - Racha de 2 o más meses que termina en rojo: `frozen`.
   - Q-03 es un flag configurable (`yellowMonth2EscalatesLikeRed`, por defecto false). No está fijado en el código.
3. **Excepciones según el diseño.** Tienen vencimiento (`expiresOn` comparado con `asOf`, día de vencimiento incluido). Las vencidas se devuelven en `expiredExceptions`, de modo que C-02 o C-03 pueden auditar y alertar el vencimiento. El motivo y la visibilidad del comité no son responsabilidad del motor: quedan para C-02 (tabla Excepciones).
4. **Principio de control.** El motor solo usa colores del RUN y no mira actividad de change. Alineado.
5. **Caso vulnerabilidades.** `carryOver` suma al paquete las P0/P1 de los meses 1 y 2 y pasa las del mes 3 al paquete siguiente junto con lo no resuelto. Alineado. Ojo: el ritmo esperado (pendiente / semanas restantes) no está aquí y le corresponde a otro ítem del motor.
6. **Contrato de colores coherente con M-01.** Ambos usan `'green' | 'yellow' | 'red' | 'not_evaluated'`. `unitColor` toma el peor color e ignora `not_evaluated`, lo que concuerda con el mínimo de muestra del modelo genérico.
7. **Sin colisión de archivos con M-01.** `engine/escalation.js` es un archivo nuevo. M-01 trae `engine/index.js`, `color.js`, `indicator.js` y `measure.js`. `engine/package.json` y `tests/engine/package.json` tienen el mismo contenido en las dos ramas (`{"type":"module"}`), así que el conflicto, si aparece, es trivial. **Acción al integrar:** cuando las dos ramas estén en `main`, `engine/index.js` debe reexportar `unitColor`, `quarterOf`, `evaluateEscalation`, `carryOver`, `COLORS` y `RESTRICTIONS` desde `./escalation.js`. Conviene hacerlo en el ítem que fusione en segundo lugar, o en C-02.
8. **Decisiones del orquestador registradas en ADR 0003:** `not_evaluated` corta la racha; `change_start` no levanta `frozen`; `asOf` lo calcula quien llama en America/Guayaquil; Q-03 por defecto false. También quedaron registradas, como revisables, tres interpretaciones derivadas: la racha se cuenta dentro del trimestre calendario; un mes 3 en amarillo tras dos rojos baja a `restricted`; con `scope: 'all'` el nivel pasa a `exception` y el nivel original se puede reconstruir desde `suppressedRestrictions`.
9. **Observación menor, no bloqueante.** Con `scope: 'all'` el resultado ya no trae explícito el nivel subyacente (`restricted` o `frozen`). Si C-02 o las alertas lo necesitan, conviene añadir un campo `baseLevel`. Puede ser un ítem de mejora.
10. **Observación fuera de alcance (para F-01/F-02).** ADR 0001 dice "Pruebas: Vitest", pero F-01/F-02 (`test:unit`), M-01 y C-01 usan `node:test`. No bloquea C-01, que es coherente con el resto del repo. Hay que regularizarlo: ADR 0001 exige un ADR nuevo con decisión del usuario para cambiar ese punto, o el revisor de F-01/F-02 lo trata allí. Se informa al orquestador.
