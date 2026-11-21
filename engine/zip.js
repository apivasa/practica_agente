// Lectura y escritura mínima de ZIP para .xlsx (V-07). Puro, sin dependencias.
// La descompresión DEFLATE la inyecta el llamador (`inflate`): en el front es
// `DecompressionStream('deflate-raw')` (src/lib/inflate.js); en pruebas puede
// ser zlib. Así el motor no depende del entorno.
//
// Defensas (zip bombs y archivos manipulados):
// - Solo métodos 0 (sin compresión) y 8 (deflate); sin cifrado ni ZIP64.
// - Tope de entradas y nombres repetidos rechazados.
// - Tope de bytes descomprimidos por entrada, comprobado contra el tamaño
//   declarado ANTES de descomprimir y contra el real DESPUÉS (el `inflate`
//   también debe cortar al superar el tope, que es min(tope, tamaño declarado));
//   el tamaño real debe coincidir con el declarado y el CRC-32 debe cuadrar.

export const ZIP_MAX_ENTRIES = 1000;

export class ZipError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

let CRC_TABLE = null;
/** CRC-32 (IEEE 802.3) de unos bytes. */
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const damaged = (detail) => new ZipError(`El archivo Excel está dañado o no es un .xlsx (${detail})`);

/** true si los bytes empiezan como un ZIP (PK\x03\x04). */
export function looksLikeZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Lee el directorio central de un ZIP.
 * @param {Uint8Array} bytes
 * @returns {Map<string, { name, method, flags, crc, compressedSize, size, dataStart }>}
 */
export function listZipEntries(bytes) {
  if (!(bytes instanceof Uint8Array)) throw damaged('no son bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.length;
  if (len < 22) throw damaged('demasiado corto');

  let eocd = -1;
  const stop = Math.max(0, len - 22 - 0xffff);
  for (let p = len - 22; p >= stop; p--) {
    if (view.getUint32(p, true) === SIG_EOCD) { eocd = p; break; }
  }
  if (eocd === -1) throw damaged('sin directorio central');
  const disk = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const entriesHere = view.getUint16(eocd + 8, true);
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('El archivo Excel usa un formato ZIP64 no soportado', 'unsupported');
  }
  if (disk !== 0 || cdDisk !== 0 || entriesHere !== total) throw damaged('ZIP en varias partes');
  if (total > ZIP_MAX_ENTRIES) throw new ZipError(`El archivo Excel tiene demasiadas partes internas (${total})`, 'limit');
  if (cdOffset + cdSize > eocd) throw damaged('directorio central fuera de rango');

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries = new Map();
  let p = cdOffset;
  for (let k = 0; k < total; k++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== SIG_CEN) throw damaged('entrada del directorio inválida');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (p + 46 + nameLen > eocd) throw damaged('nombre fuera de rango');
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new ZipError('El archivo Excel está cifrado o protegido con contraseña; guárdalo sin contraseña', 'unsupported');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('El archivo Excel usa un formato ZIP64 no soportado', 'unsupported');
    }
    if (entries.has(name)) throw damaged('partes internas repetidas');

    if (localOffset + 30 > len || view.getUint32(localOffset, true) !== SIG_LOC) throw damaged('cabecera local inválida');
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > len) throw damaged('datos fuera de rango');
    entries.set(name, { name, method, flags, crc, compressedSize, size, dataStart });
  }
  return entries;
}

/**
 * Descomprime una entrada con tope de bytes.
 * @param {Uint8Array} bytes el ZIP completo
 * @param {{ method, crc, compressedSize, size, dataStart }} entry
 * @param {(data: Uint8Array, maxBytes: number) => Promise<Uint8Array>} inflate
 * @param {number} maxBytes
 */
export async function readZipEntry(bytes, entry, inflate, maxBytes) {
  if (entry.size > maxBytes) throw new ZipError('El archivo Excel es demasiado grande al descomprimirlo', 'limit');
  const data = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let out;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw damaged('tamaño inconsistente');
    out = data.slice();
  } else if (entry.method === 8) {
    if (typeof inflate !== 'function') throw new ZipError('No hay descompresor disponible en este navegador', 'unsupported');
    // H-V07-01: el tope es el tamaño declarado si es menor: una entrada que
    // declara 2 KB no se descomprime más allá de 2 KB (+ lo que entregue el
    // último bloque del descompresor).
    const cap = Math.min(maxBytes, entry.size);
    try {
      out = await inflate(data, cap);
    } catch (err) {
      if (err?.code === 'limit' && cap < maxBytes) throw new ZipError('El archivo Excel está dañado: es demasiado grande al descomprimirlo (supera el tamaño declarado)', 'invalid');
      if (err?.code === 'limit') throw new ZipError('El archivo Excel es demasiado grande al descomprimirlo', 'limit');
      if (err?.code === 'unsupported') throw new ZipError(String(err.message), 'unsupported');
      throw damaged('no se pudo descomprimir');
    }
    if (!(out instanceof Uint8Array)) throw damaged('no se pudo descomprimir');
    if (out.length > maxBytes) throw new ZipError('El archivo Excel es demasiado grande al descomprimirlo', 'limit');
  } else {
    throw new ZipError('El archivo Excel usa una compresión no soportada', 'unsupported');
  }
  if (out.length !== entry.size) throw damaged('tamaño distinto al declarado');
  if (crc32(out) !== entry.crc) throw damaged('CRC incorrecto');
  return out;
}

/**
 * Arma un ZIP sin compresión (método 0). Para la plantilla .xlsx.
 * @param {{ name: string, data: Uint8Array }[]} files
 * @returns {Uint8Array}
 */
export function buildStoredZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const loc = new Uint8Array(30 + name.length);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, SIG_LOC, true);
    lv.setUint16(4, 20, true); // versión necesaria
    lv.setUint16(6, 0x0800, true); // nombres en UTF-8
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); // hora
    lv.setUint16(12, 0x21, true); // fecha 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    loc.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, SIG_CEN, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);

    locals.push(loc, f.data);
    centrals.push(cen);
    offset += loc.length + f.data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) { out.set(part, p); p += part.length; }
  return out;
}
