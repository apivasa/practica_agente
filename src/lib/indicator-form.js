// Lógica pura del formulario de indicadores (M-02) y conversiones entre la
// fila de la BD y la configuración del motor. Sin DOM ni red.
import { validateIndicator } from '../../engine/index.js';

export const CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;

export const TYPE_LABELS = Object.freeze({
  window_average: 'Promedio en ventana',
  coverage: 'Cobertura',
  cumulative_target: 'Meta acumulada',
});
export const DIRECTION_LABELS = Object.freeze({
  higher_is_better: 'Más es mejor',
  lower_is_better: 'Menos es mejor',
});
export const FREQUENCY_LABELS = Object.freeze({ monthly: 'Mensual', weekly: 'Semanal', quarterly: 'Trimestral' });
export const SOURCE_LABELS = Object.freeze({ manual: 'Manual', automatic: 'Automática' });

// Nombres de campo del motor -> etiquetas de la pantalla.
const FIELD_LABELS = [
  ['thresholdsByCategory.', 'Umbral de la categoría '],
  ['thresholds.green', 'Umbral verde'],
  ['thresholds.yellow', 'Umbral amarillo'],
  ['thresholds', 'Umbrales'],
  ['measurementType', 'Tipo de medición'],
  ['direction', 'Sentido'],
  ['windowDays', 'Ventana (días)'],
  ['frequency', 'Frecuencia'],
  ['minSample', 'Mínimo de muestra'],
  ['source', 'Fuente'],
];

/** Traduce un mensaje de validateIndicator a etiquetas de la pantalla. */
export function humanizeEngineError(message) {
  const s = String(message);
  for (const [field, label] of FIELD_LABELS) {
    if (s.startsWith(field)) return label + s.slice(field.length);
  }
  return s;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Fila de `indicators` (BD) -> configuración del motor. */
export function toEngineIndicator(row) {
  const byCat = {};
  const src = row?.thresholds_by_category;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [cat, t] of Object.entries(src)) {
      if (cat === '__proto__') continue;
      byCat[cat] = { green: num(t?.green), yellow: num(t?.yellow) };
    }
  }
  return {
    measurementType: row?.measurement_type,
    direction: row?.direction,
    windowDays: row?.window_days ?? undefined,
    thresholds: { green: num(row?.green_threshold), yellow: num(row?.yellow_threshold) },
    thresholdsByCategory: byCat,
    frequency: row?.frequency ?? undefined,
    minSample: row?.min_sample ?? undefined,
    source: row?.source ?? undefined,
  };
}

/** Texto de un campo numérico del formulario -> número, o NaN si no es número. */
export function parseNumberField(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}

/**
 * Valida los valores del formulario y arma la fila para la BD.
 * @param {object} values valores de texto del formulario:
 *   code, name, description, measurement_type, direction, window_days, green, yellow,
 *   categories: [{ name, green, yellow }], frequency, min_sample, source, active
 * @returns {{ ok: true, row: object } | { ok: false, errors: string[] }}
 */
export function buildIndicatorRow(values) {
  const errors = [];
  const code = String(values?.code ?? '').trim();
  const name = String(values?.name ?? '').trim();
  if (!CODE_RE.test(code)) errors.push('Código: obligatorio, solo letras, números, guion y guion bajo (máx. 40)');
  if (!name) errors.push('Nombre: obligatorio');
  if (name.length > 120) errors.push('Nombre: máximo 120 caracteres');
  const description = String(values?.description ?? '').trim();
  if (description.length > 500) errors.push('Descripción: máximo 500 caracteres');

  const intField = (text, label) => {
    const n = parseNumberField(text);
    if (n === null) return undefined;
    if (!Number.isInteger(n)) { errors.push(`${label}: debe ser un número entero`); return undefined; }
    return n;
  };
  const numField = (text, label) => {
    const n = parseNumberField(text);
    if (n === null) { errors.push(`${label}: obligatorio`); return undefined; }
    if (Number.isNaN(n)) { errors.push(`${label}: debe ser un número`); return undefined; }
    return n;
  };

  const windowDays = intField(values?.window_days, 'Ventana (días)');
  const minSample = intField(values?.min_sample, 'Mínimo de muestra');
  const green = numField(values?.green, 'Umbral verde');
  const yellow = numField(values?.yellow, 'Umbral amarillo');

  const byCat = {};
  const seen = new Set();
  for (const [i, c] of (values?.categories ?? []).entries()) {
    const cat = String(c?.name ?? '').trim();
    const g = String(c?.green ?? '').trim();
    const y = String(c?.yellow ?? '').trim();
    if (!cat && !g && !y) continue; // fila vacía del editor
    if (!/^[A-Za-z0-9_/ -]{1,50}$/.test(cat) || cat === '__proto__') {
      errors.push(`Categoría ${i + 1}: nombre obligatorio (letras, números, espacio, / _ -; máx. 50)`);
      continue;
    }
    if (seen.has(cat.toLowerCase())) { errors.push(`Categoría ${cat}: repetida`); continue; }
    seen.add(cat.toLowerCase());
    const gn = numField(g, `Categoría ${cat}, verde`);
    const yn = numField(y, `Categoría ${cat}, amarillo`);
    if (gn !== undefined && yn !== undefined) byCat[cat] = { green: gn, yellow: yn };
  }
  if (errors.length) return { ok: false, errors };

  const cfg = {
    measurementType: values?.measurement_type,
    direction: values?.direction,
    windowDays,
    thresholds: { green, yellow },
    thresholdsByCategory: byCat,
    frequency: values?.frequency || undefined,
    minSample,
    source: values?.source || undefined,
  };
  const v = validateIndicator(cfg);
  if (!v.ok) return { ok: false, errors: v.errors.map(humanizeEngineError) };

  return {
    ok: true,
    row: {
      code,
      name,
      description: description || null,
      measurement_type: cfg.measurementType,
      direction: cfg.direction,
      window_days: windowDays ?? 30,
      green_threshold: green,
      yellow_threshold: yellow,
      thresholds_by_category: byCat,
      frequency: cfg.frequency ?? 'monthly',
      min_sample: minSample ?? 0,
      source: cfg.source ?? 'manual',
      active: values?.active !== false,
    },
  };
}

/** Fila de la BD -> valores de texto del formulario. */
export function formValuesFromRow(row) {
  const cats = Object.entries(row?.thresholds_by_category ?? {})
    .filter(([k]) => k !== '__proto__')
    .map(([name, t]) => ({ name, green: String(t?.green ?? ''), yellow: String(t?.yellow ?? '') }));
  return {
    code: row?.code ?? '',
    name: row?.name ?? '',
    description: row?.description ?? '',
    measurement_type: row?.measurement_type ?? 'window_average',
    direction: row?.direction ?? 'higher_is_better',
    window_days: String(row?.window_days ?? 30),
    green: row ? String(row.green_threshold ?? '') : '',
    yellow: row ? String(row.yellow_threshold ?? '') : '',
    categories: cats,
    frequency: row?.frequency ?? 'monthly',
    min_sample: String(row?.min_sample ?? 0),
    source: row?.source ?? 'manual',
    active: row ? row.active !== false : true,
    custodian_user_id: row?.custodian_user_id ?? '',
  };
}

/**
 * Candidatos a custodio: usuarios con al menos una fila role=custodian en
 * user_roles. Etiqueta con los códigos de los indicadores que ya custodian
 * (la API no expone correos de auth.users).
 * @returns {{ userId: string, label: string }[]}
 */
export function custodianCandidates(userRoles, indicators) {
  const codeById = new Map((indicators ?? []).map((i) => [i.id, i.code]));
  const byUser = new Map();
  for (const r of userRoles ?? []) {
    if (r?.role !== 'custodian' || typeof r.user_id !== 'string') continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    const code = codeById.get(r.indicator_id);
    if (code) byUser.get(r.user_id).push(code);
  }
  return [...byUser.entries()]
    .map(([userId, codes]) => ({
      userId,
      label: `${codes.length ? codes.sort().join(', ') : 'sin indicadores'} · usuario ${userId.slice(0, 8)}…${userId.slice(-4)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Coherencia ADR 0005: indicators.custodian_user_id (informativo) y las filas
 * custodian de user_roles (dan permisos) deben coincidir.
 * @returns {string[]} ids de indicadores incoherentes
 */
export function incoherentCustodians(indicators, userRoles) {
  const holders = new Map();
  for (const r of userRoles ?? []) {
    if (r?.role !== 'custodian') continue;
    if (!holders.has(r.indicator_id)) holders.set(r.indicator_id, new Set());
    holders.get(r.indicator_id).add(r.user_id);
  }
  return (indicators ?? [])
    .filter((i) => {
      const set = holders.get(i.id) ?? new Set();
      if (!i.custodian_user_id) return set.size > 0;
      return set.size !== 1 || !set.has(i.custodian_user_id);
    })
    .map((i) => i.id);
}

/**
 * Pasos para dejar a `userId` como único custodio del indicador (o ninguno).
 * Orden "falla cerrado": primero se quitan permisos, luego se conceden y al
 * final se actualiza la columna informativa.
 * @returns {{ removeRoleIds: string[], addRole: boolean, setColumn: string|null }}
 */
export function custodianAssignmentPlan(indicatorId, userId, userRoles) {
  const current = (userRoles ?? []).filter((r) => r?.role === 'custodian' && r.indicator_id === indicatorId);
  const target = userId || null;
  return {
    removeRoleIds: current.filter((r) => r.user_id !== target).map((r) => r.id),
    addRole: Boolean(target) && !current.some((r) => r.user_id === target),
    setColumn: target,
  };
}
