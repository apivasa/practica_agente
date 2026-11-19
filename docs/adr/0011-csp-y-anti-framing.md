# ADR 0011 — CSP por meta en build y anti-framing por JavaScript

Estado: Aceptado (decisión técnica, 2026-11-19, ítem S-04; no contradice el diseño)

## Contexto
GitHub Pages (ADR 0001) no permite cabeceras HTTP propias: no hay `Content-Security-Policy`, `X-Frame-Options` ni `frame-ancestors` por cabecera. El front necesita CSP y protección contra clickjacking (H-006).

## Decisión
1. **CSP como `<meta http-equiv>` inyectada en el build** por un plugin local de `vite.config.js` (`csp-meta`, `apply: 'build'`, primer elemento de `<head>`). Sin dependencias nuevas. La política la arma `src/security/csp.js` (funciones puras, probadas con `node:test`): `default-src 'none'`, `script-src`/`style-src 'self'` sin `unsafe-*`, `connect-src` limitado a `'self'` y al proyecto Supabase.
2. **Lista de orígenes de Supabase cerrada:** solo `PRODUCTION_SUPABASE_ORIGIN` (ref del proyecto de P-02) y, si `VITE_SUPABASE_URL` es loopback http, ese origen local (CI y desarrollo). Cualquier otro origen **hace fallar el build**: evita publicar un front que envíe tokens a un host ajeno por error de configuración. El ref es configuración de infraestructura pública (no un secreto ni un KPI); cambiar de proyecto Supabase exige editar la constante en un PR revisado por seguridad.
3. **Anti-framing por JavaScript** (`src/security/anti-framing.js`), primer import de `src/main.js`: si `top !== self` vacía y oculta el documento y la app no arranca.
4. **Sin CSP en `vite dev`** (HMR usa estilos inline). Las pruebas y ZAP corren sobre `dist/`.

## Consecuencias
- V-05 (`deploy.yml`) construye con `VITE_SUPABASE_URL` = secreto `SUPABASE_URL`: coincide con la constante y el build pasa. `deploy.yml` debe comprobar sobre `dist/index.html` que la CSP no contiene orígenes loopback y sí `upgrade-insecure-requests`.
- Riesgos aceptados: clickjacking residual con iframe `sandbox` sin scripts (la app no arranca: página vacía) y CSP ausente en dev (H-S04-01/02). Si algún día hay CDN o proxy delante, mover `frame-ancestors 'none'` y la CSP a cabeceras.
- Directivas no aplicables por meta (`frame-ancestors`, `report-uri`, `sandbox`) no se declaran.
