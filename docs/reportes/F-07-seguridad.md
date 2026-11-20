# F-07 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva:
- `scripts/ci/supabase-start.sh`. Envuelve `supabase start` y `supabase db start` con un reintento acotado. Entre intentos ejecuta `supabase stop --no-backup` y diagnostica los puertos con `sudo -n ss -ltnp` y `docker ps -a`.
- Lo usan `ci.yml` (3 arranques) y, desde este ítem, `seguridad.yml` (3 arranques: `pentest-api`, `dast` y `s05-fase-a`).
- No hay secretos nuevos ni permisos nuevos.

Revisado sobre `origin/item/F-07` en `cd8d959`. El commit de seguridad es `1e03204`: un commit de QA lo revirtió por error y `cd8d959` lo restauró idéntico.

## Cambios de seguridad en la rama
- `.github/workflows/seguridad.yml`: las líneas 175, 235 y 346 pasan a `run: bash scripts/ci/supabase-start.sh supabase start -x studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector`.

## Pruebas de seguridad añadidas
`tests/security/ci-supabase-start-f07.test.js`, 6 casos de las categorías 3 y 5:
- **Estático:** el script no usa `eval`, `bash -c`, `source` ni `set -x`. Ejecuta `"$@"` entre comillas y fija el primer argumento a `supabase`.
- **sudo:** solo aparece como `sudo -n ss -ltnp`, no interactivo y de lectura.
- **Inyección de argumentos:** se probaron `;`, `$(...)`, backticks, espacios, comillas y `&&`. Llegan literales a la CLI y no crean ningún archivo.
- **Comandos no permitidos:** se rechazan con código 2, sin ejecutar nada: otros binarios, `/usr/bin/env`, `./supabase`, `db reset`, `stop`, `link`, `db push`, sin argumentos y `"supabase start"` como un solo argumento.
- **Variables de entorno hostiles:** se rechazan antes de usarse. `SUPABASE_START_ATTEMPTS` con `;`, `$(...)`, 0, 10⁶ o -1, y `SUPABASE_START_WAIT` con `;`, 9999, -5 o `1e3`.
- **Workflows:** en `ci.yml` y `seguridad.yml`, todo arranque de Supabase local pasa por el script, con argumentos fijos y sin `${{ }}`.

## Resultados del pipeline (en `cd8d959`)
- **Seguridad**, [run 44686826472](https://github.com/apivasa/practica_agente/actions/runs/44686826472): verde.
  - Jobs: gitleaks, semgrep, npm audit, CodeQL JS y Actions, `security-tests` (incluye `F-07` › ok), `pentest-api` y DAST con ZAP baseline.
  - En `pentest-api` el log muestra `Intento 1 de 3: supabase start -x …`: el script se usa en `seguridad.yml`.
- **CI**, [run 44686826487](https://github.com/apivasa/practica_agente/actions/runs/44686826487): verde (build, pgTAP, integración, e2e).

## Hallazgos
- **Info · cat. 5 · `scripts/ci/supabase-start.sh` (`diagnose`).** Cuando un arranque falla, el diagnóstico imprime en el log público del repo los procesos que escuchan en 54321-54324 (`ss -p`: nombre y PID) y `docker ps -a` (nombre, estado y puertos). Son datos del runner efímero, sin secretos ni variables de entorno. Se acepta, no es accionable.
- **Info · cat. 5 · `supabase stop --no-backup` entre intentos.** Si alguien corre el script en local, borra los volúmenes de la BD local. Es el comportamiento documentado y solo se usa en CI. No es accionable.

## Verificado sin hallazgos
- **Cat. 3:** no hay inyección de argumentos ni de entorno.
- **Cat. 5:** el reintento no oculta fallos, porque sale con el código del último intento y nunca con 0 (lo prueban QA y desarrollo). No se interpolan expresiones. Los permisos de los workflows no cambian. No se imprimen secretos.
- **Cat. 6:** no hay dependencias nuevas.
- **No aplica:** categorías 1, 2, 4, 7 y 8.
