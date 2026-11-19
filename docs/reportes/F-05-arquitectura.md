# F-05 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0009-front-convenciones.md` (Aceptado). `docs/operacion.md`: nueva base del job e2e.
Salud: CI de `item/F-05` en verde (run 44606117086, commit a20da12). Job e2e 113 s frente a 26–28 s en `main` (run 44605255030); el aumento es `supabase start` (~47 s) y no alarga mucho el camino crítico porque corre en paralelo con `db` (~2 min). Umbral de alerta del e2e subido a > 4 min. Dos fallos previos en la rama (5424b48, 5073438) fueron de puesta a punto de Supabase en el job, no intermitencias. `salud.yml`, `evaluacion-mensual` y `ritmo-diario` aún no existen (fuera del alcance de F-05).

Hallazgos:
1. Compatible con GitHub Pages: `vite.config.js` con `base: '/practica_agente/'`, router por hash con `replaceState` en redirecciones, `playwright.config.js` prueba bajo `/practica_agente/`. Sin servidor propio.
2. Separación correcta: `src/lib/route-logic.js` es puro (sin DOM ni red) y tiene pruebas en `tests/front/`; `router.js` solo lee o escribe el hash; las vistas construyen DOM con `el()` por `textContent`. No hay lógica de negocio del motor duplicada en el front.
3. Sin dependencias nuevas: `package.json` sin cambios (solo `@supabase/supabase-js`, ya previsto).
4. `.env.example` documenta `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`, sin clave secreta. En CI solo se exporta una clave validada con el prefijo `sb_publishable_`.
5. Sirve como base para M-02..V-03, con dos ajustes que se hacen en M-02 (no bloquean ahora; están en ADR 0009): (a) `main.js` elige la vista con `if/else`, así que hay que pasar a un mapa `VIEWS`; (b) `roleForPath` solo admite coincidencia exacta con la ruta de inicio del rol, así que las subrutas (`/gestora/indicadores`) necesitan el registro de rutas declarativo con su rol.
6. Acceso a datos: hoy solo `session.js` llama a `user_roles`. Convención: a partir de M-02, todas las llamadas van por `src/data/<dominio>.js` y la validación de CSV de M-04 va en `engine/`.
7. Aún no hay workflow de despliegue a Pages. Es de esperar: el primer despliegue es una compuerta del usuario (P-02/P-03).
