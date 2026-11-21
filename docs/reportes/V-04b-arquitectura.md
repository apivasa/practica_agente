# V-04b — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno. El ítem cierra H-ARQ-V05b-02 sin cambiar ADR 0014 ni ADR 0015.
Salud: commit 7d6b056 revisado. `node --test tests/scripts/health-deploy.test.js tests/scripts/health.test.js` pasa en local (47/47). La validación completa queda para CI de la rama. Este ítem no cambia los workflows programados. A `salud.yml` solo se le cambió el comentario de cabecera: mismos permisos (`actions: read` en `check`) y mismos pasos.

## Decisiones validadas
- **Cancelado después de un fallo sigue fallando.** Es correcto, porque cancelar no corrige el fallo. `previous` es el primer run completado no cancelado. Cuando el último run está cancelado y el anterior fue un success (o no hay anterior), el resultado es `warn` y no abre issue. Hay prueba para cada caso.
- **Un run en `waiting` más de 60 min falla.** Es correcto: el environment `produccion` no debe tener revisor (ADR 0015 punto 6), así que un `waiting` largo indica una mala configuración. El umbral de 60 min queda por encima de la suma de los timeouts de los jobs de `deploy.yml` (unos 55 min). Un run `queued` detrás de otro (concurrency sin cancelación) solo supera el umbral si el primero está colgado, y ese caso también hay que alertarlo.
- **`DEPLOY_RULE` queda fuera de `WORKFLOW_RULES`.** Es correcto: `deploy.yml` no es programado, así que las reglas de frecuencia (`maxAgeHours`, mes actual, paso "Evaluar") no aplican. La consulta reutiliza `createGitHubClient`, sin duplicar código. Toda la lógica está en la función pura `assessDeploy`.
- **`salud.yml` no cambia en lógica.** El check entra por `--only=workflows` y por `runAll`, y `failedChecks` ignora `warn`. El issue de alerta no cambia y sigue sin datos sensibles: el detalle con el enlace al run solo aparece en el log y en el resumen.
- **El check se exige siempre, también sin producción.** Es razonable: un despliegue manual fallido es información útil aunque `EVALUATION_ENABLED` siga en `false`. Si no hay runs, el check pasa.

## Hallazgos
- **H-ARQ-V04b-01 (informativo, corregido en este informe).** `docs/operacion.md` añade la fila `deploy-main` a la tabla de checks, la nota de que `warn` no abre issue, su runbook (failure, cancelado tras fallo, `waiting`/`queued` atascado, aviso, deshabilitado) y la mención en «Revisor requerido». El comentario de cabecera de `salud.yml` ahora menciona el despliegue.
- **H-ARQ-V04b-02 (bajo, para V-05b).** La revisión manual de despliegue que hay que quitar no está en esta rama, sino en `item/V-05b` (aún sin fusionar, espera P-07):
  - `docs/operacion.md` § Despliegue, «Vigilar… el orquestador lo mira en el paso 3»;
  - `docs/despliegue.md:70`;
  - `docs/adr/0015-despliegue-manual-primero.md:50`.

  Al rebasar V-05b sobre `main` (con V-04b ya fusionado), esas tres líneas deben decir que `salud.yml` lo vigila con `deploy-main`, y quitar la revisión manual del paso 3.
- **H-ARQ-V04b-03 (informativo).** Un fallo antiguo sigue alertando hasta el siguiente despliegue en success. Se comenta en el mismo issue cada 6 h y no se duplica. Es el mismo criterio que `ci-main` y es intencional. El runbook lo explica.
