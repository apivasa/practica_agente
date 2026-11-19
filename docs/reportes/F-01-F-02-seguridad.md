# F-01+F-02 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: estructura del repo (front Vite estático, carpeta `supabase/`), `.env.example`, dependencias npm y lockfile, workflows `ci.yml` (lint, unit, build, pgTAP, e2e) y `lockfile.yml` (genera y sube `package-lock.json` con `contents: write`). Sin tablas, sin Auth, sin llamadas a Supabase todavía.
Pruebas de seguridad añadidas: ninguna en este ítem (no hay tablas, RLS ni rutas). La batería automatizada (gitleaks, semgrep, npm audit, verificación de RLS en toda tabla, ZAP baseline) llega con `seguridad.yml` en S-01. Revisión manual del diff completo (`git diff main...HEAD`, 19 archivos).
Resultados del pipeline: no hay `seguridad.yml` aún (S-01). No se pudieron consultar runs ni SHA de acciones: la API de GitHub devuelve 403 en esta sesión. gitleaks · semgrep · npm audit · ZAP · pentest RLS/API: pendientes de S-01.

## Hallazgos
Ninguno alto ni crítico. Medios y bajos registrados en `docs/seguridad/hallazgos.md`:

- **H-001 · Media · 5 Actions** · `ci.yml` y `lockfile.yml`, todas las líneas `uses:` · Acciones fijadas por etiqueta móvil (`@v4`, `@v1`), no por SHA. Reproducir: revisar `uses:`. Corrección: fijar por SHA completo con comentario de versión y Dependabot para `github-actions` (S-01). No se obtuvieron los SHA por el 403 de la API.
- **H-002 · Baja · 5** · `ci.yml` job `db` · `supabase/setup-cli` con `version: latest`. Corrección: fijar versión.
- **H-003 · Baja · 5** · `lockfile.yml` `on.push` · Corre con `contents: write` + `actions: write` en push a cualquier rama, incluida `main`. Corrección: limitar a `item/**` y `fix/**`; permisos a nivel de job.
- **H-004 · Baja · 6** · `ci.yml` pasos «Instalar dependencias» · `npm ci` ejecuta scripts de instalación (hoy solo `esbuild` y `fsevents`, legítimos). Corrección: `npm ci --ignore-scripts` (+ `npm rebuild esbuild` si hace falta).
- **H-005 · Baja · 5** · `actions/checkout` sin `persist-credentials: false` en `ci.yml`.
- **H-006 · Media · 4** · `index.html` sin CSP ni anti-framing (esperado; se aborda en S-04).

## Verificado sin hallazgos
- **Secretos (1/6):** el diff no contiene `sb_secret_`, claves `sb_publishable_` reales, JWT (`eyJ...`), tokens de GitHub, claves AWS ni claves privadas. `.env.example` solo declara `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` vacías y advierte contra la clave secreta. Sin claves legadas `anon` / `service_role`. `.gitignore` cubre `.env`, `.env.*` (con excepción de `.env.example`), `dist/`, `supabase/.temp/` y `.branches/`.
- **Datos personales (8):** `supabase/seed.sql` vacío salvo comentario de datos ficticios.
- **Actions (5):** `permissions:` explícitos en ambos workflows (`ci.yml`: `contents: read`). No hay `pull_request_target`. `lockfile.yml` no es abusable desde forks: solo se dispara por `push` (que solo ocurre en ramas de este repo, con acceso de escritura) y `workflow_dispatch` (requiere escritura); los PR de forks solo disparan `ci.yml` con token de solo lectura y sin secretos. `lockfile.yml` usa `npm install --package-lock-only --ignore-scripts` (no ejecuta código de paquetes con el token de escritura). `GITHUB_REF_NAME` se usa vía variable de entorno entre comillas (sin inyección de expresiones `${{ }}` en `run:`). No se imprimen secretos; el único token es `github.token`.
- **Dependencias (6):** directas legítimas (`@supabase/supabase-js`, `vite`, `eslint`, `@eslint/js`, `globals`, `@playwright/test`). Lockfile v3 con 162 entradas, todas resueltas desde `https://registry.npmjs.org/`; nombres transitivos revisados sin typosquatting aparente. `npm audit` real queda para S-01.
- **Front estático (4):** `vite.config.js` con `base: '/practica_agente/'` correcto para Pages, sin `define` que inyecte variables sensibles. `index.html` carga solo `/src/main.js` local (sin CDN, SRI no aplica). `src/main.js` usa `textContent` (sin `innerHTML`). Sin enlaces externos.
- **Autorización/RLS (1) y Auth (2), Inyección (3), DAST (7):** no aplican aún (sin tablas, sin Auth, sin formularios).

## Propuesta de CSP para S-04 (no implementada)
Meta en `<head>` antes de cualquier script; `<ref>` es el proyecto Supabase de este repo (P-02):

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; base-uri 'self'; form-action 'self'; object-src 'none'; manifest-src 'self'; upgrade-insecure-requests">
<meta name="referrer" content="strict-origin-when-cross-origin">
```

- Sin `unsafe-inline` ni `unsafe-eval`. En CI/e2e con Supabase local, añadir `http://127.0.0.1:54321` a `connect-src` solo en el build de prueba (vía plugin de Vite según modo), nunca en el de producción.
- `frame-ancestors`, `report-uri` y `sandbox` se ignoran en meta: riesgo residual de clickjacking. Mitigación: script anti-framing en módulo propio (`if (window.top !== window.self) { window.top.location = window.self.location; }` y ocultar el `body` hasta comprobarlo) cargado desde `'self'`.
- Prueba en S-04: `tests/security/` verifica sobre `dist/index.html` la presencia de la meta, ausencia de `unsafe-inline` en `script-src`, ausencia de `<script>` externos sin `integrity`, y escaneo de `dist/` por `sb_secret_` y JWT.
