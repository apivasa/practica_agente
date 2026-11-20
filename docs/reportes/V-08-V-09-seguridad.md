# V-08-V-09 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: el front recalcula el **candado vigente hoy** (`engine/lock.js#lockToday` → `src/lib/dashboard.js#unitLockToday` → `src/views/dashboard-parts.js#lockTodayInfo`). Lo calcula con las evaluaciones globales guardadas y las excepciones que RLS ya entregaba, y pinta "Inicio autorizado: `change_ref`" en `.unit-lock-today` (líder) y en la columna "Candado hoy" (comité). Además hay un mapa único `SCOPE_LABELS` con `scopeLabel` por lista blanca (V-09). `buildHistory` y `assertHistoryFresh` pasan de `scripts/lib/build.js` a `engine/lock.js` y se reexportan. No hay endpoints, tablas, RPC ni escrituras nuevas. Modelo de amenazas: T-V08-01..04 y T-V09-01 en `docs/seguridad/modelo-amenazas.md`.

Revisado sobre `origin/item/V-08-V-09`. Mis pruebas entraron en `97450c7` y los runs corrieron sobre `b8a75f5`, que suma QA.

## Pruebas de seguridad añadidas
- `tests/security/front-v08-v09.test.js`: 16 casos con node:test y un document falso.
  - Cat. 3/4, XSS: 3 casos. "Inicio autorizado: REF" con 5 payloads sale literal y el árbol queda inerte. Un `lock` manipulado (nivel, restricciones, etiquetas, basis) se pinta como texto. Un `change_ref` que no es texto (objeto, número, arreglo, espacios) da estado inválido.
  - Cat. 1, aislamiento por unidad como defensa en profundidad sobre RLS: 4 casos. Una suspensión total o un inicio puntual de Beta no altera el candado de Alfa, y un `unit_id` con espacios tampoco cuela. Las evaluaciones de otra unidad o por indicador no forman el cierre. Una excepción revocada o vencida no produce "En excepción". Con `unitId` vacío o que no es texto, sale error controlado.
  - Cat. 3, entradas hostiles: 3 casos. Meses `__proto__` y `constructor` no contaminan prototipos. Un color hostil da estado inválido sin reflejar el dato. Entradas que no son arreglo o fechas inválidas no lanzan. Un mes futuro no cuenta como cierre.
  - Cat. 3, V-09: 3 casos. `scopeLabel` con `__proto__`, `constructor`, `toString` o payloads sale literal. `exceptionsTable` no pinta `[object …]` ni funciones. `SCOPE_LABELS` se define en un solo archivo.
  - Cat. 5, solo vista: 3 casos. `lockToday` y `unitLockToday` no aparecen en `scripts/`, `supabase/` ni `.github/`. Los tableros del líder y del comité solo importan funciones `list*` y `markAlertRead`, sin `.insert/.update/.rpc`. No hay sinks HTML (`innerHTML`, `eval`, `new Function`).
- `e2e/security/lock-today-v08.spec.js`: 2 casos con Playwright contra Supabase local. Las filas de `evaluations` y `exceptions` son simuladas con `page.route` y solo se sirven GET, así que no se tocan datos.
  - Líder (`lider1`, Alfa congelada): 4 `change_ref` hostiles salen literales en `.authorized-start`. No hay diálogos, marcador `__xss`, violaciones de CSP ni nodos inyectados. Una suspensión de Beta colada en la respuesta no se muestra y Alfa sigue "Congelada". No hay escrituras REST al pintar.
  - Comité: lo mismo en la columna "Candado hoy". Beta en excepción no se cruza a Alfa.
- El IDOR real con RLS, es decir que el líder no recibe excepciones ni evaluaciones de Beta o Gamma por `eq`, `or=`, `neq` o embebidos, ya lo cubre `e2e/security/dashboards-v01-v03.spec.js` › IDOR. Corre en este pipeline y pasa: las lecturas que usa V-08 son las mismas.

## Resultados del pipeline (head `b8a75f5`)
- Seguridad, [run 44695018202](https://github.com/apivasa/practica_agente/actions/runs/44695018202): **verde**. gitleaks (historial completo), semgrep, npm audit `--omit=dev`, CodeQL (JS y Actions), `tests/security` con los 2 suites nuevos en `ok`, pentest API (PostgREST/Auth) y DAST (35 e2e de seguridad pasados, incluidos los 2 de `lock-today-v08.spec.js`, más ZAP baseline). S-05 fase A/B: omitidas por diseño (solo bajo demanda).
- CI, [run 44695018203](https://github.com/apivasa/practica_agente/actions/runs/44695018203): **verde**.
- Localmente: `node --test 'tests/security/*.test.js'`, 558 casos en verde.

## Hallazgos
Ninguno de severidad crítica, alta, media ni baja.

Nota informativa, sin hallazgo: el candado de hoy solo existe en el navegador. Alguien que manipule sus propias respuestas (DevTools) puede verse "En excepción" en su pantalla, pero no consigue ningún efecto en el servidor. Ninguna Action ni función SQL consume ese cálculo. El candado oficial lo escribe la evaluación mensual con la clave secreta y queda en auditoría. Lo fija la prueba de "solo vista".

## Verificado sin hallazgos
- 1 (autorización/RLS/IDOR): no hay lecturas nuevas. La RLS de `exceptions` y `evaluations` por unidad sigue cubierta y pasa. Además, el motor filtra por `unit_id` exacto.
- 3 (inyección y entradas): todo pasa por `el()`/`textContent`. Hay lista blanca de colores y alcances, `Object.create(null)`, regex de mes y `try/catch` con mensaje fijo.
- 4 (front estático): la CSP no registra violaciones con payloads y no hay sinks HTML nuevos.
- 5 (Actions): `scripts/` solo reexporta `buildHistory`/`assertHistoryFresh` sin cambiar su lógica. El único cambio es `Object.hasOwn` en lugar de `??`, y `scripts/lib/run.js` solo asigna meses con evaluación existente. Ningún workflow se modifica.
- 6 (cadena de suministro): no hay dependencias nuevas. gitleaks, semgrep, CodeQL y npm audit están en verde.
- 2, 7 y 8: sin cambios en Auth, en la superficie DAST ni en datos personales o auditoría. La regresión completa está en verde.
