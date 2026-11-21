# F-15 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (cambio interno del check `deploy-main`, sin decisión técnica nueva)
Salud: pruebas de `tests/scripts/` en local: 669 pruebas, 668 pass, 0 fail y 1 TODO previo (H-C04-QA-01, ajeno a F-15). El CI de la rama se valida en el PR. `correo-alertas.yml`: `total_count` 0, nunca ha corrido; no se lanzó en esta revisión. Es coherente con la falta de producción activa (P-02/P-03).
Hallazgos:
- Revisado contra H-F14-01 / H-ARQ-F14-04 (SHA cedc123). `assessDeploy` ordena y calcula `stuck` con `parseApiTime`, así que el check ya no usa `Date.parse` suelto. Un run completado (sin contar `skipped`/`neutral`) con `created_at` inválido o futuro agrega un problema, y el check falla con mensaje explícito y enlace. Los pendientes con fecha inválida se descartan, que es el lado seguro: no cubren un fallo (`newerPendingRun` ya los rechazaba), no dan `ok` y no lanzan. Esto respeta qa-v04b «sin fechas válidas: no se considera atascado ni lanza».
- Sin regresión: no cambian el orden de los válidos, `isolatedFailure`, `newerPendingRun`, el aviso por cancelado ni el aviso por fallo cubierto. Un problema de fecha impide el `warn` (`problems.length === 0`), de modo que un aviso no lo puede ocultar. La lógica sigue en `scripts/health/lib.js` (salud, no `engine/`), como en F-13 y F-14.
- Observación (no bloquea): un run `cancelled` completado con fecha inválida también hace fallar el check. Es aceptable: es el lado seguro y un caso muy raro.
- `docs/operacion.md` actualizado por el arquitecto. La tabla de checks recoge la nueva regla de `deploy-main`, y el runbook tiene una entrada para el mensaje «... con fecha inválida o en el futuro ...».
