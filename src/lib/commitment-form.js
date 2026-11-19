// Lógica pura del formulario de compromisos (M-03). Sin DOM ni red.
import { validateCommitment, packageTotal } from '../../engine/index.js';
import { parseNumberField } from './indicator-form.js';

/**
 * Valida los valores del formulario y arma los campos editables del compromiso.
 * @param {object} indicator configuración del motor
 * @param {object} values { period, green, yellow, packages: { [cat]: texto }, notes }
 * @returns {{ ok: true, fields: object } | { ok: false, errors: string[] }}
 */
export function buildCommitmentFields(indicator, values) {
  const errors = [];
  const period = String(values?.period ?? '').trim().toUpperCase();
  const g = parseNumberField(values?.green);
  const y = parseNumberField(values?.yellow);
  if (Number.isNaN(g)) errors.push('Umbral verde negociado: debe ser un número');
  if (Number.isNaN(y)) errors.push('Umbral amarillo negociado: debe ser un número');

  let pkg = null;
  if (indicator?.measurementType === 'cumulative_target') {
    const entries = Object.entries(values?.packages ?? {}).filter(([, t]) => String(t ?? '').trim() !== '');
    if (entries.length) {
      pkg = {};
      for (const [cat, text] of entries) {
        const n = parseNumberField(text);
        if (!Number.isInteger(n) || n < 0) errors.push(`Paquete de ${cat}: debe ser un entero mayor o igual que 0`);
        else pkg[cat] = n;
      }
    }
  }
  const notes = String(values?.notes ?? '').trim();
  if (notes.length > 500) errors.push('Notas: máximo 500 caracteres');
  if (errors.length) return { ok: false, errors };

  const commitment = { period, greenOverride: g, yellowOverride: y, packageByCategory: pkg };
  const v = validateCommitment(indicator, commitment);
  if (!v.ok) return { ok: false, errors: v.errors };
  return {
    ok: true,
    fields: {
      period,
      green_override: g,
      yellow_override: y,
      package_by_category: pkg,
      package_total: packageTotal(pkg),
      notes: notes || null,
    },
  };
}
