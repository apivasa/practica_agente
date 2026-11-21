// Descompresión deflate-raw con tope de bytes (V-07), para las partes de un
// .xlsx. Usa la API nativa DecompressionStream: sin dependencias, sin red.
// Corta la lectura en cuanto la salida supera `maxBytes` (protección contra
// zip bombs): no se llega a descomprimir el resto.

/**
 * @param {Uint8Array} data bytes comprimidos (deflate sin cabecera)
 * @param {number} maxBytes tope de bytes de salida
 * @returns {Promise<Uint8Array>}
 * @throws Error con `code === 'limit'` si la salida supera el tope.
 */
export async function inflateRaw(data, maxBytes) {
  if (typeof DecompressionStream !== 'function') {
    throw Object.assign(new Error('Este navegador no puede leer archivos Excel; usa CSV o actualiza el navegador'), { code: 'unsupported' });
  }
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error('Contenido descomprimido demasiado grande'), { code: 'limit' });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
