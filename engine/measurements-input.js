// Captura de mediciones (M-04): validación de una medición escrita a mano y
// parser de CSV propio, sin dependencias. Funciones puras: las usa el front
// (vista previa antes de guardar) y pueden usarlas las Actions.
//
// Formato CSV (primera fila = cabecera, separador "," o ";"):
//   window_average:     fecha,unidad,valor
//   coverage:           fecha,unidad,app_id,cumple
//   cumulative_target:  fecha,unidad,valor,categoria[,tipo]
// `unidad` es el nombre de la unidad (sin distinguir mayúsculas) o su id.
// En cumulative_target `valor` es INCREMENTAL (lo resuelto o detectado en esa
// fecha); el motor suma las mediciones de la ventana.
import { MEASUREMENT_TYPES } from './indicator.js';
import { parseDay } from './measure.js';
import { isSafeMagnitude, SAFE_ABS_LIMIT_TEXT } from './numeric.js';

export const CSV_MAX_BYTES = 1024 * 1024;
export const CSV_MAX_ROWS = 5000;

/** Columnas por tipo de medición: obligatorias y opcionales. */
export const CSV_COLUMNS = Object.freeze({
  window_average: { required: ['fecha', 'unidad', 'valor'], optional: [] },
  coverage: { required: ['fecha', 'unidad', 'app_id', 'cumple'], optional: [] },
  cumulative_target: { required: ['fecha', 'unidad', 'valor'], optional: ['categoria', 'tipo'] },
});

const KIND_ALIASES = Object.freeze({
  resolved: 'resolved', resuelta: 'resolved', resueltas: 'resolved', resuelto: 'resolved',
  detected: 'detected', detectada: 'detected', detectadas: 'detected', detectado: 'detected',
});
const TRUE_VALUES = ['si', 'sí', 'true', '1', 'cumple', 'yes'];
const FALSE_VALUES = ['no', 'false', '0', 'no cumple'];

// Inyección de fórmulas (CSV/Excel): celdas que empiezan con = + - @, tabulador
// o retorno de carro se rechazan (no se escapan ni se guardan).
const FORMULA_RE = /^[=+\-@\t\r]/;
const NUMBER_RE = /^\d+(?:[.,]\d+)?$/;
const INTEGER_RE = /^\d+$/;
const APP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const CATEGORY_MAX = 50;

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** true si la celda podría interpretarse como fórmula en una hoja de cálculo. */
export function isFormulaLike(cell) {
  return typeof cell === 'string' && FORMULA_RE.test(cell);
}

/** Longitud en bytes UTF-8 de un texto. */
function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * Tokenizador CSV (RFC 4180): comillas dobles, "" como comilla escapada,
 * saltos de línea dentro de comillas, CRLF o LF.
 * @returns {{ records: { line: number, cells: string[] }[], error?: { row: number, message: string } }}
 */
export function tokenizeCsv(text, delimiter = ',') {
  const records = [];
  let cells = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let quotedCell = false;

  const endCell = () => { cells.push(cell); cell = ''; quotedCell = false; };
  const endRecord = () => {
    endCell();
    // Línea en blanco (una sola celda vacía, sin comillas) = se ignora.
    if (!(cells.length === 1 && cells[0] === '')) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell === '' && !quotedCell) { inQuotes = true; quotedCell = true; continue; }
      return { records, error: { row: recordLine, message: 'Comilla doble fuera de lugar: encierra toda la celda entre comillas' } };
    }
    if (ch === delimiter) { endCell(); continue; }
    if (ch === '\r' && text[i + 1] === '\n') continue;
    if (ch === '\n' || ch === '\r') {
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    cell += ch;
  }
  if (inQuotes) return { records, error: { row: recordLine, message: 'Comillas sin cerrar' } };
  endRecord();
  return { records };
}

/** Separador: ";" si la cabecera lo usa y no tiene ","; si no, ",". */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
}

/** Nombre de columna normalizado: minúsculas, sin tildes, espacios como _. */
export function normalizeHeader(h) {
  return h.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

/** Mapa de unidades por id y por nombre normalizado. */
function unitIndex(units) {
  const byKey = new Map();
  for (const u of Array.isArray(units) ? units : []) {
    if (!u || typeof u.id !== 'string') continue;
    byKey.set(u.id.toLowerCase(), u.id);
    if (typeof u.name === 'string') byKey.set(u.name.trim().toLowerCase(), u.id);
  }
  return byKey;
}

function categoriesOf(indicator) {
  const t = indicator?.thresholdsByCategory;
  if (!t || typeof t !== 'object') return [];
  return Object.keys(t).filter((k) => k !== '__proto__');
}

/**
 * Valida una medición con sus campos como texto (formulario o fila de CSV).
 * @param {object} indicator configuración del motor ({ measurementType, thresholdsByCategory })
 * @param {Record<string, string|undefined>} fields fecha, unidad, valor, app_id, cumple, categoria, tipo
 * @param {{ units: {id: string, name: string}[], today?: string }} ctx
 *   today: 'YYYY-MM-DD' (America/Guayaquil); si se da, se rechazan fechas futuras.
 * @returns {{ ok: true, row: object } | { ok: false, errors: { field: string, message: string }[] }}
 *   row: { date, unitId, value, appId, compliant, category, kind }
 */
export function validateMeasurementInput(indicator, fields, ctx = {}) {
  const type = indicator?.measurementType;
  if (!MEASUREMENT_TYPES.includes(type)) {
    return { ok: false, errors: [{ field: 'indicador', message: 'El indicador no tiene un tipo de medición válido' }] };
  }
  const errors = [];
  const err = (field, message) => errors.push({ field, message });
  const get = (k) => {
    const v = fields && hasOwn(fields, k) ? fields[k] : undefined;
    return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
  };
  const raw = {};
  for (const k of ['fecha', 'unidad', 'valor', 'app_id', 'cumple', 'categoria', 'tipo']) {
    raw[k] = get(k);
    if (isFormulaLike(raw[k])) {
      err(k, `${k}: la celda empieza con =, +, -, @ o un carácter de control (posible fórmula); no se acepta`);
      raw[k] = null;
    }
  }

  const row = { date: null, unitId: null, value: null, appId: null, compliant: null, category: null, kind: null };

  if (raw.fecha !== null) {
    if (!raw.fecha) err('fecha', 'fecha: obligatoria (AAAA-MM-DD)');
    else if (parseDay(raw.fecha) === null) err('fecha', `fecha: "${raw.fecha}" no es una fecha real con formato AAAA-MM-DD`);
    else if (Number(raw.fecha.slice(0, 4)) < 2000) err('fecha', 'fecha: anterior al año 2000');
    else if (ctx.today && parseDay(ctx.today) !== null && parseDay(raw.fecha) > parseDay(ctx.today)) err('fecha', `fecha: ${raw.fecha} es futura`);
    else row.date = raw.fecha;
  }

  if (raw.unidad !== null) {
    const idx = unitIndex(ctx.units);
    if (!raw.unidad) err('unidad', 'unidad: obligatoria');
    else if (!idx.has(raw.unidad.toLowerCase())) err('unidad', `unidad: "${raw.unidad}" no existe`);
    else row.unitId = idx.get(raw.unidad.toLowerCase());
  }

  if (type === 'window_average' || type === 'cumulative_target') {
    if (raw.valor !== null) {
      const integer = type === 'cumulative_target';
      if (!raw.valor) err('valor', 'valor: obligatorio');
      else if (integer && !INTEGER_RE.test(raw.valor)) err('valor', `valor: "${raw.valor}" debe ser un entero mayor o igual que 0`);
      else if (!integer && !NUMBER_RE.test(raw.valor)) err('valor', `valor: "${raw.valor}" debe ser un número mayor o igual que 0`);
      else {
        const n = Number(raw.valor.replace(',', '.'));
        // M-13: mismo tope que la BD (|v| < 2^53) para todas las mediciones.
        if (!isSafeMagnitude(n) || (integer && !Number.isSafeInteger(n))) {
          err('valor', `valor: fuera de rango, debe ser ${SAFE_ABS_LIMIT_TEXT}`);
        } else row.value = n;
      }
    }
  }

  if (type === 'coverage') {
    if (raw.app_id !== null) {
      if (!raw.app_id) err('app_id', 'app_id: obligatorio (identificador de la aplicación)');
      else if (!APP_ID_RE.test(raw.app_id)) err('app_id', 'app_id: solo letras, números y . _ : / - (máx. 100)');
      else row.appId = raw.app_id;
    }
    if (raw.cumple !== null) {
      const c = raw.cumple.toLowerCase();
      if (TRUE_VALUES.includes(c)) row.compliant = true;
      else if (FALSE_VALUES.includes(c)) row.compliant = false;
      else err('cumple', `cumple: "${raw.cumple}" debe ser sí o no`);
    }
  }

  if (type === 'cumulative_target') {
    const cats = categoriesOf(indicator);
    if (raw.categoria !== null) {
      if (cats.length > 0) {
        const found = cats.find((c) => c.toLowerCase() === raw.categoria.toLowerCase());
        if (!raw.categoria) err('categoria', `categoria: obligatoria (${cats.join(', ')})`);
        else if (!found) err('categoria', `categoria: "${raw.categoria}" no es una de ${cats.join(', ')}`);
        else row.category = found;
      } else if (raw.categoria) {
        if (raw.categoria.length > CATEGORY_MAX) err('categoria', `categoria: máximo ${CATEGORY_MAX} caracteres`);
        else row.category = raw.categoria;
      }
    }
    if (raw.tipo !== null) {
      const k = raw.tipo.toLowerCase();
      if (!k) row.kind = 'resolved';
      else if (hasOwn(KIND_ALIASES, k)) row.kind = KIND_ALIASES[k];
      else err('tipo', `tipo: "${raw.tipo}" debe ser resuelta o detectada`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, row };
}

/**
 * Lee y valida un CSV de mediciones de un indicador. No guarda nada: el
 * llamador guarda `rows` solo si `errors` está vacío.
 * @param {string} text contenido del archivo
 * @param {object} indicator configuración del motor
 * @param {{ units: {id: string, name: string}[], today?: string }} ctx
 * @returns {{ rows: object[], errors: { row: number|null, message: string }[] }}
 *   row: número de fila del archivo (1 = cabecera); null = error del archivo.
 */
export function parseMeasurementsCsv(text, indicator, ctx = {}) {
  const fileError = (message) => ({ rows: [], errors: [{ row: null, message }] });
  if (typeof text !== 'string') return fileError('El archivo no se pudo leer como texto');
  if (utf8Length(text) > CSV_MAX_BYTES) return fileError('El archivo supera 1 MB');
  const type = indicator?.measurementType;
  if (!hasOwn(CSV_COLUMNS, type)) return fileError('El indicador no tiene un tipo de medición válido');

  const clean = text.replace(/^\uFEFF/, '');
  if (!clean.trim()) return fileError('El archivo está vacío');
  const { records, error } = tokenizeCsv(clean, detectDelimiter(clean));
  if (error) return { rows: [], errors: [error] };
  return validateMeasurementRecords(records, indicator, ctx);
}

/**
 * Valida registros ya leídos de un archivo (CSV o Excel): la primera fila es la
 * cabecera. Comparte reglas, límites y mensajes entre ambos formatos (V-07).
 * @param {{ line: number, cells: string[] }[]} records
 * @returns {{ rows: object[], errors: { row: number|null, message: string }[] }}
 */
export function validateMeasurementRecords(records, indicator, ctx = {}) {
  const fileError = (message) => ({ rows: [], errors: [{ row: null, message }] });
  const type = indicator?.measurementType;
  if (!hasOwn(CSV_COLUMNS, type)) return fileError('El indicador no tiene un tipo de medición válido');
  if (!Array.isArray(records) || records.length === 0) return fileError('El archivo está vacío');

  const [header, ...data] = records;
  const cols = header.cells.map(normalizeHeader);
  const spec = CSV_COLUMNS[type];
  const allowed = [...spec.required, ...spec.optional];
  const errors = [];
  const missing = spec.required.filter((c) => !cols.includes(c));
  if (missing.length) errors.push({ row: header.line, message: `Cabecera: faltan columnas ${missing.join(', ')} (esperadas: ${allowed.join(', ')})` });
  const unknown = cols.filter((c) => !allowed.includes(c));
  if (unknown.length) errors.push({ row: header.line, message: `Cabecera: columnas no reconocidas ${unknown.join(', ')}` });
  const dup = cols.filter((c, i) => cols.indexOf(c) !== i);
  if (dup.length) errors.push({ row: header.line, message: `Cabecera: columnas repetidas ${[...new Set(dup)].join(', ')}` });
  if (errors.length) return { rows: [], errors };

  if (data.length === 0) return fileError('El archivo no tiene filas de datos');
  if (data.length > CSV_MAX_ROWS) return fileError(`El archivo tiene ${data.length} filas; el máximo es ${CSV_MAX_ROWS}`);

  const rows = [];
  for (const rec of data) {
    if (rec.cells.length !== cols.length) {
      errors.push({ row: rec.line, message: `Tiene ${rec.cells.length} columnas y la cabecera ${cols.length}` });
      continue;
    }
    const fields = Object.create(null);
    cols.forEach((c, i) => { fields[c] = rec.cells[i]; });
    // Columnas opcionales ausentes de la cabecera: vacías.
    for (const c of allowed) if (!(c in fields)) fields[c] = '';
    const res = validateMeasurementInput(indicator, { ...fields }, ctx);
    if (res.ok) rows.push({ ...res.row, line: rec.line });
    else errors.push({ row: rec.line, message: res.errors.map((e) => e.message).join('; ') });
  }
  return { rows: errors.length ? [] : rows, errors };
}
