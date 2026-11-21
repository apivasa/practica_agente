// Importación de mediciones desde Excel .xlsx (V-07, Q-02). Puro: el .xlsx es
// un ZIP con XML; aquí se lee la estructura (workbook, relaciones, sharedStrings,
// primera hoja, tipos de celda, fechas de serie) y se pasa a las MISMAS reglas,
// columnas y límites del CSV (`validateMeasurementRecords`, ADR 0010 punto 5).
// La descompresión DEFLATE la inyecta el llamador (ver engine/zip.js).
//
// Reglas propias del Excel:
// - Se lee solo la primera hoja del libro (orden de <sheets> en workbook.xml).
// - Una celda con fórmula (<f>) o con error de Excel (#N/A, #DIV/0!...) se
//   rechaza con su fila y columna; no se usa el valor calculado.
// - En la columna `fecha`, un número es una fecha de serie de Excel y se
//   convierte a AAAA-MM-DD (sistema 1900 o 1904 según el libro). La serie es
//   una fecha de calendario local (America/Guayaquil): se calcula en UTC sin
//   desplazamiento horario y se descarta la hora, así el resultado no depende
//   de la zona del navegador.
// - Números en otras columnas se escriben como en el CSV (punto decimal).
// - Booleanos de Excel: VERDADERO → "true", FALSO → "false".
import { CSV_MAX_BYTES, normalizeHeader, validateMeasurementRecords } from './measurements-input.js';
import { parseXml, XmlError, firstChild, childElements, attrByLocal, textContent, localName } from './xml.js';
import { listZipEntries, readZipEntry, looksLikeZip, buildStoredZip, ZipError } from './zip.js';

export const XLSX_MAX_BYTES = CSV_MAX_BYTES;
/** Tope de bytes descomprimidos por parte (hoja, sharedStrings...). */
export const XLSX_MAX_PART_BYTES = 8 * 1024 * 1024;
/** Tope de bytes descomprimidos entre todas las partes leídas. */
export const XLSX_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** Columnas como máximo con datos en la hoja. */
export const XLSX_MAX_COLUMNS = 50;
const EXCEL_MAX_ROW = 1048576;
const MAX_LISTED_CELL_ERRORS = 50;

export class XlsxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XlsxError';
  }
}

const DAY_MS = 86400000;
const EPOCH_1900 = Date.UTC(1899, 11, 30); // serie 0 con el error del 29-feb-1900 compensado
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const MAX_SERIAL = 2958465; // 9999-12-31

/**
 * Fecha de serie de Excel → 'YYYY-MM-DD', o null si no es una fecha válida.
 * Sistema 1900: 1 = 1900-01-01; 60 es el inexistente 29-feb-1900 (null).
 * Sistema 1904: 0 = 1904-01-01. La parte decimal (hora) se descarta.
 */
export function excelSerialToIsoDate(serial, date1904 = false) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
  const day = Math.floor(serial);
  let ms;
  if (date1904) {
    if (day < 0 || day > MAX_SERIAL - 1462) return null;
    ms = EPOCH_1904 + day * DAY_MS;
  } else {
    if (day < 1 || day > MAX_SERIAL || day === 60) return null;
    ms = (day < 60 ? EPOCH_1900 + DAY_MS : EPOCH_1900) + day * DAY_MS;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/** Índice 0-based de la columna de una referencia ('A1' → 0, 'AB7' → 27), o -1. */
export function columnIndex(ref) {
  const m = /^([A-Z]{1,3})(\d{1,7})?$/.exec(String(ref ?? '').toUpperCase());
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Letra(s) de columna para mensajes (0 → 'A'). */
export function columnLetter(index) {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Escapes OOXML `_xHHHH_` (caracteres de control guardados por Excel). */
export function decodeOoxmlEscapes(s) {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Texto de un <si> o <is>: <t> directo o runs <r><t>; ignora fonética <rPh>. */
function richText(node) {
  let out = '';
  for (const c of childElements(node)) {
    const n = localName(c.name);
    if (n === 't') out += textContent(c);
    else if (n === 'r') for (const t of childElements(c, 't')) out += textContent(t);
  }
  return decodeOoxmlEscapes(out);
}

/** sharedStrings.xml → arreglo de textos. */
export function parseSharedStrings(xml) {
  const root = rootOf(parseXml(xml), 'sst');
  return childElements(root, 'si').map(richText);
}

/** Relaciones (.rels) → Map Id → { target, type, external }. */
export function parseRelationships(xml) {
  const root = rootOf(parseXml(xml), 'Relationships');
  const map = new Map();
  for (const r of childElements(root, 'Relationship')) {
    const id = r.attrs.Id;
    if (typeof id !== 'string') continue;
    map.set(id, { target: r.attrs.Target ?? '', type: r.attrs.Type ?? '', external: r.attrs.TargetMode === 'External' });
  }
  return map;
}

/** workbook.xml → { firstSheetRelId, date1904 }. */
export function parseWorkbook(xml) {
  const root = rootOf(parseXml(xml), 'workbook');
  const pr = firstChild(root, 'workbookPr');
  const flag = pr ? attrByLocal(pr, 'date1904') : undefined;
  const sheets = firstChild(root, 'sheets');
  const first = sheets ? childElements(sheets, 'sheet')[0] : undefined;
  const relId = first ? attrByLocal(first, 'id') : undefined;
  if (!relId) throw new XlsxError('El libro de Excel no tiene hojas');
  return { firstSheetRelId: relId, date1904: flag === '1' || flag === 'true' };
}

function rootOf(doc, expected) {
  const root = childElements(doc)[0];
  if (!root || localName(root.name) !== expected) throw new XlsxError('El archivo Excel está dañado (estructura inesperada)');
  return root;
}

/** Resuelve el destino de una relación relativo a la carpeta de la parte de origen. */
export function resolvePartPath(baseDir, target) {
  const raw = target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`;
  const out = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/');
}

const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);
const relsPathOf = (path) => `${dirOf(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;

/**
 * Celdas de una hoja.
 * @returns {{ line: number, cells: { col: number, kind: string, value: string }[] }[]}
 *   kind: string | number | bool | date | formula | error | empty
 */
export function parseSheet(xml, sharedStrings = []) {
  const root = rootOf(parseXml(xml), 'worksheet');
  const data = firstChild(root, 'sheetData');
  if (!data) return [];
  const rows = [];
  let prevRow = 0;
  for (const rowNode of childElements(data, 'row')) {
    const rAttr = rowNode.attrs.r;
    const line = rAttr === undefined ? prevRow + 1 : Number(rAttr);
    if (!Number.isInteger(line) || line <= prevRow || line > EXCEL_MAX_ROW) throw new XlsxError('El archivo Excel está dañado (filas fuera de orden)');
    prevRow = line;
    const cells = [];
    let prevCol = -1;
    for (const c of childElements(rowNode, 'c')) {
      const col = c.attrs.r === undefined ? prevCol + 1 : columnIndex(c.attrs.r);
      if (col < 0 || col <= prevCol) throw new XlsxError('El archivo Excel está dañado (celdas fuera de orden)');
      prevCol = col;
      const cell = readCell(c, sharedStrings);
      if (cell.kind === 'empty') continue;
      if (col >= XLSX_MAX_COLUMNS) throw new XlsxError(`La hoja tiene datos en más de ${XLSX_MAX_COLUMNS} columnas`);
      cells.push({ col, ...cell });
    }
    if (cells.length) rows.push({ line, cells });
  }
  return rows;
}

function readCell(c, sharedStrings) {
  if (firstChild(c, 'f')) return { kind: 'formula', value: '' };
  const t = c.attrs.t ?? 'n';
  const v = firstChild(c, 'v');
  const raw = v ? textContent(v) : '';
  switch (t) {
    case 's': {
      if (!/^\d+$/.test(raw) || Number(raw) >= sharedStrings.length) throw new XlsxError('El archivo Excel está dañado (texto compartido inexistente)');
      const s = sharedStrings[Number(raw)];
      return s === '' ? { kind: 'empty', value: '' } : { kind: 'string', value: s };
    }
    case 'inlineStr': {
      const is = firstChild(c, 'is');
      const s = is ? richText(is) : decodeOoxmlEscapes(raw);
      return s === '' ? { kind: 'empty', value: '' } : { kind: 'string', value: s };
    }
    case 'str':
      return raw === '' ? { kind: 'empty', value: '' } : { kind: 'string', value: decodeOoxmlEscapes(raw) };
    case 'b':
      if (raw === '') return { kind: 'empty', value: '' };
      return { kind: 'bool', value: raw === '1' || raw === 'true' ? 'true' : 'false' };
    case 'e':
      return { kind: 'error', value: raw };
    case 'd':
      return raw === '' ? { kind: 'empty', value: '' } : { kind: 'date', value: raw };
    case 'n':
      return raw === '' ? { kind: 'empty', value: '' } : { kind: 'number', value: raw };
    default:
      throw new XlsxError('El archivo Excel está dañado (tipo de celda desconocido)');
  }
}

/** Texto de un número de celda, con punto decimal y sin notación científica innecesaria. */
function numberText(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw.trim();
  const s = String(n);
  return /e/i.test(s) ? raw.trim() : s;
}

/**
 * Lee la primera hoja de un .xlsx.
 * @param {Uint8Array} bytes
 * @param {(data: Uint8Array, maxBytes: number) => Promise<Uint8Array>} inflate
 * @returns {Promise<{ rows: ReturnType<typeof parseSheet>, date1904: boolean }>}
 *   Lanza XlsxError / ZipError / XmlError con mensaje en español.
 */
export async function readFirstSheet(bytes, inflate) {
  if (!(bytes instanceof Uint8Array)) throw new XlsxError('El archivo no se pudo leer');
  if (bytes.length > XLSX_MAX_BYTES) throw new XlsxError('El archivo supera 1 MB');
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new XlsxError('Es un Excel antiguo (.xls) o un archivo protegido; guárdalo como libro de Excel .xlsx sin contraseña');
  }
  if (!looksLikeZip(bytes)) throw new XlsxError('El archivo no es un libro de Excel .xlsx válido');

  const entries = listZipEntries(bytes);
  let budget = XLSX_MAX_TOTAL_BYTES;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const readText = async (path, required = true) => {
    const entry = path === null ? undefined : entries.get(path);
    if (!entry) {
      if (required) throw new XlsxError('El archivo no es un libro de Excel .xlsx válido (falta una parte interna)');
      return null;
    }
    const out = await readZipEntry(bytes, entry, inflate, Math.min(XLSX_MAX_PART_BYTES, budget));
    budget -= out.length;
    try {
      return decoder.decode(out);
    } catch {
      throw new XlsxError('El archivo Excel está dañado (texto no UTF-8)');
    }
  };

  // Libro principal: por _rels/.rels o la ruta estándar.
  let workbookPath = 'xl/workbook.xml';
  const rootRels = await readText('_rels/.rels', false);
  if (rootRels !== null) {
    const doc = [...parseRelationships(rootRels).values()].find((r) => r.type.endsWith('/officeDocument') && !r.external);
    if (doc) workbookPath = resolvePartPath('', doc.target) ?? workbookPath;
  }
  const workbook = parseWorkbook(await readText(workbookPath));
  const rels = parseRelationships(await readText(relsPathOf(workbookPath)));
  const sheetRel = rels.get(workbook.firstSheetRelId);
  if (!sheetRel || sheetRel.external || !sheetRel.type.endsWith('/worksheet')) {
    throw new XlsxError('La primera hoja del libro no es una hoja de cálculo (¿es un gráfico?)');
  }
  const sheetPath = resolvePartPath(dirOf(workbookPath), sheetRel.target);

  const ssRel = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings') && !r.external);
  const ssPath = ssRel ? resolvePartPath(dirOf(workbookPath), ssRel.target) : null;
  const ssXml = await readText(ssPath, false);
  const shared = ssXml === null ? [] : parseSharedStrings(ssXml);

  const rows = parseSheet(await readText(sheetPath), shared);
  return { rows, date1904: workbook.date1904 };
}

/**
 * Lee y valida un .xlsx de mediciones con las reglas del CSV. No guarda nada.
 * @param {Uint8Array} bytes contenido del archivo
 * @param {object} indicator configuración del motor
 * @param {{ units: {id: string, name: string}[], today?: string }} ctx
 * @param {(data: Uint8Array, maxBytes: number) => Promise<Uint8Array>} inflate descompresor deflate-raw con tope
 * @returns {Promise<{ rows: object[], errors: { row: number|null, message: string }[] }>}
 */
export async function parseMeasurementsXlsx(bytes, indicator, ctx, inflate) {
  const fileError = (message) => ({ rows: [], errors: [{ row: null, message }] });
  let sheet;
  try {
    sheet = await readFirstSheet(bytes, inflate);
  } catch (err) {
    if (err instanceof XlsxError || err instanceof ZipError) return fileError(err.message);
    if (err instanceof XmlError) return fileError(`El archivo Excel no se pudo leer: ${err.message}`);
    return fileError('El archivo Excel no se pudo leer');
  }
  const { rows, date1904 } = sheet;
  if (rows.length === 0) return fileError('El archivo está vacío');

  // Fórmulas y errores de Excel: se rechazan antes de validar.
  const cellErrors = [];
  for (const r of rows) {
    for (const c of r.cells) {
      if (c.kind === 'formula') cellErrors.push({ row: r.line, message: `Columna ${columnLetter(c.col)}: la celda tiene una fórmula; no se aceptan fórmulas, copia y pega solo los valores` });
      else if (c.kind === 'error') cellErrors.push({ row: r.line, message: `Columna ${columnLetter(c.col)}: la celda tiene un error de Excel (${c.value.slice(0, 20)})` });
    }
  }
  if (cellErrors.length) {
    const listed = cellErrors.slice(0, MAX_LISTED_CELL_ERRORS);
    if (cellErrors.length > listed.length) listed.push({ row: null, message: `… y ${cellErrors.length - listed.length} celdas más con fórmula o error` });
    return { rows: [], errors: listed };
  }

  const [headerRow, ...dataRows] = rows;
  const width = Math.max(...headerRow.cells.map((c) => c.col)) + 1;
  const toText = (c) => (c.kind === 'number' ? numberText(c.value) : c.value);
  const header = new Array(width).fill('');
  for (const c of headerRow.cells) header[c.col] = toText(c);
  const dateCol = header.map(normalizeHeader).indexOf('fecha');

  const records = [{ line: headerRow.line, cells: header }];
  for (const r of dataRows) {
    const maxCol = Math.max(...r.cells.map((c) => c.col));
    const cells = new Array(Math.max(width, maxCol + 1)).fill('');
    for (const c of r.cells) {
      if (c.col === dateCol && c.kind === 'number') {
        cells[c.col] = excelSerialToIsoDate(Number(c.value), date1904) ?? numberText(c.value);
      } else if (c.col === dateCol && c.kind === 'date') {
        cells[c.col] = /^\d{4}-\d{2}-\d{2}/.test(c.value) ? c.value.slice(0, 10) : c.value;
      } else {
        cells[c.col] = toText(c);
      }
    }
    records.push({ line: r.line, cells });
  }
  return validateMeasurementRecords(records, indicator, ctx);
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const escapeXml = (s) => String(s).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]);

/**
 * Plantilla .xlsx mínima: una hoja "Mediciones" con la cabecera en la fila 1.
 * Si Excel convierte lo escrito en `fecha` a fecha, se importa igual (serie).
 * @param {string[]} columns
 * @returns {Uint8Array}
 */
export function buildXlsxTemplate(columns) {
  const enc = new TextEncoder();
  const cells = columns.map((name, i) => `<c r="${columnLetter(i)}1" t="inlineStr"><is><t>${escapeXml(name)}</t></is></c>`).join('');
  const files = {
    '[Content_Types].xml': `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>',
    '_rels/.rels': `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">`
      + `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
      + '<sheets><sheet name="Mediciones" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">`
      + `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `${XML_DECL}<worksheet xmlns="${NS_MAIN}">`
      + `<sheetData><row r="1">${cells}</row></sheetData></worksheet>`,
  };
  return buildStoredZip(Object.entries(files).map(([name, text]) => ({ name, data: enc.encode(text) })));
}
