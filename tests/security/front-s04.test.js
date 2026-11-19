// S-04 — Endurecimiento del front estático (categoría 4): CSP por <meta>,
// política de referer, anti-framing y recursos externos sin SRI. Pruebas
// estáticas sobre src/security/ y, si existe, sobre dist/index.html (en el job
// security-tests de seguridad.yml dist/ es obligatorio: SECURITY_REQUIRE_DIST=1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildCsp, supabaseOrigins, PRODUCTION_SUPABASE_ORIGIN, REFERRER_POLICY } from '../../src/security/csp.js';
import { isFramed, blockIfFramed } from '../../src/security/anti-framing.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const DIST_INDEX = join(ROOT, 'dist', 'index.html');
const requireDist = process.env.SECURITY_REQUIRE_DIST === '1';

const parse = (csp) =>
  Object.fromEntries(
    csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name, values];
    }),
  );

const PROD = PRODUCTION_SUPABASE_ORIGIN;
const PROD_WS = PROD.replace(/^https/, 'wss');

// ---------------------------------------------------------------------------
// Política generada
// ---------------------------------------------------------------------------
for (const [label, url] of [
  ['sin VITE_SUPABASE_URL', undefined],
  ['producción', `${PROD}/`],
  ['Supabase local', 'http://127.0.0.1:54321'],
]) {
  test(`4 · CSP (${label}): sin unsafe-inline/unsafe-eval/comodines en scripts`, () => {
    const d = parse(buildCsp(url));
    assert.deepEqual(d['script-src'], ["'self'"]);
    assert.deepEqual(d['default-src'], ["'none'"]);
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.deepEqual(d['base-uri'], ["'self'"]);
    assert.deepEqual(d['form-action'], ["'self'"]);
    assert.deepEqual(d['style-src'], ["'self'"]);
    const all = buildCsp(url);
    assert.doesNotMatch(all, /unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|strict-dynamic/);
    for (const [name, values] of Object.entries(d)) {
      for (const v of values) {
        assert.notEqual(v, '*', `${name} con comodín`);
        assert.doesNotMatch(v, /^\*|:\/\/\*|^(https?|wss?|blob|filesystem):$/, `${name} admite un esquema completo: ${v}`);
        // data: solo en img-src (iconos embebidos); nunca en scripts, estilos ni conexiones.
        if (name !== 'img-src') assert.notEqual(v, 'data:', `${name} admite data:`);
      }
    }
    // frame-ancestors en <meta> se ignora y genera ruido: no se declara (anti-framing por script).
    assert.equal(d['frame-ancestors'], undefined);
  });
}

test('4 · CSP: connect-src = self + proyecto Supabase del repo (https y wss)', () => {
  const d = parse(buildCsp(undefined));
  assert.deepEqual(d['connect-src'], ["'self'", PROD, PROD_WS]);
  assert.ok('upgrade-insecure-requests' in d, 'producción fuerza https');
  assert.deepEqual(parse(buildCsp(PROD))['connect-src'], ["'self'", PROD, PROD_WS]);
});

test('4 · CSP: el origen de bucle local solo entra si VITE_SUPABASE_URL lo pide', () => {
  const d = parse(buildCsp('http://127.0.0.1:54321'));
  assert.deepEqual(d['connect-src'], ["'self'", PROD, PROD_WS, 'http://127.0.0.1:54321', 'ws://127.0.0.1:54321']);
  assert.equal(d['upgrade-insecure-requests'], undefined, 'en local no se fuerza https (rompería localhost)');
  assert.doesNotMatch(buildCsp(undefined), /127\.0\.0\.1|localhost/);
  assert.doesNotMatch(buildCsp(PROD), /127\.0\.0\.1|localhost/);
});

for (const bad of [
  'https://evil.example',
  'https://otro-proyecto.supabase.co',
  'http://oehtspdtpwdhfhhhkgao.supabase.co',
  'https://oehtspdtpwdhfhhhkgao.supabase.co.evil.example',
  'http://10.0.0.5:54321',
  'http://127.0.0.1.evil.example:54321',
  'javascript:alert(1)',
  'no es una url',
]) {
  test(`4 · CSP: el build falla con VITE_SUPABASE_URL=${bad}`, () => {
    assert.throws(() => supabaseOrigins(bad), /CSP:/);
  });
}

test('4 · Referrer-Policy por meta: no-referrer', () => {
  assert.equal(REFERRER_POLICY, 'no-referrer');
  assert.match(read('index.html'), /<meta name="referrer" content="no-referrer"\s*\/?>/);
});

// ---------------------------------------------------------------------------
// Configuración de build y arranque
// ---------------------------------------------------------------------------
test('4 · vite.config.js inyecta la CSP en el build como primer elemento de <head>', () => {
  const cfg = read('vite.config.js');
  assert.match(cfg, /from '\.\/src\/security\/csp\.js'/);
  assert.match(cfg, /'http-equiv': 'Content-Security-Policy'/);
  assert.match(cfg, /injectTo: 'head-prepend'/);
  assert.match(cfg, /buildCsp\(/);
});

test('4 · main.js importa el anti-framing antes que cualquier otro módulo', () => {
  const imports = [...read('src/main.js').matchAll(/^import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.equal(imports[0], './security/anti-framing.js');
  assert.match(read('src/main.js'), /getElementById\('app'\)[\s\S]*if \(root\)/, 'main.js no arranca sin #app');
});

// ---------------------------------------------------------------------------
// Anti-framing con un window simulado
// ---------------------------------------------------------------------------
function fakeWindow({ framed, throwsOnTop = false }) {
  const body = { hidden: false, cleared: false, replaceChildren() { this.cleared = true; } };
  const win = { document: { body, documentElement: { hidden: false } } };
  win.self = win;
  Object.defineProperty(win, 'top', {
    get() {
      if (throwsOnTop) throw new Error('SecurityError');
      return framed ? {} : win;
    },
  });
  return win;
}

test('4 · anti-framing: sin marco no toca el documento', () => {
  const w = fakeWindow({ framed: false });
  assert.equal(isFramed(w), false);
  assert.equal(blockIfFramed(w), false);
  assert.equal(w.document.body.cleared, false);
  assert.equal(w.document.documentElement.hidden, false);
});

for (const opts of [{ framed: true }, { framed: true, throwsOnTop: true }]) {
  test(`4 · anti-framing: enmarcado${opts.throwsOnTop ? ' (top inaccesible)' : ''} vacía y oculta el documento`, () => {
    const w = fakeWindow(opts);
    assert.equal(isFramed(w), true);
    assert.equal(blockIfFramed(w), true);
    assert.equal(w.document.body.cleared, true);
    assert.equal(w.document.body.hidden, true);
    assert.equal(w.document.documentElement.hidden, true);
  });
}

// ---------------------------------------------------------------------------
// dist/index.html (build real)
// ---------------------------------------------------------------------------
test('4 · dist/index.html: CSP como primer elemento de <head>, antes de todo script', (t) => {
  if (!existsSync(DIST_INDEX)) {
    if (requireDist) assert.fail('SECURITY_REQUIRE_DIST=1 y no hay dist/index.html');
    t.skip('sin dist/ (se ejecuta en seguridad.yml › security-tests)');
    return;
  }
  const html = readFileSync(DIST_INDEX, 'utf8');
  const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const metas = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/gi)];
  assert.equal(metas.length, 1, 'una sola meta CSP');
  const firstTag = head.trim().match(/^<[^>]+>/)?.[0] ?? '';
  assert.match(firstTag, /http-equiv="Content-Security-Policy"/, 'la CSP debe ser el primer elemento');
  const csp = metas[0][1].replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const d = parse(csp);
  assert.deepEqual(d['script-src'], ["'self'"]);
  assert.ok(d['connect-src'].includes(PROD));
  for (const v of d['connect-src']) {
    assert.ok(["'self'", PROD, PROD_WS, 'http://127.0.0.1:54321', 'ws://127.0.0.1:54321'].includes(v), `connect-src inesperado: ${v}`);
  }
  assert.match(html, /<meta name="referrer" content="no-referrer"/);
});

test('4 · dist/index.html: sin scripts inline, sin manejadores inline, sin recursos externos sin SRI', (t) => {
  if (!existsSync(DIST_INDEX)) {
    if (requireDist) assert.fail('SECURITY_REQUIRE_DIST=1 y no hay dist/index.html');
    t.skip('sin dist/');
    return;
  }
  const html = readFileSync(DIST_INDEX, 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\bsrc=/, 'script inline en dist/index.html');
    assert.equal(m[2].trim(), '', 'script con cuerpo inline');
  }
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'manejador de evento inline');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'atributo style inline (style-src lo bloquearía)');
  for (const m of html.matchAll(/<(script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/gi)) {
    const ref = m[2];
    if (/^(https?:)?\/\//i.test(ref)) {
      assert.match(m[0], /\bintegrity="sha(256|384|512)-/, `recurso externo sin SRI: ${ref}`);
    } else {
      assert.match(ref, /^\/practica_agente\//, `recurso fuera de la base de Pages: ${ref}`);
    }
  }
});
