# F-10 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: `scripts/ci/supabase-start.sh` usa ahora dos comandos nuevos con sudo en el runner efímero de GitHub Actions. El primero es `sudo -n sysctl -w "net.ipv4.ip_local_reserved_ports=$new"`, que reserva 54320-54329 y conserva las reservas que ya existían. El segundo es `sudo -n ss -tanp`, que es diagnóstico y solo lectura. Hay también una variable nueva, `SUPABASE_RESERVED_PORTS_FILE`, que solo cambia la ruta desde la que se leen las reservas; ningún workflow la define. No hay endpoints, tablas, RPC ni cambios en el front. Modelo de amenazas: T-F10-01 y T-F10-02 en `docs/seguridad/modelo-amenazas.md`.

Revisado sobre `origin/item/F-10` (`9f61110`). Mis pruebas entraron en `d345489`.

## Decisión sobre el nuevo uso de sudo
Lo acepto. Los runners de GitHub son efímeros y ya tienen sudo sin clave. El sysctl escribe una sola clave fija y no puede ejecutar nada. El valor se lee, se le quitan los espacios y solo se acepta si contiene `[0-9,-]`. Después se compone solo como `$current,$RESERVED_RANGE` y se pasa como un único argumento entre comillas. Si falta sudo o el valor es inesperado, el script avisa y sigue: el arranque no depende de la reserva.

`SUPABASE_RESERVED_PORTS_FILE` no permite inyectar en el valor que escribe sysctl. Lo demuestran las pruebas dinámicas de abajo, con 21 contenidos hostiles. Además, para fijar esa variable hay que controlar ya el workflow, y quien lo controla ya ejecuta código en el runner.

## Pruebas de seguridad añadidas o cambiadas
- `tests/security/ci-supabase-start-f07.test.js`, caso de la lista blanca de sudo (cat. 5). La lista blanca se amplió de forma estrecha, con tres formas exactas y nada más:
  - `sudo -n ss -ltnp`
  - `sudo -n ss -tanp`
  - `sudo -n sysctl -w "net.ipv4.ip_local_reserved_ports=$new" >/dev/null 2>&1; then`

  El caso exige además que haya un solo sysctl, que no aparezca ninguna opción de sudo distinta de `-n` y que ningún sudo vaya sin `-n`. Solo se ignoran las líneas `echo "..."` literales que no contienen `$(`. El resto del caso no se debilitó.
- `tests/security/ci-supabase-start-f10.test.js` (nuevo): 7 casos con `sudo`, `ss` y `supabase` falsos en PATH, de modo que no se toca el sysctl real.
  - Cat. 5, estático (1 caso):
    - `new` solo se asigna como `$current,$RESERVED_RANGE` o `$RESERVED_RANGE`.
    - La validación `*[!0-9,-]*` va antes del sysctl.
    - Nunca se escribe ni se redirige hacia la ruta configurable.
  - Cat. 5, valores legítimos (2 casos):
    - Un único sysctl con exactamente 4 argumentos (`-n sysctl -w clave=valor`).
    - Las reservas existentes se conservan.
    - Si el rango ya está reservado, no se vuelve a llamar a sysctl.
  - Cat. 3, contenido hostil del archivo (1 caso, 21 entradas):
    - Metacaracteres: `;`, `$()`, backticks, `&&`, `|` y comillas.
    - Saltos de línea con otra clave sysctl (`kernel.core_pattern`, `kernel.modprobe`, `net.ipv4.ip_forward`).
    - Opciones (`-p`, `--system`), CR/LF y tabuladores.
    - NUL, UTF-8, `*`, `..` y un archivo de 70 000 bytes.

    Ninguna entrada ejecuta nada, ningún valor fuera de `[0-9,-]` llega a sysctl y el arranque nunca falla. El único sudo restante es `ss` de lectura.
  - Cat. 5, rutas raras (1 caso): una ruta inexistente, un directorio o `/dev/null` dan un aviso y el script sigue.
  - Cat. 5, diagnóstico (1 caso): solo usa `sudo -n ss -ltnp` y `sudo -n ss -tanp`, y un contenido hostil no se ejecuta.
  - Cat. 5, workflows (1 caso): ningún workflow define `SUPABASE_RESERVED_PORTS_FILE`.
- Prueba de mutación local: si la validación se relaja para aceptar `;` y letras, fallan 6 de los 7 casos.
- En local, `node --test 'tests/security/*.test.js' tests/scripts/supabase-start-f10.test.js` da 609 casos: 607 pasan, 0 fallan y los 2 restantes no se ejecutaron por diseño.

## Resultados del pipeline (head `d345489`)
- Seguridad, [run 44747088878](https://github.com/apivasa/practica_agente/actions/runs/44747088878): **verde**.
  - Verdes: gitleaks (historial completo), semgrep, npm audit `--omit=dev`, CodeQL (JS y Actions), `tests/security`, el pentest API (PostgREST/Auth) y DAST (e2e de seguridad más ZAP baseline).
  - S-05 fase A/B: omitidas por diseño, porque solo corren bajo demanda.
  - En el log del pentest API se ve `Puertos reservados: ip_local_reserved_ports=54320-54329` y Supabase arranca al primer intento.
- CI, [run 44747089067](https://github.com/apivasa/practica_agente/actions/runs/44747089067): **verde**.
- Los runs anteriores sobre `9f61110` (CI 44745596263 y Seguridad 44745596235) estaban en rojo solo por la lista blanca antigua.

## Hallazgos
Ninguno de severidad crítica, alta, media ni baja.

Dos notas informativas, que no son hallazgos:
1. `diagnose` imprime el contenido de `SUPABASE_RESERVED_PORTS_FILE` sin validar, porque usa `tr -d '\n'` sobre el archivo. Si la variable apuntara a un archivo sensible, su contenido saldría en el log. Para eso habría que controlar el entorno del workflow, y quien lo controla ya puede hacer `cat`. Ningún workflow la define y la prueba lo fija.
2. `sudo -n ss -tanp` vuelca sockets del runner, pero filtrados a 54320-54329, y el runner es efímero.

## Verificado sin hallazgos
- 3 (entradas): las variables y el contenido del archivo se validan antes de usarse.
- 5 (Actions): sudo está acotado a tres formas, la reserva no hace fallar el arranque y los workflows no cambian.
- 6 (cadena de suministro): no hay dependencias nuevas. gitleaks, semgrep, CodeQL y npm audit están en verde.
- 1, 2, 4, 7 y 8: sin cambios en RLS, Auth, front, superficie DAST, datos personales ni auditoría. La regresión completa está en verde.
