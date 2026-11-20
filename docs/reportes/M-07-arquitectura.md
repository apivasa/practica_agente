# M-07 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (cabe en ADR 0006, 0009, 0013 y 0016 punto 5; `docs/operacion.md` actualizado)
Salud: CI run 44684309039 en `741c8e9` en **rojo**: `build` falla en `tests/front/routes-registry.test.js:26` («subrutas de M-02, M-03 y M-04»), que fija la lista exacta de subrutas de la gestora y no incluye `/gestora/metas`. Es una prueba del tester desactualizada, no un defecto de la app. e2e quedó `skipped` por la dependencia. Seguridad run 44684309005 en verde. Workflows programados: sin cambios.
Hallazgos:

1. **(Bloquea el merge, lo corrige el tester.)** Hay que añadir `'/gestora/metas'` al valor esperado en `tests/front/routes-registry.test.js`. El desarrollador no puede tocar esa prueba (CLAUDE.md §1). Hasta que el tester la actualice, CI sigue en rojo y el e2e `e2e/m07-targets.spec.js` no corre, así que su criterio («pasa de Sin evaluar a color al cargar la meta») aún no está validado en CI.
2. **Lógica en `engine/`, sin duplicar (correcto).** `toEngineMeasurements` y `evaluateIndicatorMonth` se movieron sin cambios de `scripts/lib/build.js` a `engine/rows.js`. `build.js` las reexporta por compatibilidad, como ya se hizo en V-01. `cumulativeThirds` pasa a ser la única fuente de la regla del tercio: la usan `packageStatus.monthlyTargets` y `proposeThirdTarget`. `src/lib/targets-form.js` y la vista solo validan el formulario y arman filas. La regla del tercio no aparece en ningún otro lugar fuera del motor. Aparte, y anterior a este ítem, `src/lib/dashboard.js:233` calcula el trimestre a mano en lugar de usar `quarterOf` del motor. No bloquea, pero conviene limpiarlo en un ítem futuro.
3. **Modelo genérico (correcto).** La pantalla elige los indicadores con `usesMonthlyTargets`: meta acumulada sin categorías, la misma regla que `hasCategoryEvaluation` y ADR 0016 punto 5. No hay ningún código de KPI quemado.
4. **Stack y RLS (correcto).** La escritura va por PostgREST con la clave publicable. La autorización es la RLS que ya existe (`targets_insert` / `targets_update`, solo `kpi_manager`). No hay tablas ni columnas nuevas. La lectura (`targets.js`) y la escritura (`target-admin.js`) quedan separadas, y eso deja al líder (V-01) con un módulo de solo lectura.
5. **Operación (resuelto en este informe).** Si se cambia la meta de un mes ya cerrado, la evaluación guardada no se recalcula sola. Lo añadí al runbook en `docs/operacion.md` («Reprocesar un mes»).
6. **(Menor, no bloquea.)** `saveTarget` hace primero un select y después un insert o update, en dos llamadas. Con dos gestoras guardando la misma meta a la vez, la segunda recibe el 23505 ya mapeado («Ya existe una meta…»). Es aceptable para el volumen académico.
7. **Convive con M-08.** Las dos ramas tocan `engine/rows.js` en zonas distintas: `git merge-tree` entre `item/M-07` e `item/M-08` no da conflicto.
