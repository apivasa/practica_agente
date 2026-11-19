# S-04 — Informe QA

Veredicto: **VERDE**

Rama `item/S-04`, commit `7290486`. Revisé el comportamiento en los runs de CI y de Seguridad de ese commit, por REST.

## Criterio de aceptación (fila S-04)

| Punto | Estado | Evidencia |
|---|---|---|
| ZAP sin alertas altas | Cumplido | Run Seguridad [44612384789](https://github.com/apivasa/practica_agente/actions/runs/44612384789), job `DAST (e2e de seguridad + ZAP baseline)` (135872094142), en `success`. `zap-baseline.py` con la imagen fijada por digest `sha256:9624669d…` terminó con código 0: `FAIL-NEW: 0`, `WARN-NEW: 7`, `PASS: 61`. El paso "Sin alertas de riesgo alto" da 0 alertas con `riskcode >= 3`. Las alertas que quedan son 2 Medium (10020 anti-clickjacking, 10055 CSP sin fallback para `frame-ancestors`), 5 Low (90004 COEP/COOP/CORP, 10063, 10021) y 3 Info (10109, 10049). |
| Payloads XSS escapados en e2e | Cumplido | `e2e/security/xss.spec.js`: 4 casos de XSS almacenado, uno por rol (gestora, comité, custodio, líder), con 5 payloads metidos por la API en unidades e indicadores, y 5 casos de XSS reflejado por URL. Las 9 pruebas pasan. `csp.spec.js` (7 casos) confirma que la CSP bloquea scripts inline, `onerror`, eval por cadena, scripts de otro origen y `fetch` a otro origen. |
| Payloads de fórmula escapados en e2e | Aplazado (aceptado) | `csv-injection.spec.js`: 5 `test.fixme` hasta M-04, porque aún no existe la importación CSV. Están registrados como H-S04-03. |
| Implícito: SRI, sin secretos en `dist/` | Cumplido | En el job `pruebas de seguridad` corren `dist/index.html: CSP como primer elemento…` y `sin scripts inline… sin recursos externos sin SRI`, con 299 pasan y 0 omitidas. gitleaks y la prueba de secretos del front están en verde. |

## La CSP no rompe la app

- El job `e2e (Playwright)` del run CI [44612384715](https://github.com/apivasa/practica_agente/actions/runs/44612384715) (job 135872217291) usa `npm run build` y luego `vite preview`. El plugin `csp-meta` tiene `apply: 'build'`, así que la app que se prueba lleva la CSP. Resultado: 50 pruebas, 45 pasan y 5 se omiten (las fixme de CSV).
- Pasan las 26 pruebas funcionales: `home`, `base-path`, `login` (las 4 vistas de rol, errores genéricos, logout, redirecciones, registro cerrado) y `qa-f05` (persistencia de sesión, multirrol, sin rol, fallo al cargar roles).
- En el job DAST, el build conectado a Supabase local lleva `connect-src 'self' <prod> wss://<prod> http://127.0.0.1:54321 ws://127.0.0.1:54321` y no tiene `unsafe-inline` ni `unsafe-eval`. Las pruebas `xss.spec.js` inician sesión con los 4 roles y comprueban que no hay ninguna violación de CSP, así que el login contra Supabase funciona con la política puesta.
- Anti-framing (`framing.spec.js`, 3 casos): enmarcada desde otro origen, la app se vacía y se oculta, también en una ruta de rol. Fuera de un marco se ve con normalidad.

## Pruebas añadidas

Ninguna. Las pruebas de este ítem las escribió el constructor (seguridad), que es el rol que corresponde en los S-xx. Las revisé contra el criterio:

- `e2e/security/`: 24 casos (19 activos y 5 fixme).
- `tests/security/front-s04.test.js` y `tests/security/workflows.test.js`: unitarias de `buildCsp` y `supabaseOrigins`. Cubren orígenes rechazados (evil, otro proyecto, http a prod, sufijo `.evil.example`, IP privada, `javascript:`, URL inválida), el orden de inyección y el import temprano del anti-framing.

Siguiendo la indicación del orquestador, no hice commit.

## Resultado CI

- CI 44612384715 está en `success` (build, db y e2e).
- Seguridad 44612384789 está en `success` (semgrep, CodeQL, gitleaks, npm audit, tests/security, pentest API y DAST).
- Unitarias: 753 en total, 751 pasan, 0 fallan y 2 se omiten (`dist/` y pentest, que corren en seguridad.yml).

## Cobertura engine/

100 % de líneas, ramas y funciones (color, escalation, index, indicator, measure, vulnerabilities).

## Hallazgos

1. **Baja.** La parte de "texto literal" del XSS almacenado hoy no se ejercita. `assertInert` solo compara el texto si el marcador `s04-<run>-<i>` aparece en pantalla, y las vistas actuales no muestran nombres de unidad ni de indicador. Por eso la prueba hoy demuestra que no se ejecuta nada y que no se crean nodos, pero todavía no demuestra que el texto se escapa y se muestra entero. Para comprobarlo: en el log del job DAST la prueba pasa sin que ningún payload se renderice. Recomendación: cuando M-02 a M-04 muestren esos campos, exigir que el marcador esté presente (que la comprobación deje de ser condicional).
2. **Baja (residual de plataforma, ya registrada como H-S04-01).** ZAP mantiene las alertas Medium 10020 y 10055. GitHub Pages no permite cabeceras, y la mitigación por JS está comprobada en e2e.
3. **Info.** El baseline de ZAP solo rastrea 2 URL de HTML (`/` y `/practica_agente/`) más los assets. Al ser una SPA con rutas por hash y sin sesión, el escaneo pasivo no llega a las vistas de rol. El alcance real del DAST sobre esas vistas lo dan los e2e de seguridad, no ZAP.
4. **Info.** Todavía no hay workflow de despliegue a Pages. La CSP de producción (sin origen local y con `upgrade-insecure-requests`) solo se valida con unitarias y con el `dist/` del job de tests de seguridad, no con un build desplegado.
