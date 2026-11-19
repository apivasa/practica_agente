// H-1 (V-01..V-03): el paginador lee todas las páginas aunque PostgREST corte en max_rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAllPages, PAGE_SIZE } from '../../src/lib/paginate.js';

/** Fuente falsa que, como PostgREST, devuelve como mucho `maxRows` filas por respuesta. */
function fakeSource(total, maxRows = PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null };
  };
  return { fetchPage, calls };
}
const onError = (e) => { throw new Error(`fallo: ${e.message}`); };

test('lee más de 1000 filas en páginas de 1000 sin perder ni repetir', async () => {
  const { fetchPage, calls } = fakeSource(2500);
  const out = await readAllPages(fetchPage, { onError });
  assert.equal(out.length, 2500);
  assert.deepEqual(out.map((r) => r.id), Array.from({ length: 2500 }, (_, i) => i));
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('múltiplo exacto del tamaño de página: una petición extra vacía y para', async () => {
  const { fetchPage, calls } = fakeSource(2000);
  assert.equal((await readAllPages(fetchPage, { onError })).length, 2000);
  assert.equal(calls.length, 3);
});

test('vacío y menos de una página: una sola petición', async () => {
  for (const n of [0, 5]) {
    const { fetchPage, calls } = fakeSource(n);
    assert.equal((await readAllPages(fetchPage, { onError })).length, n);
    assert.equal(calls.length, 1);
  }
});

test('data null cuenta como página vacía', async () => {
  assert.deepEqual(await readAllPages(async () => ({ data: null, error: null }), { onError }), []);
});

test('un error en cualquier página se propaga por onError (no devuelve datos parciales)', async () => {
  let n = 0;
  const fetchPage = async () => (++n === 2 ? { data: null, error: { message: 'x' } } : { data: new Array(3).fill({}), error: null });
  await assert.rejects(readAllPages(fetchPage, { pageSize: 3, onError }), /fallo: x/);
});

test('tamaño de página inválido se rechaza', async () => {
  await assert.rejects(readAllPages(async () => ({ data: [] }), { pageSize: 0, onError }), TypeError);
});
