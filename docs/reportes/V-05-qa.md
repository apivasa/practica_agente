# V-05 — Informe QA

Veredicto: VERDE

Alcance: revisión estática y de comportamiento de `.github/workflows/deploy.yml` y `docs/despliegue.md`. El criterio final del plan ("primera publicación accesible en la URL de Pages; migraciones aplicadas") **no se puede comprobar todavía**: el primer despliegue a producción es compuerta del usuario (CLAUDE.md §3). Se verifica todo lo que se puede comprobar antes de ese despliegue.

## Criterio de aceptación

| Punto | Estado |
|---|---|
| `deploy.yml` publica `dist/` en GitHub Pages | Cumplido en estructura: build → verificación de dist/ → `upload-pages-artifact` → `deploy-pages` (environment `github-pages`). Sin ejecución real todavía. |
| Aplica migraciones a Supabase real | Cumplido en estructura: `supabase link` + `db push --dry-run` + `db push`, sin semilla. Sin ejecución real todavía. |
| "En cada merge a `main`" | Diferido a propósito: por ahora solo `workflow_dispatch` con confirm=`desplegar` (compuerta del primer despliegue). El bloque `push` queda comentado y documentado. Ver H-V05-QA-03. |
| Primera publicación accesible en Pages | Pendiente de la compuerta del usuario. El job `smoke` lo comprobará (HTTP 200 + título real de `index.html`). |
| Migraciones aplicadas | Pendiente de la compuerta del usuario. |

## Pruebas añadidas

`tests/workflows/deploy.test.js` — 47 casos (node:test, sin dependencias). Además de leer el YAML, extrae los scripts `run:` de los pasos `verify` y `Verificar dist/` y los **ejecuta con bash** con entradas falsas, para probar comportamiento y no solo texto:

- Disparador: solo `workflow_dispatch`; `confirm` obligatorio y sin default que habilite; concurrencia sin cancelar un despliegue en curso.
- Cadena `needs`: verify → migrate → build-pages → deploy-pages → smoke; ningún `if: always()/failure()` ni `continue-on-error`.
- Permisos: workflow `contents: read`; `pages: write` e `id-token: write` solo en `deploy-pages`; ningún otro job con escritura; los jobs con secretos usan el environment `produccion`.
- verify (bash): pasa con configuración completa sin imprimir valores; rechaza confirm `""`, `Desplegar`, `desplegar `, `si`, `desplegarr`; rechaza ramas `item/V-05`, `mainx`, `refs/tags/main` y vacía; por cada uno de los 6 secretos ausente falla, lo nombra y no filtra los demás; lista los 6 si faltan todos; rechaza claves legadas JWT y claves intercambiadas; rechaza `SUPABASE_URL` que no corresponde al project ref (o con http).
- migrate: sin `--include-seed`, `seed.sql`, `db reset`, `--debug`; el dry-run va en un paso anterior y distinto de `db push`; `link` con project ref y sin la clave secreta ni la publicable.
- build-pages: el build recibe solo URL y clave publicable; orden build → verificar dist/ → upload; `npm ci --ignore-scripts`.
- Verificar dist/ (bash): pasa con un dist correcto (el literal `sb_secret_` de supabase-js no da falso positivo); falla sin meta CSP, con loopback en la CSP, sin `upgrade-insecure-requests`, con una clave `sb_secret_` real y con `127.0.0.1:54321` en dist.
- smoke: `permissions: {}`, sin secretos, usa `needs.deploy-pages.outputs.page_url`; exige HTTP 200 y el mismo `<title>` que `index.html`, con reintentos y `exit 1` final; la URL de respaldo coincide con `base` de `vite.config.js`.
- docs/despliegue.md: menciona `desplegar`, los 6 secretos, dry-run, `seed.sql` y reversión.

Resultado local: 47/47 en verde; suite unitaria completa 1181/1181 en verde.

## Resultado CI

Ver la sección "CI tras el push de QA" al final.

## Cobertura engine/

99,9 % de líneas (todos los archivos al 100 % salvo `commitment.js`, 99,26 %). V-05 no toca `engine/`.

## Hallazgos

- **H-V05-QA-01 (Media) — La URL de producción no se contrasta con el origen de la CSP antes de migrar.** `src/security/csp.js` fija `PRODUCTION_SUPABASE_ORIGIN = https://oehtspdtpwdhfhhhkgao.supabase.co` y el build falla si `VITE_SUPABASE_URL` es otro origen. Pero `verify` solo comprueba que `SUPABASE_URL` corresponda a `SUPABASE_PROJECT_REF`, no que sea ese origen. Si los secretos apuntan a otro proyecto (ref y URL coherentes entre sí), `migrate` **aplica las migraciones en ese otro proyecto** y luego `build-pages` falla: queda un despliegue a medias en una base equivocada. Reproducir: en `verify`, `SUPABASE_PROJECT_REF=otroref` y `SUPABASE_URL=https://otroref.supabase.co` → `verify` pasa (comprobado con el script en bash). Sugerencia: que `verify` compare `SUPABASE_URL` con el origen de producción esperado (o que haga el build antes de `migrate`). No bloquea: el riesgo exige secretos mal cargados por el usuario, y P-02 ya los fijó.
- **H-V05-QA-02 (Baja) — El dry-run informa pero no detiene.** Dry-run y `db push` son pasos consecutivos del mismo job; `docs/despliegue.md` pide "cancelar el run" si la lista no cuadra, pero el push empieza en segundos. En la práctica la revisión humana llega tarde. Sugerencia: si se quiere una revisión real, separar `db push` en un job con environment con revisor requerido. Aceptable para el primer despliegue (todas las migraciones son nuevas).
- **H-V05-QA-03 (Info) — Desvío del texto del plan, intencional.** El plan dice "en cada merge a `main`"; el workflow solo admite disparo manual hasta que el usuario apruebe la primera publicación. Está explicado en el encabezado de `deploy.yml` y en `docs/despliegue.md`. Si se activa `push`, `verify` fallará por la comprobación de `confirm` y la prueba de seguridad sobre `SUPABASE_SECRET_KEY` exigirá ajustes, como advierte el comentario. Además, `tests/workflows/deploy.test.js` fija `workflow_dispatch` como único disparador, así que habrá que actualizar esa prueba a la vez.
- **H-V05-QA-04 (Info) — Criterio final pendiente de la compuerta del usuario.** La publicación real y la aplicación de migraciones se verificarán con el primer run manual (jobs `migrate` y `smoke`).
