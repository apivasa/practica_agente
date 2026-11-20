# Plan maestro — App de control de capacidad por indicadores RUN

Fuente de verdad del diseño: `docs/diseno.md` (copia del doc https://claude.ai/artifact/R48Rkcxs52r6BpeY4m8XjU).
Este archivo lo lee y actualiza el **orquestador** en cada ciclo. Solo él cambia la columna *Estado*.

**Objetivo del producto:** que el comité de delivery vea cada mes el color de cada unidad por indicador RUN, que las restricciones (candados) se apliquen y comuniquen solas, y que el control sea por resultados (avance real vs. esperado).

**Modo de trabajo:** autónomo, ciclos cada 3 horas. Cada ciclo cierra entre 1 y 3 ítems. Se construye y prueba con Supabase local dentro de GitHub Actions (sin credenciales reales). El despliegue a producción (Supabase real + GitHub Pages) queda detrás de la compuerta P-02/P-03 del usuario (ambas resueltas el 2026-11-19) y del pentest S-05.

---

## Capacidad

No hay velocidad histórica. Unidad de estimación: **ciclos** (1 ciclo ≈ una ejecución de 3 h del orquestador). Se planea al 75 % para absorber reintentos.

| Recurso | Disponibilidad | Capacidad efectiva | Notas |
|---|---|---|---|
| Orquestador + 5 subagentes | 8 ciclos/día | 6 ciclos/día | 25 % de colchón para reintentos y correcciones de CI |
| Usuario (dueño) | Solo compuertas | — | Responde `docs/pendientes-usuario.md` |

Tallas: **S** = 1 ciclo · **M** = 2 ciclos · **L** = 3 ciclos.

---

## Sprint 1 — Fundaciones
**Objetivo:** un repositorio con CI verde que levanta Supabase local, crea el esquema completo con seguridad por filas probada y una web que inicia sesión y enruta por rol.
**Carga:** 11 ciclos (≈ 2 días).

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| F-01 | P0 | Estructura del repo: front Vite + JavaScript (ES modules), carpeta `supabase/`, `engine/` (lógica pura compartida), `scripts/` para Actions | S | — | `npm ci && npm run build` genera `dist/` estático; README con comandos |
| F-02 | P0 | CI: lint, pruebas unitarias (node:test, ADR 0002), `supabase start` local, pruebas de BD (pgTAP) y de RLS, build | M | F-01 | Workflow `ci.yml` verde en PR y en `main`; falla si cualquier paso falla. Workflow `lockfile.yml` genera y sube `package-lock.json` cuando cambia `package.json` (las sesiones de Claude no pueden instalar paquetes) |
| F-03 | P0 | Migraciones del modelo de datos: Unidades, Usuarios y roles, Indicadores, Compromisos, Mediciones, Metas, Evaluaciones, Excepciones, Alertas | M | F-02 | `supabase db reset` aplica sin errores; pgTAP valida tablas, FKs y enums |
| F-04 | P0 | RLS por rol: gestora (todo config), custodio (sus KPIs), comité (lectura total + excepciones), líder (solo su unidad) | L | F-03 | Pruebas pgTAP con un usuario por rol: cada rol ve y escribe solo lo permitido; ninguna tabla sin RLS |
| F-05 | P0 | Login (Supabase Auth, correo + contraseña) y enrutamiento por rol en el front | M | F-04 | Prueba e2e (Playwright) entra con cada rol de seed y llega a su vista |
| F-06 | P1 | Datos semilla ficticios: 3 unidades, 4 roles, indicadores de ejemplo (vulnerabilidades, disponibilidad, MTTR, cobertura) | S | F-03 | `seed.sql` sin datos personales reales; usado por pruebas |

## Seguridad transversal (constructor: agente `seguridad`)
**Objetivo:** que cada PR pase por pruebas de seguridad automáticas y que nada llegue a producción sin un pentest completo en verde.
**Carga:** 11 ciclos repartidos entre sprints.

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| S-01 | P0 | Pipeline `seguridad.yml`: gitleaks (diff + historial), semgrep (JS, SQL, Actions), `npm audit`, en cada PR y semanal | M | F-02 | Un secreto de prueba sembrado en una rama de ensayo hace fallar el pipeline; un PR limpio pasa |
| S-02 | P0 | Modelo de amenazas STRIDE en `docs/seguridad/modelo-amenazas.md`: activos, roles, superficie, amenazas con control y prueba | S | F-03 | Cada amenaza alta tiene una prueba automática asignada |
| S-03 | P0 | Pentest de RLS y API: por rol y anónimo, CRUD directo a PostgREST y RPC en cada tabla, IDOR entre unidades y KPIs, escalada de rol, JWT manipulado | L | F-04, F-06 | Matriz rol × tabla × operación completa en pruebas; cualquier tabla sin RLS hace fallar CI |
| S-04 | P0 | DAST: OWASP ZAP baseline contra el front local + Supabase local; CSP por meta, SRI, sin secretos en `dist/`; pruebas XSS e inyección CSV | M | F-05, M-04 | ZAP sin alertas altas; payloads XSS y de fórmula escapados en e2e |
| S-05 | P0 | **Pentest previo a producción** (compuerta de V-05): ZAP full scan no destructivo contra Pages, pentest asistido de la API real con usuarios de prueba de los 4 roles, revisión de configuración de Auth y secretos de Actions | M | V-01, V-02, C-04, P-02, P-03 | Informe `docs/seguridad/pentest-preproduccion.md` sin hallazgos altos ni críticos abiertos |

## Sprint 2 — Motor de indicadores
**Objetivo:** cualquier indicador configurado de forma genérica produce un color correcto por unidad y mes, y el caso de vulnerabilidades calcula su ritmo y meta parcial.
**Carga:** 12 ciclos (≈ 2 días).

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| M-01 | P0 | Motor de color (`engine/`, función pura): tipos meta acumulada, promedio en ventana y cobertura; sentido; ventana; umbrales verde/amarillo/rojo (opcional por categoría); mínimo de muestra | L | F-01 | ≥ 95 % de cobertura de líneas en `engine/`; casos borde: sin muestra suficiente → "sin evaluar", empates en umbral, ventana vacía |
| M-02 | P0 | Pantalla de alta y edición de indicadores (gestora) con los 7 atributos del modelo genérico y asignación de custodio | M | F-05, M-01 | e2e: la gestora crea un indicador nuevo no previsto y queda evaluable |
| M-03 | P0 | Compromisos por unidad, indicador y periodo (custodio) | S | M-02 | e2e: el custodio registra un umbral negociado que sobrescribe el general |
| M-04 | P0 | Captura manual de mediciones (custodio) + importación CSV validada | M | M-03 | CSV con errores se rechaza fila a fila con mensaje; e2e de carga |
| M-05 | P0 | Caso vulnerabilidades: paquete trimestral; P0/P1 nuevas entran en meses 1–2 y en mes 3 pasan al siguiente; cumplimiento 96 % P0/P1 y 85 % P2/P3; ritmo = pendiente / semanas restantes; meta parcial mensual ≈ 1/3; arrastre al cierre | L | M-01, M-04 | Pruebas con el ejemplo del diseño (2.000 → 2.200) reproducen ritmo, meta y arrastre |

## Sprint 3 — Candados, excepciones y alertas
**Objetivo:** el sistema aplica las reglas de escalada mes a mes, respeta excepciones vigentes y avisa a líder y comité sin intervención manual.
**Carga:** 11 ciclos (≈ 2 días).

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| C-01 | P0 | Motor de escalada: verde normal; mes 1 amarillo/rojo → no change nuevo; mes 2 rojo → se frena todo el change; cierre de trimestre → arrastre. Regla "amarillo en mes 2" **configurable** (por defecto = mes 1) hasta que se decida (Q-03) | M | M-01 | Tabla de verdad completa en pruebas; historial guardado en Evaluaciones |
| C-02 | P0 | Excepciones del comité: motivo, vencimiento, visibles para todo el comité; suspenden el candado mientras estén vigentes | M | C-01, F-04 | e2e: el comité aprueba; vencida → el candado vuelve; RLS: el líder no puede crear excepciones |
| C-03 | P0 | GitHub Action `evaluacion-mensual.yml` (día 1, 06:00 America/Guayaquil) y `ritmo-diario.yml` que evalúan colores, escaladas y atrasos con la clave secreta (`SUPABASE_SECRET_KEY`) desde secretos | M | C-01, M-05 | Se ejecuta contra Supabase local en CI con datos semilla; idempotente (correr dos veces no duplica) |
| C-04 | P0 | Alertas: cambio de color, atraso frente al ritmo, ingreso de P0/P1 que recalcula la meta, vencimiento de excepciones. Registro en tabla Alertas + bandeja en la app. Canal externo según Q-04 | M | C-03 | Cada disparador genera exactamente una alerta por destinatario; agrupación sin duplicados |
| C-05 | P1 | Envío de correo de alertas (proveedor según Q-04) | S | C-04, Q-04 | Bloqueado hasta respuesta Q-04 |

## Sprint 4 — Vistas, salud y salida a producción
**Objetivo:** cada rol tiene su vista, el sistema se vigila solo y queda publicado en GitHub Pages con Supabase real.
**Carga:** 12 ciclos (≈ 2 días) + compuertas del usuario.

| ID | Prioridad | Ítem | Talla | Depende de | Criterio de aceptación |
|---|---|---|---|---|---|
| V-01 | P0 | Vista líder: sus indicadores, color, meta mensual, avance vs. ritmo y restricciones activas | M | C-02 | e2e con rol líder; no ve otras unidades |
| V-02 | P0 | Vista comité: todas las unidades (matriz unidad × indicador), alertas, excepciones | M | C-02, C-04 | e2e con rol comité |
| V-03 | P0 | Tablero de completitud por custodio (gestora): qué datos faltan para el comité del mes | S | M-04 | Muestra % cargado por custodio y KPI |
| V-04 | P0 | Salud del sistema: workflow `salud.yml` (cada 6 h) que verifica la web y Supabase, falla visible si algo cae; alerta si un workflow programado no corrió o falló; registro de auditoría de acciones automáticas | M | C-03 | Simulación de caída en CI produce alerta; runbook en `docs/operacion.md` |
| V-05 | P0 | Despliegue: `deploy.yml` publica `dist/` en GitHub Pages y aplica migraciones a Supabase real en cada merge a `main` | M | V-01, V-02, S-05, **P-02, P-03** | Primera publicación accesible en la URL de Pages; migraciones aplicadas |
| V-06 | P1 | Manual por rol (gestora, custodio, comité, líder) y guía de configuración de indicadores | S | V-01..V-03 | Revisado por el documentador y el arquitecto |
| V-07 | P2 | Fuentes automáticas de mediciones (Q-02) | L | Q-02 | Bloqueado hasta respuesta Q-02 |

---

## Orden de ejecución autónoma

El orquestador toma el **primer ítem `Pendiente`** cuyas dependencias estén `Hecho` y que no esté `Bloqueado`.

| # | ID | Estado | Intentos | PR | Nota |
|---|---|---|---|---|---|
| 1 | F-01 | Hecho | 0 | #1 |  |
| 2 | F-02 | Hecho | 0 | #1 |  |
| 3 | S-01 | Hecho | 1 | #6 | Constructor: seguridad |
| 4 | F-03 | Hecho | 0 | #5 |  |
| 5 | S-02 | Hecho | 0 | #13 | Constructor: seguridad |
| 6 | M-01 | Hecho | 1 | #2 | Puede ir en paralelo a F-03 (solo depende de F-01) |
| 7 | F-04 | Hecho | 0 | #5 |  |
| 8 | F-06 | Hecho | 0 | #5 |  |
| 9 | S-03 | Hecho | 0 | #13 | Constructor: seguridad |
| 10 | F-05 | Hecho | 0 | #14 |  |
| 11 | M-02 | Hecho | 1 | #18 |  |
| 12 | M-03 | Hecho | 1 | #18 |  |
| 13 | M-04 | Hecho | 1 | #18 |  |
| 14 | S-04 | Hecho | 0 | #17 | Constructor: seguridad |
| 15 | M-05 | Hecho | 1 | #7 | Parte de motor adelantada; integración con BD tras F-03 y M-04  |
| 16 | C-01 | Hecho | 0 | #3 |  |
| 17 | C-02 | Hecho | 1 | #20 |  |
| 18 | C-03 | Hecho | 1 | #15 |  |
| 19 | C-04 | Hecho | 1 | #15 |  |
| 20 | V-03 | Hecho | 1 | #21 |  |
| 21 | V-01 | Hecho | 1 | #21 |  |
| 22 | V-02 | Hecho | 1 | #21 |  |
| 23 | V-04 | En revisión | 0 | |  |
| 24 | V-06 | En curso | 0 | |  |
| 25 | S-05 | En revisión | 0 | | P-02 y P-03 resueltos; constructor: seguridad |
| 26 | V-05 | En curso | 1 | | P-02 y P-03 resueltos; espera S-05 |
| 27 | C-05 | Bloqueado | 0 | | Espera Q-04 |
| 28 | V-07 | Bloqueado | 0 | | Espera Q-02 |

Estados válidos: `Pendiente`, `En curso`, `En revisión`, `Hecho`, `Bloqueado`.

---

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Las reglas de disponibilidad, tiempo de ciclo, MTTR, continuidad y observabilidad no están definidas (Q-01) | Esos indicadores no se pueden evaluar con su lógica final | El motor es genérico: se configuran con los tres tipos de medición; la lógica específica se ajusta por configuración cuando se defina |
| Ambigüedad "amarillo en mes 2" (Q-03) | Escalada incorrecta | Regla configurable con valor por defecto documentado |
| Supabase local en CI tarda o falla | CI lento o intermitente | Caché de imágenes; reintento único; el arquitecto-SRE vigila la duración |
| Plan gratuito de Supabase pausa proyectos inactivos | Caída en producción | `salud.yml` hace una consulta liviana periódica y alerta |
| Ciclos que se solapan si uno dura más de 3 h | Conflictos en ramas | Candado de ciclo en `docs/estado.md` |
| Fuga de la clave secreta de Supabase | Acceso total a la BD | Solo en secretos de Actions; el revisor de seguridad lo verifica en cada PR |

## Definition of Done (cada ítem)

- [ ] Criterio de aceptación del ítem cumplido y demostrado por pruebas automáticas
- [ ] CI verde (lint, unitarias, BD/RLS, e2e cuando aplica, build)
- [ ] Informe del tester: verde
- [ ] Informe de seguridad: sin hallazgos altos ni críticos abiertos
- [ ] Informe del arquitecto-SRE: alineado al diseño y sin regresión de salud
- [ ] Documentación actualizada por el documentador
- [ ] PR fusionado a `main` con squash y referencia al ID del ítem

## Fechas clave (estimadas, se mueven con el inicio real)

| Hito | Ciclos acumulados | Fecha estimada |
|---|---|---|
| Inicio (acceso al repo concedido) | 0 | Día 0 |
| Fin Sprint 1: esquema + RLS + login | 11 | Día 2 |
| Fin Sprint 2: motor de indicadores | 23 | Día 4 |
| Fin Sprint 3: candados y alertas | 34 | Día 6 |
| Fin Sprint 4: vistas y salud (incluye seguridad S-01 a S-04) | 55 | Día 9–10 |
| Pentest previo a producción (S-05) y publicación en Pages | ≈ 59 | Día 10 |
