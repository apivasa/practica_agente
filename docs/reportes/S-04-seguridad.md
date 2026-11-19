# S-04 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: en S-04 el constructor es seguridad (permiso del orquestador para tocar `index.html`, `vite.config.js` y `src/security/`). Se añade la CSP por `<meta http-equiv>`, que el build inyecta como primer elemento de `<head>` (`src/security/csp.js` y el plugin `csp-meta` de `vite.config.js`). También se añaden `<meta name="referrer" content="no-referrer">` y el script anti-framing `src/security/anti-framing.js`, que es el primer import de `src/main.js`. El job `dast` de `seguridad.yml` levanta Supabase local en el runner y sirve `dist/` en 127.0.0.1:4173. No hay superficie nueva de datos ni de API.

## Controles implementados
- **CSP** (build de producción):
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://oehtspdtpwdhfhhhkgao.supabase.co wss://oehtspdtpwdhfhhhkgao.supabase.co; base-uri 'self'; form-action 'self'; object-src 'none'; manifest-src 'self'; upgrade-insecure-requests`.
  - La política no lleva `unsafe-inline`, `unsafe-eval` ni comodines. `frame-ancestors` no se declara porque en meta se ignora.
  - `http://127.0.0.1:54321` y `ws://` se añaden solo cuando `VITE_SUPABASE_URL` apunta a un origen de bucle local (CI o desarrollo). En ese caso se quita `upgrade-insecure-requests`, que rompería `http://localhost`.
  - Si `VITE_SUPABASE_URL` tiene cualquier otro origen, el build falla: otro proyecto `*.supabase.co`, `http://` del proyecto, sufijos engañosos o IP privadas. Así, una mala configuración no puede mandar la clave publicable ni los tokens a un host ajeno.
  - El plugin tiene `apply: 'build'`, así que `vite dev` no lleva CSP (H-S04-02). `vite preview` y Pages sirven `dist/`, que sí la lleva.
- **Anti-framing:** si `top !== self` (o si leer `top` lanza una excepción), el script vacía y oculta `body` y `html`. Al vaciar `body` desaparece `#app`, y `main.js` no arranca sin `#app`. El riesgo residual está en H-S04-01.
- **SRI:** no hay recursos externos. Todo lo empaqueta Vite bajo `/practica_agente/`, y una prueba lo exige: un recurso externo sin `integrity` hace fallar la prueba.

## Pruebas de seguridad añadidas
- `tests/security/front-s04.test.js`: 22 casos, todos de la categoría 4. Sin `dist/` se omiten 2; en `security-tests`, `SECURITY_REQUIRE_DIST=1` los vuelve obligatorios.
  - La política se comprueba con tres configuraciones: sin URL, con producción y con local. Ninguna lleva `unsafe-*` ni comodines, y `data:` solo aparece en `img-src`. `connect-src` es exacto.
  - El origen de bucle local solo entra si se pide.
  - 8 URL maliciosas hacen fallar el build.
  - La política de referer está en `index.html`.
  - `vite.config.js` inyecta la meta con `head-prepend`, y el anti-framing es el primer import.
  - El anti-framing se prueba con un `window` simulado en tres casos: sin marco, enmarcado y con `top` inaccesible.
  - Sobre `dist/index.html`: hay una sola CSP y es el primer elemento; no hay scripts ni manejadores ni `style` inline; todos los recursos están bajo la base o llevan SRI.
  - Todo `target=_blank` lleva `noopener` (T-FE-08).
- `tests/security/workflows.test.js`: +1 caso (cat. 5).
  - El job `dast` usa la imagen ZAP fijada por digest, levanta Supabase local y no ve la clave secreta.
  - ZAP solo apunta a `127.0.0.1:4173/practica_agente/`, y el job comprueba el código de salida y el riesgo alto.
  - No hay `|| true`, ninguna regla está en `IGNORE` y están las cuatro reglas en `FAIL`.
- `e2e/security/` (Playwright). Corre en `ci.yml` › e2e y en `seguridad.yml` › dast:
  - `csp.spec.js` (7, cat. 4):
    - La meta está presente.
    - Un `<script>` inline inyectado no corre y deja una violación `script-src-elem`.
    - Un `<img onerror>` inyectado como HTML no corre y deja una violación `script-src-attr`.
    - `setTimeout` con cadena queda bloqueado (`eval`).
    - Un script de otro origen queda bloqueado.
    - Un `fetch` de exfiltración a un origen ajeno se bloquea con `connect-src`. Los orígenes ajenos usan `.example` y se abortan además con `page.route`, así que nada sale del runner.
    - La app arranca sin violaciones propias.
  - `framing.spec.js` (3, cat. 4):
    - El atacante (`atacante.example`) enmarca a la víctima (`victima.example`, que es el build local reenviado con `route.fetch`). El marco queda oculto, sin `#app` y sin formulario, tanto en login como en `#/gestora`.
    - Fuera de un marco la app se ve con normalidad.
  - `xss.spec.js` (9, cat. 3):
    - La gestora inserta por la API cinco payloads en `units.name`, `indicators.name`, `indicators.description` y en las claves de `thresholds_by_category`. Los payloads son `<img src=x onerror=…>`, `"><script>…`, `<svg/onload>`, `href=javascript:` y `{{constructor.constructor(…)}}`.
    - Se verifica que la BD guarda los datos intactos.
    - Gestora, comité, custodio y líder recorren sus rutas. En ninguna hay diálogos, marcador `window.__xss`, violaciones de CSP ni nodos inyectados, y si aparece el texto aparece literal.
    - Hay 5 casos de XSS reflejado por hash o por query.
    - Al final se limpian los datos creados.
  - `csv-injection.spec.js` (5 `test.fixme`, cat. 3): fórmulas `=HYPERLINK`, `+cmd|`, `@SUM`, `-2+3+cmd` y `\t=`. Quedan pendientes de M-04 porque la importación CSV no existe en `main` (H-S04-03). No es una omisión silenciosa: está registrada.
- `.zap/rules.tsv` pone en `FAIL` las reglas 10003 (librería JS vulnerable), 10017 (JS de otro dominio), 10062 (PII) y 90003 (falta SRI). El resto queda en `WARN`, y ninguna está en `IGNORE`.

## Resultados del pipeline (rama `item/S-04`)
- Seguridad, run 44610609487 (https://github.com/apivasa/practica_agente/actions/runs/44610609487): pasan gitleaks, semgrep, npm audit, CodeQL (JS y Actions), las pruebas de seguridad, el pentest API y el DAST.
- CI, run 44610609561 (https://github.com/apivasa/practica_agente/actions/runs/44610609561): pasan build, db y e2e. El e2e completo da 43 pruebas, incluidas las de `e2e/security`.
- DAST:
  - e2e de seguridad: 19 pasan y 5 son fixme (CSV).
  - ZAP baseline con `zaproxy/zap-stable@sha256:9624669d…328af`, sobre 9 URL: `FAIL-NEW: 0`, `WARN-NEW: 7`, `PASS: 61`, y 0 alertas de riesgo alto.
  - La regla 10038 (CSP no definida) pasa porque ZAP reconoce la meta.
  - Advertencias medias y bajas, ninguna explotable en este despliegue:
    - 10020 (falta cabecera anti-clickjacking) y 10055 (directiva sin fallback, `frame-ancestors`): Pages no permite cabeceras. Se mitigan con el anti-framing (H-S04-01).
    - 10021 (`X-Content-Type-Options`), 10063 (Permissions-Policy) y 90004 (COOP/COEP/CORP): son cabeceras que `vite preview` no envía. Pages sí envía `nosniff`, y el resto no se puede configurar.
    - 10049 y 10109: informativas.
- La primera versión del job usaba la etiqueta `latest` solo para obtener el digest, que quedó registrado en el log. El commit siguiente fija el digest, y `workflows.test.js` impide volver a usar una etiqueta.

## Hallazgos
- **H-S04-01** · Baja · 4 · GitHub Pages · Clickjacking residual. Pages no permite enviar `frame-ancestors` ni `X-Frame-Options`, que son las que marca ZAP con 10020 y 10055.
  - Reproducción: enmarcar la URL de Pages.
    - Con scripts, el marco queda vacío; lo verifica `framing.spec.js`.
    - Con `sandbox` sin `allow-scripts`, la SPA no arranca y el atacante solo enmarca una página vacía.
  - Aceptado. Si en el futuro hay un proxy o CDN delante, añadir la cabecera.
- **H-S04-02** · Info · 4 · `vite.config.js` · `vite dev` no lleva CSP. Afecta solo al entorno local. Aceptado.
- **H-S04-03** · Info · 3 · CSV · Las pruebas de fórmulas quedan en `test.fixme` hasta M-04.
- H-006: corregido.
- H-F05-01: mitigado. La CSP impide ejecutar código inyectado y exfiltrar con `fetch` a orígenes ajenos. Los tokens siguen en `localStorage` (riesgo residual aceptado).
- H-F05-02 **no se corrige aquí**. `src/views/dom.js` sigue igual en `main` y lo tiene asignado M-02, que está cambiando las vistas en otra rama; tocarlo aquí provocaría conflictos. Se reasigna a M-02. Con la CSP, un `on*` de texto o un `href=javascript:` ya no se ejecutan.

Todo queda registrado en `docs/seguridad/hallazgos.md`. El modelo de amenazas está actualizado: T-FE-02, 04, 05, 06, 07 y 08, y la tabla de cobertura.

Verificado sin hallazgos:
- 4: CSP sin inline ni eval, `connect-src` acotado, sin secretos en `dist/`, sin recursos externos ni SRI pendiente, referer.
- 3: XSS almacenado y reflejado, con cuatro roles.
- 5: job `dast` con permisos `contents: read` heredados, SHA y digest fijados y sin secretos.
- 7: ZAP baseline sin alertas altas.

Las categorías 1, 2, 6 y 8 no cambian en este ítem; el pentest API y gitleaks siguen en verde.
