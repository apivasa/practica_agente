# ADR 0009 — Convenciones del front (rutas, vistas y acceso a datos)

Estado: Aceptado (decisión técnica, 2026-11-19, ítem F-05; no contradice el diseño)

## Contexto
F-05 deja la base del front: Vite con `base: '/practica_agente/'`, router por hash (GitHub Pages no reescribe rutas), cliente Supabase con clave publicable, sesión y una pantalla de inicio por rol. Los próximos ítems de UI (M-02, M-03, M-04, C-02, V-01, V-02, V-03) agregan pantallas por rol. Sin convenciones, cada uno extendería a su manera la cadena `if/else` de `main.js` y llamaría a `supabase.from()` desde cualquier lado.

## Decisión
1. **Sin framework ni dependencias nuevas de UI.** DOM con `el()` (`src/views/dom.js`), siempre por `textContent`; prohibido `innerHTML` con datos. Una dependencia nueva de front requiere ADR.
2. **Capas y carpetas:**
   - `engine/`: cálculo de negocio puro (colores, ritmo, escalada, validación de mediciones y de CSV de M-04). Lo usan front y Actions; no se duplica en `src/`.
   - `src/lib/`: lógica pura propia del front (rutas, formateo) sin DOM ni red, probada con `node:test` en `tests/front/`. Más el cliente (`supabase.js`) y la sesión.
   - `src/data/<dominio>.js` (nuevo, a crear con M-02): **único lugar** que llama a `getSupabase().from(...)`/`.rpc(...)`. Funciones async que devuelven datos planos o lanzan `Error` con mensaje en español apto para mostrar; nunca exponen el error crudo de PostgREST. El filtrado por permisos lo hace RLS; el front solo filtra por usabilidad. `getRoles` puede quedarse en `session.js` o moverse a `src/data/roles.js`.
   - `src/views/<rol>/<pantalla>.js`: una vista por pantalla, exporta `render<Nombre>(ctx)` que devuelve un nodo. Recibe datos y callbacks; no lee `window.location` ni importa el cliente Supabase directamente (usa `src/data/`).
3. **Registro de rutas:** las rutas se declaran como datos en `src/lib/route-logic.js` (o un `src/lib/routes.js` puro), no en `main.js`:
   `{ path: '/gestora/indicadores', role: 'kpi_manager', view: 'kpi-list', label: '...' }`.
   La guarda (`resolveRoute`) autoriza una ruta si el usuario tiene su `role`; la ruta de inicio de cada rol sigue en `ROLE_ROUTES`. Rutas en español, bajo el prefijo del rol (`/gestora/...`, `/custodio/...`, `/comite/...`, `/lider/...`). Parámetros por query del hash (`#/custodio/mediciones?indicador=<uuid>`), que `parseHash` ya descarta para la decisión de ruta y la vista lee aparte con una función pura.
   `main.js` mapea `view -> render` con un objeto (`VIEWS[view](ctx)`), no con `if/else`, en el primer ítem que agregue una pantalla (M-02).
4. **Navegación entre pantallas del mismo rol:** cada vista de rol se monta dentro de la pantalla de inicio del rol (menú con enlaces del registro filtrados por rol).
5. **Configuración:** solo variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (documentadas en `.env.example`). Toda variable `VITE_*` nueva se documenta ahí y jamás contiene una clave `sb_secret_`.
6. **Pruebas:** lógica pura en `tests/front/*.test.js`; cada pantalla nueva con e2e en `e2e/` contra Supabase local y usuarios ficticios de `supabase/seed.sql`.

## Consecuencias
- M-02..V-03 agregan archivos sin tocar la estructura: una entrada en el registro de rutas, un módulo en `src/data/`, una vista en `src/views/<rol>/`.
- `resolveRoute` debe pasar de coincidencia exacta (`roleForPath`) a buscar en el registro; cambio pequeño y cubierto por `tests/front/router.test.js`, a hacer en M-02.
- El job e2e depende de Supabase local (~47 s extra por run); ver `docs/operacion.md`.
