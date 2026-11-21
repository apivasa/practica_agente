# Diseño: App de control de capacidad por indicadores RUN

Copia de trabajo del documento original: https://claude.ai/artifact/R48Rkcxs52r6BpeY4m8XjU (2026-11-19).
Si el usuario cambia el diseño, el orquestador actualiza esta copia y registra el cambio al final.

## Contexto
El modelo operativo de las unidades de delivery da flexibilidad para manejar su presupuesto, que en la práctica es capacidad (personas). A cambio, se controla con indicadores de RUN (disponibilidad, tiempo de ciclo, vulnerabilidades, MTTR, continuidad, observabilidad, etc.), cada uno con umbrales verde, amarillo y rojo. Según el color, se restringe qué puede hacer la unidad con su capacidad.

## Objetivo de la app
- Configurar indicadores de forma genérica (no solo los actuales).
- Calcular el color de cada unidad de forma mensual, contra metas parciales.
- Aplicar y comunicar las restricciones (candados) según el color y su historial.
- Alertar al líder de la unidad y al comité de delivery.
- Controlar por resultados (avance real vs. esperado), no vigilando tareas en Jira.

## Reglas de escalada (candados)
- **Verde:** operación normal.
- **Mes 1 en amarillo o rojo:** no se inicia change nuevo ni se agrega al backlog; se continúa lo planeado del trimestre y se dedica capacidad al RUN.
- **Mes 2 en rojo:** se frena todo el change; toda la capacidad va a resolver el RUN.
- **Cierre de trimestre:** lo no resuelto se arrastra al paquete siguiente (efecto bola de nieve). Por eso la medición es mensual.

## Principio de control
No se vigila si alguien trabaja en change (Jira no lo garantiza). Se mide si el RUN avanza al ritmo esperado; si no avanza, se alerta e interviene.

## Modelo genérico de indicador
1. **Tipo de medición:** meta acumulada (ej. paquete de vulnerabilidades); promedio en ventana (ej. disponibilidad, tiempo de ciclo, MTTR); cobertura (% de aplicaciones que cumplen; ej. continuidad, observabilidad).
2. **Sentido:** más es mejor (disponibilidad) o menos es mejor (MTTR, tiempo de ciclo).
3. **Ventana de cálculo:** ej. últimos 30 días.
4. **Umbrales:** verde, amarillo, rojo; opcionalmente por categoría.
5. **Frecuencia de evaluación:** ej. mensual.
6. **Mínimo de muestra:** ej. MTTR solo se evalúa con un número mínimo de incidentes.
7. **Fuente de datos:** captura manual, CSV o **archivo Excel (.xlsx)**. Sin integraciones automáticas por ahora (Q-02, 2026-11-20).

## Caso: vulnerabilidades
- Seguridad hace triaje y asigna un paquete trimestral por unidad (ej. 2.000), entregado a fines de diciembre / inicios de enero, para resolver enero a marzo.
- Los escaneos siguen: P0 y P1 nuevas entran directo al paquete en meses 1 y 2 (ej. sube a 2.200). Las detectadas en el mes 3 pasan al paquete siguiente.
- **Cumplimiento por criticidad:** 96 % de P0/P1 y 85 % de P2/P3.
- **Ritmo esperado:** pendiente / semanas restantes, recalculado cada vez que entra algo. Meta parcial mensual (aprox. un tercio por mes).
- Lo no resuelto al cierre se suma al paquete siguiente.

## Roles
- **Gestora de KPIs:** define las reglas de juego del año, da de alta los indicadores, asigna custodios y vigila que cada mes esté el dato listo para el comité. Tiene un tablero de completitud por custodio.
- **Custodios:** cada uno es dueño de un KPI (ej. vulnerabilidades); negocia con las unidades umbrales y compromisos de cumplimiento, y carga las mediciones mensuales.
- **Comité de delivery:** ve todas las unidades, recibe alertas, decide escaladas y aprueba excepciones.
- **Líder de unidad:** ve solo sus indicadores, su color, su meta mensual, su avance y sus restricciones activas; recibe alertas.

## Excepciones
El comité puede aprobar excepciones (ej. arrancar algo urgente estando en rojo), con motivo registrado, fecha de vencimiento y visibilidad para todo el comité.

## Alertas
- Destinatarios: líder de unidad y comité de delivery.
- Disparadores: cambio de color, atraso frente al ritmo esperado, ingreso de P0/P1 que recalcula la meta, vencimiento de excepciones.
- Canales: bandeja en la app y **correo vía Resend** a cada destinatario (las mismas alertas de su bandeja). Decidido por la usuaria el 2026-11-20 (Q-04).

## Stack técnico (versión académica)
- **Front:** web estática publicada en GitHub Pages (URL de GitHub, sin costo).
- **Base de datos, login y roles:** Supabase (mismo stack que Café y Tinta), con seguridad por filas para que cada líder vea solo su unidad.
- **Cálculo mensual y alertas:** GitHub Actions programados que evalúan colores, escaladas y envían notificaciones.
- **Repositorio:** GitHub.

## Modelo de datos (Supabase)
| Tabla | Contenido |
|---|---|
| Unidades | Cada unidad de delivery y su líder |
| Usuarios y roles | Gestora, custodio, comité o líder, ligado a su unidad o KPI |
| Indicadores | Tipo, sentido, ventana, umbrales, frecuencia, fuente y custodio |
| Compromisos | Umbrales o metas negociadas por unidad, indicador y periodo (ej. paquete trimestral) |
| Mediciones | Valores cargados por unidad, indicador y fecha |
| Metas | Meta parcial mensual (ej. un tercio del paquete) |
| Evaluaciones | Color por unidad, indicador y mes; historial para la escalada |
| Excepciones | Aprobadas por el comité, con motivo y vencimiento |
| Alertas | Qué se notificó, a quién y cuándo |

## Pendientes por definir (ver `docs/pendientes-usuario.md`)
- Lógica detallada de disponibilidad, tiempo de ciclo, MTTR, continuidad y observabilidad (Q-01).
- Si el color amarillo tiene la misma escalada que rojo en el mes 2 (Q-03).

## Registro de cambios del diseño
| Fecha | Cambio | Origen |
|---|---|---|
| 2026-11-19 | Copia inicial | Doc del usuario |
- 2026-11-20: Q-04 → alertas también por correo con Resend, a cada destinatario. Q-02 → las mediciones llegan por archivo Excel (.xlsx); sin fuentes automáticas por ahora.
