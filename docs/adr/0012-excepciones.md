# ADR 0012 — Excepciones del comité: inicio puntual, revocación y tope de vigencia

Estado: Aceptado (decisión técnica, 2026-11-19, ítem C-02; no contradice el diseño)

## Contexto
`docs/diseno.md` dice que el comité aprueba excepciones con motivo, vencimiento y visibilidad para todo el comité. ADR 0003 (decisión 2) dejó para C-02 cómo modelar una excepción `change_start` cuando la unidad está congelada. Además faltaban reglas para corregir y revocar excepciones y para limitar su vigencia.

## Decisión
1. **`change_start` en `frozen` es un inicio puntual autorizado.** `evaluateEscalation` devuelve `authorizedStarts: [{ id, change_ref }]`. Las restricciones, el nivel y `appliedExceptions` no cambian: el congelamiento sigue. En `restricted`, `change_start` sigue quitando `no_new_change` (igual que en C-01). Solo `scope: 'all'` suspende todo.
2. **Columna nueva `exceptions.change_ref`** (texto, máximo 200 caracteres). Es obligatoria al crear una `change_start`. Las filas anteriores a C-02 que no la tienen se pueden acortar o revocar.
3. **Se revoca, no se borra.** Columnas nuevas `revoked_at` y `revoked_by`. Las fija el servidor con `now()` y `auth.uid()`. No hay DELETE. Una excepción revocada ya no se edita. El motor la ignora desde la fecha de revocación (`revokedOn <= asOf`, fecha en America/Guayaquil) y la devuelve en `revokedExceptions`.
4. **Solo quien aprobó edita o revoca.** `approved_by`, `unit_id` y `created_at` no cambian. Ningún miembro del comité revoca la excepción de otro. Si el comité quiere que otro miembro pueda revocar (por ejemplo, cuando quien aprobó ya no está), se agrega luego como regla nueva.
5. **Tope de 90 días desde la creación**, en `private.exception_max_days()`. El valor solo se cambia con una migración. El motor lo replica en `EXCEPTION_MAX_DAYS`, y las pruebas de pgTAP y de `node:test` fijan el 90 en ambos lados. Acortar el vencimiento siempre se permite. Alargarlo respeta el tope.
6. **El trigger `private.enforce_exception_rules` solo actúa sobre `authenticated`.** El backend (`sb_secret_`) y las migraciones no pasan por él. RLS sigue siendo la primera barrera.
7. **El script que evalúa (Actions, `scripts/lib`) tiene que leer `change_ref` y `revoked_at`** y pasarlos al motor como `changeRef` y `revokedOn` (fecha de negocio con `businessDate`). Sin eso, una excepción revocada seguiría suspendiendo candados.

## Consecuencias
- Tablas: siguen siendo las 9 del diseño. Se agregan 3 columnas justificadas a `exceptions`.
- Las alertas `exception_expired` no deben salir para excepciones revocadas: vuelven a regir los candados por la revocación, no por el vencimiento.
- Hay dos copias del valor 90 (SQL y motor), y las pruebas cuidan que sean iguales. Si cambia, se tocan los dos lados en el mismo PR.
