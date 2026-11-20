// V-04 — Fuga de información del workflow de salud (categorías 5 y 8).
// El repo es público: el issue y los logs no pueden llevar claves, URL de Supabase,
// cuerpos de respuesta ni datos de unidades; las entradas a issue.js se sanean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main as checkMain } from '../../scripts/health/check.js';
import { issueBody, parseFailures, safeUrl, checkHttp } from '../../scripts/health/lib.js';

const KEY = 'sb_publishable_TESTKEY0123456789abcdef';
const SUPA = 'https://abcdefghijklmnop.supabase.co';
const SECRETISH = /sb_publishable_|sb_secret_|abcdefghijklmnop|supabase\.co|unidad|eyJ/i;

function fakeFetch(status, bodyText = 'cuerpo con unidad A y token eyJhbGciOi') {
  return async () => new Response(bodyText, { status });
}

async function run(env, fetchImpl) {
  const lines = [];
  const out = await checkMain({ argv: ['--only=availability'], env, fetchImpl, log: (s) => lines.push(s), sleep: async () => {}, delayMs: 0 });
  return { ...out, text: lines.join('\n') + JSON.stringify(out.results) };
}

const base = { EVALUATION_ENABLED: 'true', PAGES_URL: 'https://example.invalid/', SUPABASE_URL: SUPA, SUPABASE_PUBLISHABLE_KEY: KEY };

test('logs y resultados no contienen la clave, la URL de Supabase ni el cuerpo (200, 500, error de red)', async () => {
  for (const f of [fakeFetch(200), fakeFetch(500), async () => { throw new TypeError(`fetch failed ${SUPA}?apikey=${KEY}`); }]) {
    const { text } = await run(base, f);
    assert.doesNotMatch(text, SECRETISH, text);
  }
});

test('clave mal formada o secreta: falla sin mostrar el valor', async () => {
  for (const k of ['sb_secret_ZZZ999', 'eyJhbGciOiJIUzI1NiJ9.x.y', '']) {
    const { text, results } = await run({ ...base, SUPABASE_PUBLISHABLE_KEY: k }, fakeFetch(200));
    assert.equal(results.find((r) => r.check === 'supabase').status, 'fail');
    if (k) assert.ok(!text.includes(k), 'el valor de la clave aparece en el log');
  }
});

test('la clave solo viaja a la URL de Supabase y por cabecera, nunca en la query', async () => {
  const calls = [];
  await run(base, async (url, init) => { calls.push({ url: String(url), headers: init?.headers ?? {} }); return new Response('', { status: 200 }); });
  for (const c of calls) assert.ok(!c.url.includes(KEY), 'clave en la URL');
  const withKey = calls.filter((c) => Object.values(c.headers).includes(KEY));
  assert.ok(withKey.length >= 1);
  for (const c of withKey) assert.ok(c.url.startsWith(`${SUPA}/`), `clave enviada a ${c.url}`);
});

test('safeUrl: rechaza http remoto, file:, javascript: y data:', () => {
  for (const u of ['http://evil.example/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x/']) {
    assert.equal(safeUrl(u), null, u);
  }
  assert.ok(safeUrl('http://127.0.0.1:54321'));
});

test('checkHttp: el detalle no incluye el mensaje del error (podría llevar la URL)', async () => {
  const r = await checkHttp({ check: 'x', url: SUPA, fetchImpl: async () => { throw new Error(`boom ${SUPA}`); }, attempts: 1, sleep: async () => {} });
  assert.doesNotMatch(r.detail, SECRETISH);
});

test('parseFailures descarta inyección markdown/menciones/saltos de línea', () => {
  const raw = 'pages,@apivasa,`x`,[a](https://evil),supabase\nRun: https://evil,ci-main,' + 'a'.repeat(41);
  assert.deepEqual(parseFailures(raw), ['pages', 'ci-main']);
});

test('issueBody: solo nombres de check, hora y run de github.com; RUN_URL ajena se descarta', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  for (const runUrl of ['https://evil.example/actions/runs/1', 'https://github.com/a/b/actions/runs/1?token=x', 'javascript:alert(1)', undefined]) {
    const b = issueBody({ failures: ['pages'], runUrl, now });
    assert.match(b, /enlace no disponible/);
    assert.doesNotMatch(b, /evil|token|javascript/);
  }
  const ok = issueBody({ failures: parseFailures('pages,supabase'), runUrl: 'https://github.com/o/r/actions/runs/42', now });
  assert.doesNotMatch(ok, SECRETISH);
  assert.doesNotMatch(ok, /@\w/, 'sin menciones');
});
