# F-10 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí. El cambio está en `scripts/ci/supabase-start.sh`, el script de CI de F-07. No toca el stack, el modelo de datos, `engine/` ni las reglas de escalada.
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno. Es un ajuste de CI dentro de ADR 0004 y ADR 0014; no hay decisión técnica nueva que registrar.
Salud: rama `item/F-10` en verde en el SHA 1681cf8 (CI 44747807612 y Seguridad 44747807907) y en el d345489 (CI 44747089067 y Seguridad 44747088878). En los tres SHA de la rama, 14 de 14 arranques de Supabase pasaron al primer intento y con la reserva aplicada. Duraciones en línea con la base: db 67–71 s, integración 77–84 s, pentest-api 74–99 s, DAST 179–205 s, e2e 136–144 s.

## Causa raíz contra los logs

Job 136313873270 (Seguridad, pentest-api, PR #40) muestra lo siguiente:
- Los 3 intentos fallaron con `failed to bind host port 0.0.0.0:54322/tcp: address already in use` en 13:23:27, 13:23:40 y 13:23:53. Entre ellos hubo `supabase stop` y 10 s de espera.
- Tras cada intento, el diagnóstico dijo «ss: ningún proceso escucha en 54321-54324». `docker ps -a` no mostró contenedores que retuvieran el puerto.

Un fallo que persiste unos 26 s, sin LISTEN y sin contenedor, descarta el choque con otro Supabase y un contenedor residual. Encaja con un socket no LISTEN, por ejemplo una conexión saliente ESTAB que el kernel abrió con 54322 como puerto efímero de origen. 54322 está dentro de `ip_local_port_range` (32768–60999), y ese socket choca con el `bind` comodín de docker-proxy. La hipótesis es coherente con la evidencia. No queda probada, porque el `ss -ltnp` de F-07 no podía ver ese socket. Desde F-10, `ss -tanp` lo mostraría si vuelve a pasar.

## Impacto en los workflows

- **Quién usa el script:** `ci.yml` en 3 jobs (db, integración, e2e) y `seguridad.yml` en 3 jobs (pentest-api, DAST, S-05 fase A). En los runs de la rama, los 5 que corren en PR registran «Puertos reservados: ip_local_reserved_ports=54320-54329». S-05 fase A se omite en PR, pero usa el mismo script.
- **Workflows que no lo usan:** `salud.yml`, `deploy.yml`, `evaluacion-mensual.yml`, `ritmo-diario.yml` y `lockfile.yml` no arrancan Supabase local con el script. No hay impacto en ellos.
- **Runners sin sudo:** si `sudo -n sysctl` falla, o si no se puede leer `/proc`, el script deja un `::warning::` y sigue con el reintento de F-07 (`return 0`). Lo cubren las pruebas «sin sudo no interactivo» y «sin archivo de reservas». No rompe en runners self-hosted ni en contenedores.
- **Alcance del cambio en el kernel:** solo dura lo que vive la VM efímera del runner. Conserva las reservas previas y nunca libera puertos. `SUPABASE_RESERVED_PORTS_FILE` solo cambia la ruta de lectura, y una prueba verifica que ningún workflow la fija.

## Hallazgos (ninguno bloquea)

1. **H-ARQ-F10-01 (riesgo residual):** la reserva impide que se asignen *nuevos* puertos efímeros en el rango, pero no desaloja un socket que ya exista. Es posible que lo hubiera abierto un paso anterior del job (checkout, setup-node, `npm ci`, setup-cli) con una conexión larga. Es poco probable, porque esas conexiones suelen ser cortas. Si se repite «no arrancó tras 3 intentos», el bloque `ss -tanp` lo mostrará. La mitigación sería mover la reserva a un paso inicial del job. No se pide ahora.
2. **H-ARQ-F10-02 (menor):** la comprobación «ya reservado» busca el literal `54320-54329` en la lista. Si el kernel fusiona rangos contiguos (por ejemplo, con una reserva previa de 54330), el texto no coincide y se vuelve a llamar a `sysctl` con el mismo rango. Es idempotente e inocuo, así que no hace falta cambio.
3. **H-ARQ-F10-03 (para el documentador, `docs/operacion.md`):**
   - Línea 85 (pentest-api, «address already in use»): añadir que desde F-10 el script reserva 54320–54329 con `ip_local_reserved_ports` antes del primer intento, con la línea «Puertos reservados: …» en el log. También, que el grupo de diagnóstico cubre 54320–54329 e incluye `ss -tanp` en cualquier estado, además del valor de reservas. Un `::warning::` «No se pudieron reservar» significa que el runner no tiene sudo: la protección queda solo en el reintento.
   - Corregir «(`ss -ltnp`, `docker ps -a`)» por «(`ss -ltnp`, `ss -tanp`, `docker ps -a`, `ip_local_reserved_ports`)».
   - Precisar que «no arrancó tras 3 intentos» con la reserva aplicada y sin LISTEN apunta a un socket de origen previo a la reserva (ver H-ARQ-F10-01): mirar el bloque `ss -tanp`.
   - Líneas 56–57 (historial V-04 y 54324): añadir una nota de cierre: «Causa raíz probable, puerto efímero de origen en el rango de Supabase; mitigado por F-10 (job 136313873270 como evidencia)».
4. **Métrica que hay que vigilar tras el merge:** contar en `main` los `::notice::` «arrancó en el intento N» con N > 1. Si en 2 semanas aparece alguno con la reserva aplicada, la hipótesis queda refutada y toca abrir un ítem nuevo.
