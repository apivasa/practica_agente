# F-05 — Informe QA
Veredicto: VERDE (condicionado a que `e2e/qa-f05.spec.js` pase en CI)

Rama `item/F-05`, commit revisado `a20da12`.

## Criterio de aceptación
"Prueba e2e (Playwright) entra con cada rol de seed y llega a su vista": **cumplido**.
- `kpi_manager` -> `#/gestora`, `custodian` -> `#/custodio`, `committee` -> `#/comite`, `unit_leader` -> `#/lider`: cubiertos en `e2e/login.spec.js` y pasaron en CI (12/12, sin saltos; el test de signup corrió con Supabase local).
- QA amplía a los 7 usuarios del seed (custodio2 con 3 indicadores, lider2, lider3) y verifica el alcance mostrado ("Indicadores a tu cargo: 3.").

## Pruebas añadidas
- `tests/front/qa-f05.test.js`: 11 casos unitarios (pasan localmente, 23/23 en `tests/front/`; 711/711 en la suite completa).
  Cubren: sin sesión con roles no da acceso; cuatro roles -> menú; las 6 combinaciones de pares de roles; `#/inicio` con un solo rol redirige; custodio con varias filas = un rol; hashes inválidos o maliciosos (`#//gestora`, `#/gestora/../lider`, `#javascript:...`, `#/gestora%2f`); roles nulos o desconocidos mezclados; router con hash vacío, normalización de query y mayúsculas, `hashchange` manual, y sin roles siempre `#/sin-rol`.
- `e2e/qa-f05.spec.js`: 14 casos (5 usuarios del seed + 9 de comportamiento).
  Cubren: sesión persistente al recargar; logout y recarga no recuperan la sesión; con sesión, `#/login`, `#/no-existe`, `#/inicio`, `#/sin-rol`, `#/COMITE/` llevan a la vista propia; carga en frío de ruta ajena; ruta inválida sin sesión -> login; campos vacíos sin llamada a Auth; **varios roles** -> menú `#/inicio`, entrar a cada rol, "Cambiar de rol" y ruta ajena vuelve al menú; **sin roles** -> `#/sin-rol` en todas las rutas; error al cargar roles (500) -> alerta genérica.
  El seed no tiene usuarios con varios roles ni sin rol, y no se crearon: esos casos inician sesión real con un usuario del seed e interceptan solo la respuesta de `/rest/v1/user_roles` con `page.route`.

## Resultado CI
Run 44606117086 (CI, `item/F-05`, sha `a20da12`): **success**. https://github.com/apivasa/practica_agente/actions/runs/44606117086
- build (lint, unit, build): 700/700 unitarias, cobertura 100 % de `route-logic.js` y `router.js`.
- db (pgTAP): success.
- e2e (Playwright): 12 passed.
Los archivos QA no tienen commit (así lo indicó el orquestador), así que CI todavía no ha corrido `e2e/qa-f05.spec.js`. Aquí no hay navegadores ni `node_modules`. Solo se comprobó la sintaxis (`node --check`).

## Cobertura engine/
100 % de líneas, ramas y funciones (suite completa, local). F-05 no toca `engine/`.

## Hallazgos
- **H-QA-F05-01 (baja, pendiente de verificar):** las e2e nuevas no se han corrido todavía. Para reproducir, haz commit en `item/F-05` y revisa el job `e2e (Playwright)`. Si alguna falla, es un hallazgo de la app y no algo que se corrige en la prueba.
- **H-QA-F05-02 (informativa):** el seed no tiene ningún usuario con varios roles ni ninguno sin rol. Por eso el menú de elección y `#/sin-rol` solo se prueban con respuestas simuladas de `user_roles`, no de punta a punta con la RLS real. Conviene añadir esos usuarios ficticios al seed en un ítem del desarrollador.
- Ningún defecto funcional encontrado en `route-logic.js` ni en `router.js`.
