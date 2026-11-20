# F-10 — Informe QA
Veredicto: VERDE

Rama `item/F-10`, revisada sobre el SHA 1681cf8. Alcance: `scripts/ci/supabase-start.sh`, que reserva 54320-54329 con `net.ipv4.ip_local_reserved_ports` antes de `supabase start`.

## Criterio de aceptación: cumplido / no cumplido (por punto)

| Punto | Estado | Evidencia |
|---|---|---|
| Reserva 54320-54329 antes del primer intento | Cumplido | `reserve_ports` corre antes del bucle y una sola vez aunque haya reintentos. Pruebas: `supabase-start-f10` y `qa-f10` («db start también reserva antes del primer intento»). |
| Preserva reservas existentes | Cumplido | El valor nuevo es `<actual>,54320-54329`. Probado con varias reservas, con reservas solapadas (54300-54400) y con solapamiento parcial (54325-54335). |
| No falla sin sudo | Cumplido | Sin sudo, con sysctl rechazado (código 255), sin archivo o con contenido inesperado: emite `::warning::` y arranca igual. |
| Diagnóstico ampliado | Cumplido | `ss -tanp` muestra sockets en cualquier estado y el valor de `ip_local_reserved_ports`; filtra 5432 y 543225. |
| Reintento acotado intacto | Cumplido | Sigue en 3 intentos y sale ≠ 0 con el código del último. Con `SUPABASE_START_ATTEMPTS=1` hay un solo intento. Con entradas inválidas sale 2 sin tocar las reservas. |
| CI y Seguridad en verde | Cumplido | CI run 44747807612: success. Seguridad run 44747807907: success. Ambos sobre 1681cf8. |
| Los logs de los jobs que arrancan Supabase muestran la reserva | Cumplido | Los 5 jobs que arrancan Supabase registran `Puertos reservados: ip_local_reserved_ports=54320-54329` antes de `Intento 1 de 3`: db pgTAP (136327543330), integración (136327543451), e2e (136327855015), DAST (136327545203) y pentest API (136327545441). Los jobs S-05 A/B también usan el script, pero se omitieron (skipped). |

## Pruebas añadidas
- `tests/scripts/qa-f10.test.js`: 19 casos.
  - Archivo de reservas de 0 bytes, y con solo espacios o saltos de línea.
  - Varias reservas, reservas solapadas y solapamiento parcial.
  - Rango ya incluido en 4 posiciones o formatos, también con espacio tras la coma.
  - 4 falsos positivos de «ya reservado»: `154320-54329`, `54320-543299`, `4320-54329` y `54320-5432`.
  - sysctl rechazado por el kernel.
  - Sin sudo y con fallo persistente.
  - `ATTEMPTS=1`.
  - Comando no admitido o `ATTEMPTS` inválido: no reserva.
  - `db start`.
- Resultado local: los 19 pasan. La suite unitaria completa da 1757 pruebas, 1754 pasan y 0 fallan; las 3 restantes son 2 skipped y 1 todo, previas a este ítem.

## Resultado CI
- Sobre 1681cf8 (código del desarrollador y pruebas de seguridad): CI 44747807612 y Seguridad 44747807907, ambos success.
- Sobre el commit de este informe: ver los runs de `item/F-10` posteriores a 1681cf8. El resultado se anota en la respuesta al orquestador.

## Cobertura engine/
99,9 % de líneas. F-10 no toca `engine/`: la única línea sin cubrir es la 37 de `commitment.js`, igual que antes.

## Hallazgos
1. **Informativo, sin efecto.** Si una reserva previa ya cubre el rango (por ejemplo `54300-54400`), el script la detecta solo cuando aparece el token exacto `54320-54329`. En el resto de casos añade el rango otra vez. El kernel acepta valores solapados, así que el resultado es correcto y solo es redundante. Para reproducirlo: `qa-f10` «reserva solapada».
2. **Informativo.** En los runners actuales el archivo de reservas arranca vacío: los logs muestran solo `54320-54329`. Por eso la preservación de reservas previas solo está comprobada con dobles de prueba, no en un runner real.

No hay hallazgos bloqueantes.
