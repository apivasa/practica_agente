// Lógica pura de la captura de mediciones (M-04). Sin DOM ni red.

/** Campos que pide el formulario según el tipo de medición. */
export function fieldsForType(measurementType) {
  if (measurementType === 'coverage') return ['fecha', 'unidad', 'app_id', 'cumple'];
  if (measurementType === 'cumulative_target') return ['fecha', 'unidad', 'valor', 'categoria', 'tipo'];
  return ['fecha', 'unidad', 'valor'];
}

/** Fila validada por el motor -> columnas de measurements. */
export function toMeasurementRow(indicatorId, r) {
  return {
    indicator_id: indicatorId,
    unit_id: r.unitId,
    measured_on: r.date,
    value: r.value,
    app_id: r.appId,
    compliant: r.compliant,
    category: r.category,
    kind: r.kind,
    source: 'manual',
  };
}

/** Texto corto de una medición guardada para la tabla de recientes. */
export function describeMeasurement(m) {
  if (m.app_id) return `${m.app_id}: ${m.compliant ? 'cumple' : 'no cumple'}`;
  const parts = [String(m.value ?? '')];
  if (m.category) parts.push(m.category);
  if (m.kind) parts.push(m.kind === 'detected' ? 'detectada' : 'resuelta');
  return parts.join(' · ');
}
