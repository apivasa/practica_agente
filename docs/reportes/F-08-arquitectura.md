# F-08 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (solo cambian pruebas; ADR 0007, pipeline de seguridad, sin cambios)
Salud: CI run 44683642632 y Seguridad run 44683642468 en `73c95bd`, los dos en verde, incluidos `CodeQL (javascript-typescript)` y `CodeQL (actions)`. No pude listar las alertas de code scanning por REST (`403 Resource not accessible by integration` con el token de la sesión). Que se cierren las 4 alertas altas de `main` se confirma con el check «CodeQL» del PR y con el análisis de `main` después del merge. Workflows programados: no los toca.
Hallazgos:

1. **Alcance (correcto).** Solo cambian `tests/scripts/health.test.js`, `tests/scripts/qa-v04.test.js` y `tests/workflows/deploy.test.js`. No hay código de la app, ni de `scripts/health/`, ni de `salud.yml`. La lógica de salud (ADR 0014) no se toca.
2. **Comparación por origen (correcto).** `isSupabase` compara `new URL(u).origin` con el origen exacto, en lugar de `startsWith` o `includes`. Eso elimina el patrón «incomplete URL substring sanitization» que marcaba CodeQL. En `deploy.test.js` se parsean las URL del script y se comparan `origin` y `pathname` exactos contra la `base` de Vite, lo cual es más estricto que lo anterior. Además, `assert.doesNotMatch(r.detail, /https?:\/\/|apivasa\.github\.io/)` refuerza que el detalle de la alerta no filtre la URL.
3. **Compatibilidad.** `URL.canParse` existe desde Node 19.9 y 18.17. CI usa Node 22 y `engines` pide ≥ 20: no hay riesgo.
4. **(Menor, no bloquea.)** `isSupabase` está definida igual en dos archivos de prueba. Es duplicación en pruebas, no lógica de la app, así que no aplica la regla de `engine/`. Si aparece un tercer uso, conviene moverla a un helper en `tests/`.
5. **Regla nueva del plan («no fusionar con el check CodeQL en rojo»):** el orquestador debe revisar el check «CodeQL» del PR, no solo los jobs del workflow `Seguridad`, antes del merge.
