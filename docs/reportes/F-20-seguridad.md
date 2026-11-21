# F-20 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. El cambio es lógica de `scripts/health/lib.js` (`requiredStepProblem`). Ahora exige que `candidate.id` sea un entero seguro y que cada job tenga un `run_id` entero seguro igual a ese id. También exige que todas las apariciones del paso requerido terminen en `success`, y al menos una. No hay endpoints, permisos, secretos, workflows ni dependencias nuevos. El modelo de amenazas no cambia.

Pruebas de seguridad añadidas: `tests/security/health-workflow-f20.test.js`, 126 casos, todos de la categoría 5 (automatizaciones), × las 3 reglas con `requiredStep` (`ritmo-diario`, `evaluacion-mensual`, `correo-alertas`):
- Control positivo: jobs del candidato con el paso en success dan `ok`.
- `run_id` hostil en un job, aunque otro job sea correcto, da `fail`. Variantes: texto `"101"`, decimal, NaN, Infinity, null, ausente, booleano, array, objeto con `valueOf`, BigInt, entero mayor que 2^53 y otro run. `candidate.id` y `run_id` ambos como texto `"101"` también dan `fail`.
- Prototype pollution: un JSON con `__proto__: { run_id, steps }` no aporta propiedades heredadas, da `fail` y no contamina `Object.prototype`. Entradas null o primitivas en `jobs` dan `fail`, igual que un `jobs` que no es lista.
- Nombres de paso con salto de línea, NUL, espacio final, carácter de ancho cero, otras mayúsculas o prefijo `::error::` no cuentan como el paso requerido: `fail`. Lo mismo con `steps` como objeto, texto, null o con entradas basura. Un job auxiliar sin el paso no invalida el resultado, pero sin ninguna aparición sale `fail`.
- `conclusion` hostil en una aparición, aunque otra sea success, da `fail`. Variantes: null, ausente, `SUCCESS`, `" success"`, `"success\n"`, booleano, objeto con `toString`, array, failure, cancelled, neutral y skipped en una pata de la matriz.
- Una `conclusion` que no se puede convertir a texto (`{"toString":1,"valueOf":1}` desde JSON) hace que `String()` lance. `checkWorkflows` captura la excepción y el check sale `fail`, nunca `ok`.
- Mensajes: el detalle no incluye campos ajenos del job (token o cabeceras con `ghs_`).

En local, `node --test tests/security/health-workflow-f20.test.js` da 126 de 126.

Resultados del pipeline:
- Commit 9ea6aa1: Seguridad en curso en el momento del informe, https://github.com/apivasa/practica_agente/actions/runs/44921685351. CI dio `failure`, https://github.com/apivasa/practica_agente/actions/runs/44921685325. Fallan las 12 pruebas de `tests/scripts` con datos de prueba sin `run_id`, que QA está ajustando. Ninguna es de `tests/security/`.
- Commit 0538f38 (QA): CI https://github.com/apivasa/practica_agente/actions/runs/44921912248 y Seguridad https://github.com/apivasa/practica_agente/actions/runs/44921912245, los dos en curso.

gitleaks, semgrep, npm audit y ZAP corren en `seguridad.yml`, porque gitleaks y semgrep no están disponibles en la sesión. La revisión manual del diff no encontró `sb_secret_`, `sb_publishable_`, `ghp_`, `ghs_`, `github_pat_`, JWT ni claves privadas. El diff no toca dependencias ni el front.

Hallazgos:
- **H-F20-01 · Baja · 5 · inyección de comandos de workflow.** Afecta a `scripts/health/lib.js` (`requiredStepProblem`: `String(s.conclusion)` en el mensaje) y a `scripts/health/check.js` (`log` de `${tag} ${r.check}: ${r.detail}`). El mismo patrón ya existía con `candidate.conclusion` y `html_url` en `assessWorkflow`. Los valores de la API se interpolan sin quitar saltos de línea. Una `conclusion` igual a `"failure\n::stop-commands::x"` genera en el log del job una línea que empieza por `::`, y Actions la interpreta como comando (`::add-mask::`, `::stop-commands::` o un `::error::` falso). `set-env` y `add-path` ya están deshabilitados por GitHub.
  - Reproducción: `assessWorkflow(ritmo-diario, { runs: [success id 1], jobs: [{ run_id: 1, steps: [{ name: 'Evaluar', conclusion: 'failure\n::stop-commands::x' }] }], productionEnabled: true })` devuelve `status: 'fail'` y un `detail` que contiene `\n::stop-commands::x`.
  - Por qué es Baja: no da un `ok` falso, porque el resultado sigue en `fail`. Además, explotarlo exige controlar la respuesta autenticada de la API de GitHub, donde `conclusion` es un enum.
  - Corrección sugerida: en `check.js`, sanear el detalle antes de `log` y de `GITHUB_STEP_SUMMARY`. Basta con reemplazar `[\r\n\u0000-\u001f\u007f]` por un espacio, o escapar `%`, `\r` y `\n` como hace `@actions/core`. También conviene recortar los valores de la API que se interpolan.
  - Registrado en `docs/seguridad/hallazgos.md` y propuesto como ítem.
- H-F19-01 y H-F19-02 pasan a «Corregido en F-20» en `docs/seguridad/hallazgos.md`.

Verificado sin hallazgos:
- Categoría 5: no hay `ok` falso con tipos raros, `run_id` como texto, jobs u objetos sin `steps`, `__proto__` ni nombres con caracteres de control. Las excepciones son fail-closed: `checkWorkflows` las captura y devuelve `fail`, y `check.js` sale con código 2.
- Categoría 6: no hay secretos ni código peligroso en el diff (sin `eval` ni `exec`).
- Los mensajes solo incluyen el nombre del paso (de la configuración), las conclusiones y `html_url`, nunca el token.
- Las categorías 1–4, 7 y 8 no aplican: el ítem no toca la BD, Auth, entradas de usuario, el front ni datos personales.
