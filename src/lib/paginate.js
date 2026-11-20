// Paginador puro (sin red): lee todas las páginas de una consulta de PostgREST, que corta
// cada respuesta en max_rows (1000 por defecto en Supabase) sin avisar. Lo usa
// src/data/client.js (allPages); se prueba con node:test.
export const PAGE_SIZE = 1000;

/**
 * @param {(from: number, to: number) => Promise<{ data: any[] | null, error: any }>} fetchPage
 *   pide las filas [from, to] (ambas incluidas) de una consulta con orden total
 * @param {{ pageSize?: number, onError: (error: any) => never }} opts
 * @returns {Promise<any[]>}
 */
export async function readAllPages(fetchPage, { pageSize = PAGE_SIZE, onError }) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new TypeError('pageSize debe ser un entero positivo');
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) onError(error);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
