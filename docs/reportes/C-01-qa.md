# C-01 — Informe QA

Veredicto: **VERDE**

Rama: `item/C-01` (commit `4594421`). Revisado contra `docs/diseno.md` (Reglas de escalada, Excepciones, Caso: vulnerabilidades), la fila C-01 de `docs/plan-maestro.md` y Q-03 de `docs/pendientes-usuario.md`. Las pruebas se diseñaron antes de leer el código.

## Criterio de aceptación

| Punto | Estado |
|---|---|
| Verde → operación normal | Cumplido |
| Mes 1 amarillo/rojo → no change nuevo ni backlog, sin congelar | Cumplido |
| Mes 2 rojo → se frena todo el change y toda la capacidad va al RUN | Cumplido |
| Volver a verde reinicia la racha | Cumplido (`not_evaluated` también corta, según decisión del orquestador) |
| Regla "amarillo en mes 2" configurable, por defecto = mes 1 (Q-03) | Cumplido (`yellowMonth2EscalatesLikeRed`, por defecto `false`) |
| Cierre de trimestre → arrastre (2.000 → 2.200; P0/P1 del mes 3 al paquete siguiente) | Cumplido (`carryOver`) |
| Tabla de verdad completa en pruebas | Cumplido: 85 secuencias (0 a 3 meses × 4 colores) × 2 valores del flag, comparadas con un modelo de referencia escrito desde el diseño |
| Historial guardado en Evaluaciones | Fuera de alcance de C-01 por decisión del orquestador; se cubre en C-03 |

## Pruebas añadidas

- `tests/engine/qa-c01.test.js`: **38 casos** en 9 suites (node:test + node:assert/strict). Cubren verde, mes 1, mes 2, reinicio, Q-03, tabla de verdad, excepciones (vigente, vence el mismo día, vencida el día anterior, fin de mes contra el día 1, mezcla, fecha o alcance inválidos, `asOf` obligatorio), arrastre (ejemplo del diseño, mes 3, todo resuelto, sobre-resolución, entradas inválidas), límite de trimestre y color de la unidad.

## Resultado

`node --test --experimental-test-coverage --test-coverage-exclude='tests/**' 'tests/engine/*.test.js'` (local):
239 pruebas, 239 pasan, 0 fallan (38 son de QA y 201 del desarrollador).

CI: la rama aún no tiene workflows (`.github/workflows/` llega con F-02), así que no hay run de CI que revisar. La validación es local.

## Cobertura engine/

- Suite completa: `engine/escalation.js` con **100 % de líneas**, 100 % de ramas y 100 % de funciones.
- Solo con las pruebas QA: 100 % de líneas y 93 % de ramas.

## Hallazgos

Ninguno bloqueante.

1. **Baja · interpretación.** La racha se cuenta dentro del trimestre: `history` no admite meses de dos trimestres (lanza `RangeError`). Si una unidad está en rojo en marzo y en abril, abril cuenta como "mes 1" y no congela. El diseño no dice si la escalada se reinicia al cambiar de trimestre. Conviene confirmarlo o dejarlo escrito en `docs/diseno.md`. Para reproducir: `evaluateEscalation([{month:'2026-04',color:'red'}], {asOf:'2026-04-05'})` → `restricted`.
2. **Baja.** El `id` de las excepciones no se valida. Una excepción sin `id` aparece como `undefined` en `appliedExceptions` o `expiredExceptions`, y eso afectaría a la auditoría (C-02/C-03). Para reproducir: `activeExceptions:[{scope:'all',expiresOn:'2026-01-01'}]` → `expiredExceptions: [undefined]`.
3. **Informativo.** El vencimiento se decide comparando las cadenas `YYYY-MM-DD`. El motor no convierte zonas horarias, así que quien lo llame (C-03, front) debe calcular `asOf` en America/Guayaquil. Una prueba de C-03 debería verificarlo.
