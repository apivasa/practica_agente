// QA V-07: utilidades ZIP/OOXML para las pruebas, independientes del lector
// bajo prueba (engine/zip.js, engine/xlsx.js). Usan node:zlib.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('./', import.meta.url));
export const fixture = (name) => readFileSync(new URL(`./${name}`, import.meta.url));

const enc = new TextEncoder();

let table;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Lee un ZIP (métodos 0 y 8) → { nombre: Buffer }. */
export function unzip(bytes) {
  const buf = Buffer.from(bytes);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('sin EOCD');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < total; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const loc = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 0 ? Buffer.from(data) : inflateRawSync(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/**
 * Arma un ZIP. files: { nombre: string|Buffer }.
 * opts.store: sin compresión; opts.descriptor: bit 3 (tamaños y CRC en un
 * descriptor tras los datos, como los escritores en streaming).
 */
export function zip(files, { store = false, descriptor = false } = {}) {
  const parts = [];
  const cen = [];
  let off = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const raw = files[name];
    const data = typeof raw === 'string' ? Buffer.from(enc.encode(raw)) : Buffer.from(raw);
    const comp = store ? data : deflateRawSync(data);
    const n = Buffer.from(enc.encode(name));
    const crc = crc32(data);
    const flags = 0x0800 | (descriptor ? 0x8 : 0);
    const method = store ? 0 : 8;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(flags, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt16LE(0x21, 12);
    if (!descriptor) { loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(data.length, 22); }
    loc.writeUInt16LE(n.length, 26);
    const chunks = [loc, n, comp];
    if (descriptor) {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(comp.length, 8); dd.writeUInt32LE(data.length, 12);
      chunks.push(dd);
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    parts.push(...chunks);
    cen.push(c, n);
    off += chunks.reduce((s, b) => s + b.length, 0);
  }
  const cd = Buffer.concat(cen);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(names.length, 8); e.writeUInt16LE(names.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colLetter = (i) => String.fromCharCode(65 + i);

/**
 * Filas OOXML para insertar en <sheetData>. Valores:
 * string → inlineStr; number → numérico; boolean → t="b"; { serial } → número
 * con estilo de fecha s="1" si se pide; { xml } → celda literal.
 */
export function rowsXml(rows, firstRow = 2) {
  return rows.map((cells, r) => {
    const n = firstRow + r;
    const body = cells.map((v, i) => {
      const ref = `${colLetter(i)}${n}`;
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      if (typeof v === 'object' && 'xml' in v) return v.xml.replace('{ref}', ref);
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${n}">${body}</row>`;
  }).join('');
}

/** Rellena una plantilla (bytes .xlsx) con filas en la primera hoja (xl/worksheets/sheet1.xml). */
export function fillTemplate(templateBytes, rows) {
  const files = unzip(templateBytes);
  const path = 'xl/worksheets/sheet1.xml';
  const sheet = files[path].toString('utf8');
  if (!sheet.includes('</sheetData>')) throw new Error('plantilla sin </sheetData>');
  files[path] = sheet.replace('</sheetData>', `${rowsXml(rows)}</sheetData>`);
  return zip(files);
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PREL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * .xlsx mínimo con estructura de Excel (styles.xml, sharedStrings, docProps)
 * a partir del XML de <sheetData>. opts: date1904, strict (OOXML estricto),
 * sharedStrings (arreglo de <si> literales), extraFiles, descriptor, store.
 */
export function workbook(sheetData, opts = {}) {
  const ns = opts.strict ? 'http://purl.oclc.org/ooxml/spreadsheetml/main' : NS;
  const rel = opts.strict ? 'http://purl.oclc.org/ooxml/officeDocument/relationships' : REL;
  const ss = opts.sharedStrings ?? [];
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PREL}"><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>`
      + `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'docProps/app.xml': '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${rel}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x15">`
      + `<fileVersion appName="xl" lastEdited="7"/><workbookPr${opts.date1904 ? ' date1904="1"' : ''} defaultThemeVersion="166925"/>`
      + '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews>'
      + '<sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>',
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PREL}">`
      + `<Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId4" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/>`
      + `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>`
      + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
      + '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${ns}" count="${ss.length}" uniqueCount="${ss.length}">${ss.join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}" xmlns:r="${rel}"`
      + ' xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac">'
      + '<dimension ref="A1:C3"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>'
      + `<sheetData>${sheetData}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
    ...(opts.extraFiles ?? {}),
  };
  return zip(files, { store: opts.store, descriptor: opts.descriptor });
}
