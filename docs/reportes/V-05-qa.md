# V-05 — Informe QA

Veredicto: VERDE (intento 2, commit revisado `73a679e`, rama al revisar `c6db2bf`)

Alcance: revisión estática y de comportamiento de `.github/workflows/deploy.yml`, `docs/despliegue.md` y el cambio de `environment: produccion` en `evaluacion-mensual.yml` y `ritmo-diario.yml`. El criterio final del plan ("primera publicación accesible en la URL de Pages; migraciones aplicadas") **no se puede comprobar todavía**: el primer despliegue a producción es compuerta del usuario (CLAUDE.md §3).

## Criterio de aceptación

| Punto | Estado |
|---|---|
| `deploy.yml` publica `dist/` en GitHub Pages | Cumplido en estructura: build → verificación de dist/ → `upload-pages-artifact` → (migraciones) → `deploy-pages` (environment `github-pages`). Sin ejecución real todavía. |
| Aplica migraciones a Supabase real | Cumplido en estructura: `migrate-plan` (dry-run) → `migrate` (dry-run, `db push`, `migration list`), sin semilla, solo si `SUPABASE_URL` es el origen de producción y el registro de Auth está cerrado. Sin ejecución real todavía. |
| "En cada merge a `main`" | Diferido a propósito (ADR 0015): solo `workflow_dispatch` con confirm=`desplegar`. Ver H-V05-QA-03. |
| Primera publicación accesible en Pages | Pendiente de la compuerta del usuario. `smoke` lo comprobará (HTTP 200, título real y JS principal 200). |
| Migraciones aplicadas | Pendiente de la compuerta del usuario. `supabase migration list` deja la evidencia en el log. |

## Revisión de los cambios del intento 2

| Cambio | Revisión |
|---|---|
| Orden verify → build-pages → migrate-plan → migrate → deploy-pages (needs `[build-pages, migrate]`) → smoke | Correcto. `db push` ya no corre si falla el build o la verificación de `dist/`, y Pages no se publica sin migraciones. |
| verify ya no recibe `SUPABASE_SECRET_KEY` (5 secretos) | Correcto. Ningún job de `deploy.yml` la menciona y `verify` pasa sin ella. |
| Paso "Origen de producción" | Correcto. Cierra H-V05-QA-01: si los secretos apuntan a otro proyecto (aunque ref y URL sean coherentes), falla antes de migrar. Acepta la barra final. Rechaza http, rutas, subdominios, `//` y vacío. Si `csp.js` no declara la constante, falla. |
| Paso "Registro cerrado en Auth" | Correcto. Usa `curl -f` contra `${SUPABASE_URL%/}/auth/v1/settings` con `apikey` publicable. Solo pasa con `disable_signup` = `true`. Falla con `false`, con el campo ausente, con respuesta vacía o no JSON y si curl falla. No imprime la clave. Corre después de la validación de origen, así que nunca envía la clave a un host ajeno. |
| `migrate-plan` separado | Correcto. Solo hace dry-run, nunca `db push`. Cierra H-V05-QA-02 cuando hay revisor en el environment. |
| `supabase migration list` | Correcto, va después de `db push`. |
| smoke exige 200 en el JS principal | Correcto. Si la `base` se rompe (assets 404 o script fuera de `/practica_agente/assets/`), falla tras 6 intentos. |
| `environment: produccion` en los workflows programados | Correcto para H-C03-02, con una consecuencia operativa: ver H-V05-QA-05. |

## Pruebas añadidas

`tests/workflows/deploy.test.js`: **73 casos** (antes 47; 5 actualizados por los cambios pedidos y 26 nuevos). Usa node:test, sin dependencias. Los scripts `run:` de verify (los 3 pasos), `Verificar dist/` y smoke se **ejecutan con bash**. `curl` y `sleep` se sustituyen por stubs en `PATH`, y el chequeo de origen corre sobre una copia de `src/security/csp.js`.

- Disparador: solo `workflow_dispatch`, `confirm` obligatorio y sin default que lo habilite, concurrencia sin cancelar.
- Cadena: orden exacto de los 6 jobs y sus `needs`. `migrate` desciende de verify, build-pages y migrate-plan, y `deploy-pages` de `migrate`. Sin `if: always()` ni `continue-on-error`.
- Permisos: workflow con `contents: read`. `pages: write` e `id-token: write` solo en `deploy-pages`. Los jobs con secretos usan `produccion`.
- Secretos: `SUPABASE_SECRET_KEY` no aparece en `deploy.yml`. verify recibe los 5 secretos. Por cada uno ausente, falla, lo nombra y no filtra los demás. Rechaza la clave legada JWT y una `sb_secret_` cargada como publicable. Comprueba la coherencia entre URL y ref.
- Confirmación y rama: 5 confirm inválidos y 4 refs distintas de main se rechazan.
- Origen de producción (bash): 4 casos (ver la tabla de arriba).
- Registro cerrado en Auth (bash): 8 casos, incluida la URL exacta consultada, la cabecera `apikey`, `-f` y que no haya doble barra.
- migrate-plan y migrate: sin seed, reset, `--debug` ni `config push`. Usan `link` con el ref y `persist-credentials: false`. migrate-plan sin `db push` real. En migrate, el orden es dry-run → push → migration list.
- Programados: `ritmo-diario.yml` y `evaluacion-mensual.yml` declaran `environment: produccion`.
- build-pages y `Verificar dist/` (bash): los mismos 8 casos del intento 1.
- smoke (bash): pasa al primer intento (2 llamadas: HTML y JS). Falla tras 12 llamadas con JS 404, sin script bajo la base, con HTML 404 o con otro título. Sin `page_url`, usa la URL de respaldo. También cubre el título y la base frente a `index.html` y `vite.config.js`.
- docs/despliegue.md: menciona los 6 secretos de P-02, `desplegar`, dry-run, `seed.sql` y la reversión.

Resultado local: 73/73. Suite unitaria completa: 1207/1207.

## Resultado CI

Ver la sección "CI del intento 2" al final del informe.

## Cobertura engine/

99,9 % de líneas (sin cambios; V-05 no toca `engine/`).

## Hallazgos

- **H-V05-QA-01 (Media): cerrado en el intento 2.** `verify` compara `SUPABASE_URL` con `PRODUCTION_SUPABASE_ORIGIN` y además el build va antes de migrar. Lo cubren las pruebas "verify origen (bash)".
- **H-V05-QA-02 (Baja): cerrado.** `migrate-plan` es un job aparte. Con revisor requerido, la aprobación de `migrate` llega con el dry-run ya en el log. Sin revisor, sigue siendo solo un registro, y `docs/despliegue.md` ya lo dice ("Puntos de parada").
- **H-V05-QA-05 (Media, nuevo, no bloquea): el revisor que recomienda la guía frena las evaluaciones programadas.** `docs/despliegue.md` recomienda poner un revisor requerido en el environment `produccion`. Ahora `ritmo-diario.yml` y `evaluacion-mensual.yml` también declaran `produccion`. Si el usuario sigue la recomendación, cada run de `schedule` quedará esperando una aprobación manual. El cálculo diario (candados y alertas de C-03/C-04) dejaría de ser automático: correría tarde o nunca. La lista de jobs con aprobación de "Puntos de parada" no menciona los programados.
  - Reproducir (cuando exista el environment): añadir un revisor a `produccion` y esperar el cron de las 06:23 Guayaquil. El run queda en `waiting`.
  - Ya está registrado por seguridad como H-V05-02 (Baja). QA lo sube a Media porque rompe un comportamiento del diseño (cálculo programado sin intervención) si se sigue la configuración recomendada.
  - Corrección sugerida: un environment aparte con revisor solo para `migrate` (p. ej. `produccion-deploy`), o advertir en la guía que el revisor detiene los cron. No bloquea el merge: el workflow es correcto y hoy no hay revisor configurado, pero debe resolverse antes de que el usuario configure el environment (mismo pendiente que la autorización del primer despliegue).
- **H-V05-QA-06 (Info): `disable_signup` con el texto `"true"` también pasaría.** `jq -r` convierte el texto `"true"` y el booleano `true` en la misma salida. Supabase devuelve un booleano, así que el riesgo es teórico.
- **H-V05-QA-03 (Info): sin cambios.** El disparo es solo manual hasta que se apruebe la primera publicación. Si se activa `push`, habrá que actualizar la comprobación de `confirm` y la prueba "solo workflow_dispatch" de `tests/workflows/deploy.test.js`.
- **H-V05-QA-04 (Info): sin cambios.** El criterio final queda pendiente del primer run manual.

## CI del intento 2

Commit `9ca94c5` (pruebas del intento 2): CI `success` (https://github.com/apivasa/practica_agente/actions/runs/44665883486) y Seguridad `success` (https://github.com/apivasa/practica_agente/actions/runs/44665883409). El CI rojo en `c6db2bf` se esperaba: eran las 5 pruebas del intento 1 que dejó obsoletas el cambio pedido, ya actualizadas.
