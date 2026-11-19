// Ayudante mínimo para construir DOM sin innerHTML: el texto siempre va por textContent.
// H-F05-02: los atributos on* solo aceptan funciones (se registran como listener,
// nunca como atributo de texto) y los atributos de URL solo aceptan http, https,
// anclas (#) o rutas relativas.

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
const ATTR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9:._-]*$/;

/** true si la URL es http(s), un ancla (#...) o una ruta relativa (sin esquema). */
export function isSafeUrl(value) {
  // Los navegadores ignoran espacios y caracteres de control al leer el esquema.
  // eslint-disable-next-line no-control-regex
  const v = String(value).replace(/[\u0000- \u007f-\u009f]/g, '');
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v);
  if (!scheme) return true; // relativa, ancla o protocolo-relativa
  return ['http', 'https'].includes(scheme[1].toLowerCase());
}

/**
 * Comprueba un atributo antes de asignarlo. Lanza Error si no es seguro.
 * @returns {'listener'|'text'|'attr'}
 */
export function checkProp(key, value) {
  if (key === 'text') return 'text';
  if (!ATTR_NAME_RE.test(key)) throw new Error(`Atributo no permitido: ${key}`);
  if (/^on/i.test(key)) {
    if (typeof value !== 'function') throw new Error(`El atributo ${key} solo acepta una función`);
    return 'listener';
  }
  if (URL_ATTRS.has(key.toLowerCase()) && !isSafeUrl(value)) {
    throw new Error(`URL no permitida en ${key}`);
  }
  return 'attr';
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    const kind = checkProp(key, value);
    if (kind === 'text') node.textContent = String(value);
    else if (kind === 'listener') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
