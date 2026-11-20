# F-08 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no

**Superficie nueva:** ninguna. Solo cambian pruebas:
- `tests/scripts/health.test.js` y `tests/scripts/qa-v04.test.js`: comparan por `new URL(u).origin`.
- `tests/workflows/deploy.test.js`: parsea las URL del smoke y compara `origin` y `pathname` exactos.

Así se cierran las 4 alertas altas `js/incomplete-url-substring-sanitization` de `main`: `health.test.js:150,256` y `qa-v04.test.js:193,213`.

Revisado sobre `origin/item/F-08` en `3b37a91`.

## Revisión
- **Las 4 líneas señaladas ya no usan subcadena.** Ahora usan `isSupabase(u)`, que compara el origen parseado exacto, y `assert.doesNotMatch(r.detail, /https?:\/\/|apivasa\.github\.io/)`.
- **`deploy.test.js` es más estricto que antes.** El `includes` pasaba con `https://evil/?apivasa.github.io/...`; ahora no.
- **No quedan patrones iguales en el repo** (`src`, `scripts`, `engine`, `tests`, `e2e`). Los dos únicos casos parecidos eran pruebas mías, que buscan texto de una guarda `case` en un script bash (`sh.indexOf('http://127.0.0.1:*|…')`). No validan URLs, pero los pasé a `sh.search(/…/)` para que el detector nuevo no tenga excepciones:
  - `tests/security/engine-m06.test.js:226`
  - `tests/security/workflows.test.js:219`
- **El código de la app no valida URLs por subcadena.** `scripts/health` y `src/security/csp.js` ya comparan por origen; lo cubren `preprod-s05.test.js` y `health.test.js`.
- **Revisé también el código nuevo de M-07, M-08 y F-07:** no introduce el patrón.

## Pruebas de seguridad añadidas
`tests/security/static-url-substring-f08.test.js`, 2 casos de la categoría 6 (SAST de regresión):
- Falla si cualquier JS del repo usa `includes`, `startsWith`, `endsWith` o `indexOf` con un literal `http(s)://`, con un literal con forma de host (`*.io`, `*.co`, …) o con una constante `SUPA`, `PAGES` o `*_URL|ORIGIN|HOST`.
- Un segundo caso comprueba que el detector reconoce las 4 alertas originales y que no da falsos positivos con `endsWith('.sql')`, `startsWith('./')` ni con la comparación por origen.

Así la regresión se para en `security-tests` aunque nadie mire el check de CodeQL.

## Resultados del pipeline (en `3b37a91`)
- **Seguridad**, [run 44686921388](https://github.com/apivasa/practica_agente/actions/runs/44686921388): verde en el intento 2.
  - En el intento 1, DAST falló porque ZAP terminó con código 3, un error interno: `Failed to access summary file`, sin informe. Los 33 e2e de seguridad habían pasado. Lo relancé y pasó. Es un fallo de infraestructura de ZAP, no un hallazgo.
  - `CodeQL (javascript-typescript)` y `CodeQL (actions)` dan success. En `security-tests`, `F-08` da ok 355 y 356 (536 casos, 0 fallos).
- **CI**, [run 44686921361](https://github.com/apivasa/practica_agente/actions/runs/44686921361): verde.
- **Límite de verificación:** el token de la sesión recibe 403 en `code-scanning/alerts` y en `code-scanning/analyses`, así que no pude listar las alertas. El check «CodeQL» de code scanning («No new alerts…» / alertas cerradas) solo aparece en el PR.
  - El orquestador debe comprobar en el PR que ese check está en verde antes del merge.
  - Después del merge, las 4 alertas de `main` deben pasar a *fixed* con el análisis de `main`.

## Hallazgos
Ninguno nuevo. Las 4 alertas CodeQL de `main` quedan corregidas en la rama; falta la confirmación del check del PR.

## Verificado sin hallazgos
- **Cat. 6:** SAST, con CodeQL en verde y la regresión estática.
- **Cat. 5:** los workflows no cambian.
- **No aplica:** cat. 1 a 4, 7 y 8.
