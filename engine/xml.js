// Lector XML mínimo y defensivo para las partes de un .xlsx (V-07). Puro, sin
// dependencias ni DOM: corre igual en el navegador y en node:test.
//
// Defensas contra XML malicioso:
// - Se rechaza cualquier <!DOCTYPE ...> o <!ENTITY ...>: no hay entidades
//   propias, así que no hay "billion laughs" ni entidades externas (XXE).
// - Solo se decodifican las 5 entidades predefinidas y referencias numéricas
//   válidas; cualquier otra entidad es un error.
// - Tope de elementos y de profundidad; atributos repetidos son un error.
// - Los atributos se guardan en objetos sin prototipo (sin __proto__).

export const XML_MAX_ELEMENTS = 400000;
export const XML_MAX_DEPTH = 64;

export class XmlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XmlError';
  }
}

const PREDEFINED = Object.freeze({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });
const NAME_RE = /^[A-Za-z_][\w.:-]*$/;
const ATTR_RE = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

/** Decodifica entidades XML. Lanza XmlError ante entidades desconocidas o mal formadas. */
export function decodeEntities(s) {
  let idx = s.indexOf('&');
  if (idx === -1) return s;
  let out = '';
  let from = 0;
  while (idx !== -1) {
    const semi = s.indexOf(';', idx);
    if (semi === -1 || semi - idx > 12) throw new XmlError('XML mal formado: "&" sin entidad válida');
    const ent = s.slice(idx + 1, semi);
    let ch;
    if (ent[0] === '#') {
      const hex = ent[1] === 'x' || ent[1] === 'X';
      const digits = ent.slice(hex ? 2 : 1);
      if (!(hex ? /^[0-9A-Fa-f]{1,6}$/ : /^\d{1,7}$/).test(digits)) throw new XmlError(`XML mal formado: referencia &${ent};`);
      const cp = parseInt(digits, hex ? 16 : 10);
      if (cp < 1 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new XmlError(`XML mal formado: carácter &${ent};`);
      ch = String.fromCodePoint(cp);
    } else if (Object.prototype.hasOwnProperty.call(PREDEFINED, ent)) {
      ch = PREDEFINED[ent];
    } else {
      throw new XmlError(`XML no permitido: entidad &${ent.slice(0, 20)};`);
    }
    out += s.slice(from, idx) + ch;
    from = semi + 1;
    idx = s.indexOf('&', from);
  }
  return out + s.slice(from);
}

/**
 * Lee un documento XML a un árbol simple:
 *   { name, attrs, children: (nodo | string)[] }
 * La raíz devuelta es un nodo '#document' cuyo único elemento es el raíz real.
 * @param {string} text
 * @param {{ maxElements?: number, maxDepth?: number, onClose?: (node: object, stack: object[]) => void }} [limits]
 *   onClose: se llama al cerrarse cada elemento (también los autocerrados) con
 *   el nodo y la pila de ancestros (`stack.at(-1)` es el padre). Puede lanzar
 *   para cortar el análisis o quitar el nodo del padre para liberar memoria
 *   (V-07b: la hoja se procesa fila a fila y se corta al pasar del tope).
 */
export function parseXml(text, { maxElements = XML_MAX_ELEMENTS, maxDepth = XML_MAX_DEPTH, onClose } = {}) {
  if (typeof text !== 'string') throw new XmlError('XML: el contenido no es texto');
  const n = text.length;
  const doc = { name: '#document', attrs: Object.create(null), children: [] };
  const stack = [doc];
  let count = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const pushText = (raw) => {
    const top = stack[stack.length - 1];
    if (top === doc) {
      if (raw.trim()) throw new XmlError('XML mal formado: texto fuera del elemento raíz');
      return;
    }
    if (raw) top.children.push(decodeEntities(raw));
  };

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) { pushText(text.slice(i)); break; }
    if (lt > i) pushText(text.slice(i, lt));

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) throw new XmlError('XML mal formado: comentario sin cerrar');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) throw new XmlError('XML mal formado: CDATA sin cerrar');
      if (stack.length === 1) throw new XmlError('XML mal formado: CDATA fuera del elemento raíz');
      stack[stack.length - 1].children.push(text.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (text[lt + 1] === '!') throw new XmlError('XML no permitido: contiene DOCTYPE o declaraciones de entidades');
    if (text[lt + 1] === '?') {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) throw new XmlError('XML mal formado: instrucción sin cerrar');
      i = end + 2;
      continue;
    }
    if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt + 2);
      if (end === -1) throw new XmlError('XML mal formado: etiqueta de cierre sin ">"');
      const name = text.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (stack.length === 0 || top.name !== name) throw new XmlError('XML mal formado: etiquetas que no cierran en orden');
      if (onClose) onClose(top, stack);
      i = end + 1;
      continue;
    }

    // Etiqueta de apertura: busca ">" fuera de comillas.
    let j = lt + 1;
    let quote = null;
    for (; j < n; j++) {
      const c = text[j];
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      else if (c === '<') throw new XmlError('XML mal formado: "<" dentro de una etiqueta');
    }
    if (j >= n) throw new XmlError('XML mal formado: etiqueta sin cerrar');
    let inner = text.slice(lt + 1, j);
    let selfClosing = false;
    if (inner.endsWith('/')) { selfClosing = true; inner = inner.slice(0, -1); }
    const m = /^[^\s/>]+/.exec(inner);
    if (!m || !NAME_RE.test(m[0])) throw new XmlError('XML mal formado: nombre de etiqueta inválido');
    const name = m[0];
    const attrs = Object.create(null);
    let pos = name.length;
    ATTR_RE.lastIndex = pos;
    let a;
    while ((a = ATTR_RE.exec(inner)) !== null) {
      const key = a[1];
      if (!NAME_RE.test(key)) throw new XmlError('XML mal formado: nombre de atributo inválido');
      if (key in attrs) throw new XmlError('XML mal formado: atributo repetido');
      attrs[key] = decodeEntities(a[2] ?? a[3] ?? '');
      pos = ATTR_RE.lastIndex;
    }
    if (inner.slice(pos).trim()) throw new XmlError('XML mal formado: atributos inválidos');

    if (++count > maxElements) throw new XmlError('El archivo es demasiado complejo (demasiados elementos XML)');
    if (stack.length === 1 && doc.children.length > 0) throw new XmlError('XML mal formado: más de un elemento raíz');
    const node = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push(node);
      if (stack.length - 1 > maxDepth) throw new XmlError('El archivo es demasiado complejo (anidamiento XML excesivo)');
    } else if (onClose) onClose(node, stack);
    i = j + 1;
  }
  if (stack.length !== 1) throw new XmlError('XML mal formado: elementos sin cerrar');
  if (doc.children.length === 0) throw new XmlError('XML vacío');
  return doc;
}

/** Nombre local (sin prefijo de espacio de nombres). */
export const localName = (name) => name.slice(name.indexOf(':') + 1);

/** Hijos elemento con ese nombre local. */
export function childElements(node, name) {
  return node.children.filter((c) => typeof c !== 'string' && (name === undefined || localName(c.name) === name));
}

/** Primer hijo elemento con ese nombre local, o null. */
export function firstChild(node, name) {
  return node.children.find((c) => typeof c !== 'string' && localName(c.name) === name) ?? null;
}

/** Valor de un atributo por nombre local (ignora el prefijo), o undefined. */
export function attrByLocal(node, name) {
  if (name in node.attrs) return node.attrs[name];
  for (const k of Object.keys(node.attrs)) if (localName(k) === name) return node.attrs[k];
  return undefined;
}

/** Texto de un nodo y sus descendientes, concatenado. */
export function textContent(node) {
  let out = '';
  for (const c of node.children) out += typeof c === 'string' ? c : textContent(c);
  return out;
}
