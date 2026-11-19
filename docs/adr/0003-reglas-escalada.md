# ADR 0003 — Interpretación de las reglas de escalada en el motor

Estado: Aceptado (decisión del orquestador, 2026-11-19; revisable)
Ítem: C-01 (`engine/escalation.js`)

## Contexto
`docs/diseno.md` define los candados (verde, mes 1 en amarillo o rojo, mes 2 en rojo, cierre de trimestre), las excepciones del comité y el caso vulnerabilidades. Algunos casos límite no están escritos en el diseño. El motor necesita una regla para cada uno. Ninguna de estas decisiones cambia una regla confirmada: solo cubren lo que el diseño no dice.

## Decisión
1. **Un mes `not_evaluated` corta la racha igual que un mes verde.** Se reinicia el conteo de meses consecutivos fuera de verde. Es revisable: si el comité prefiere que un mes sin dato mantenga o congele la racha, se cambia en `evaluateEscalation` y en su tabla de verdad.
2. **Una excepción `change_start` en estado congelado (`frozen`) no levanta el congelamiento.** Solo quita `no_new_change` en `restricted`. C-02 la modelará como un inicio puntual autorizado (un change concreto), no como una suspensión del candado. La única excepción que suspende todo es `scope: 'all'`.
3. **La fecha `asOf` la calcula quien llama, en America/Guayaquil.** El motor recibe `'YYYY-MM-DD'` y no lee el reloj, así que sigue siendo puro. Una excepción está vigente si `expiresOn >= asOf` (el día de vencimiento cuenta como vigente).
4. **Q-03: por defecto `yellowMonth2EscalatesLikeRed = false`.** Un mes 2 en amarillo mantiene las restricciones del mes 1 y no congela. Es un flag de configuración, no una regla escrita en el código. Cuando el usuario responda Q-03, solo cambia el valor por defecto o la configuración.

## Interpretaciones derivadas (registradas, revisables)
- **La racha se cuenta dentro del trimestre calendario.** `history` admite como máximo 3 meses de un solo trimestre, así que el primer mes de un trimestre nuevo vuelve a ser "mes 1" aunque el trimestre anterior cerrara en rojo. Esto concuerda con "lo no resuelto se arrastra al paquete siguiente" (lo arrastrado es el pendiente, no el candado). Si el comité quiere que la racha cruce trimestres, hay que cambiar `validateHistory`.
- **Mes 3 en amarillo después de dos meses en rojo** baja de `frozen` a `restricted` (con Q-03 en false), porque el nivel depende del color del último mes.
- **Color de la unidad = el peor de sus indicadores evaluados** (`unitColor`). Los `not_evaluated` se ignoran, por ejemplo cuando no se alcanza el mínimo de muestra.

## Consecuencias
- El motor no tiene dependencias y es determinista. El front y las Actions lo usan sin duplicar lógica.
- El contrato de colores es el mismo que el de M-01: `'green' | 'yellow' | 'red' | 'not_evaluated'`.
- Al integrar con M-01, `engine/index.js` debe reexportar `engine/escalation.js`.
