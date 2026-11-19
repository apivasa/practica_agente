// F-05 — Login y rutas por rol: pruebas estáticas de seguridad del front
// (categorías 2 y 4). El router del cliente NO es un control de acceso: la
// autorización real es RLS. Estas pruebas vigilan que el front no abra
// sumideros de XSS, no use claves privilegiadas y no filtre si un correo existe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  resolveRoute, roleForPath, distinctRoles, parseHash, LOGIN_PATH, ROLE_ROUTES,
} from '../../src/lib/route-logic.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const walk = (dir, ext) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(p) ? [p] : [];
  });
};
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p);
const srcJs = walk(SRC, /\.(js|mjs)$/);
const distText = walk(DIST, /\.(js|mjs|html|css|map|json|txt)$/);

// Patrones armados por partes para no ser falsos positivos de gitleaks/semgrep.
const HTML_SINKS = [
  ['innerHTML', new RegExp('\\.inner' + 'HTML\\b')],
  ['outerHTML', new RegExp('\\.outer' + 'HTML\\b')],
  ['insertAdjacentHTML', new RegExp('insertAdjacent' + 'HTML\\s*\\(')],
  ['document.write', new RegExp('document\\.write' + '(ln)?\\s*\\(')],
  ['createContextualFragment', new RegExp('createContextual' + 'Fragment\\s*\\(')],
  ['DOMParser.parseFromString', new RegExp('parseFrom' + 'String\\s*\\(')],
];
const CODE_EVAL = [
  ['eval', new RegExp('(^|[^.\\w])ev' + 'al\\s*\\(')],
  ['new Function', new RegExp('new\\s+Func' + 'tion\\s*\\(')],
  ['setTimeout/setInterval con string', new RegExp('set(Timeout|Interval)\\s*\\(\\s*[\'"`]')],
];
const PRIVILEGED = [
  ['clave secreta sb_secret_', new RegExp('sb_' + 'secret_')],
  ['service_role', new RegExp('service' + '_role')],
  ['variable de clave secreta', new RegExp('SUPABASE_' + '(SECRET|SERVICE_ROLE)_KEY')],
  ['JWT legado', new RegExp('ey' + 'J[A-Za-z0-9_-]{10,}\\.ey' + 'J[A-Za-z0-9_-]{10,}\\.')],
];

const hitsIn = (files, patterns) => {
  const hits = [];
  for (const f of files) {
    const text = read(f);
    for (const [label, re] of patterns) if (re.test(text)) hits.push(`${rel(f)}: ${label}`);
  }
  return hits;
};

test('autoverificación: los patrones detectan los sumideros y claves sembrados', () => {
  const samples = [
    'node.inner' + 'HTML = x', 'n.outer' + 'HTML=x', 'n.insertAdjacent' + 'HTML("beforeend", x)',
    'document.write' + '(x)', 'r.createContextual' + 'Fragment(x)', 'p.parseFrom' + 'String(x, "text/html")',
  ];
  samples.forEach((s, i) => assert.ok(HTML_SINKS[i][1].test(s), HTML_SINKS[i][0]));
  assert.ok(CODE_EVAL[0][1].test(' ev' + 'al(x)'));
  assert.ok(CODE_EVAL[1][1].test('new Func' + 'tion("x")'));
  assert.ok(CODE_EVAL[2][1].test("setTimeout('x()', 1)"));
  assert.ok(!CODE_EVAL[2][1].test('setTimeout(() => x(), 0)'));
  assert.ok(PRIVILEGED[0][1].test('sb_' + 'secret_abc'));
  assert.ok(PRIVILEGED[1][1].test('service' + '_role'));
  // El comentario de dom.js ("sin innerHTML") no es un uso.
  assert.ok(!HTML_SINKS[0][1].test('// sin inner' + 'HTML: el texto va por textContent'));
});

test('src/ existe y tiene código del front', () => {
  assert.ok(srcJs.length >= 5, `se esperaban archivos en src/, hay ${srcJs.length}`);
});

test('src/ no usa sumideros de HTML (innerHTML, outerHTML, insertAdjacentHTML, document.write…)', () => {
  assert.deepEqual(hitsIn(srcJs, HTML_SINKS), []);
});

test('src/ no evalúa código dinámico (eval, new Function, timers con string)', () => {
  assert.deepEqual(hitsIn(srcJs, CODE_EVAL), []);
});

test('src/ no menciona claves privilegiadas (sb_secret_, service_role, JWT legado)', () => {
  assert.deepEqual(hitsIn(srcJs, PRIVILEGED), []);
});

test('dist/ (si existe) no contiene claves privilegiadas', () => {
  if (distText.length === 0 && process.env.SECURITY_REQUIRE_DIST === '1') {
    assert.fail('SECURITY_REQUIRE_DIST=1 pero dist/ está vacío o no existe');
  }
  assert.deepEqual(hitsIn(distText, PRIVILEGED), []);
});

test('el front solo lee VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY del entorno', () => {
  const vars = new Set();
  for (const f of srcJs) {
    for (const m of read(f).matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) vars.add(m[1]);
  }
  const allowed = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'BASE_URL', 'DEV', 'PROD', 'MODE']);
  assert.deepEqual([...vars].filter((v) => !allowed.has(v)), []);
});

test('createClient se usa solo en src/lib/supabase.js y con la clave publicable', () => {
  const users = srcJs.filter((f) => /createClient\s*\(/.test(read(f)));
  assert.deepEqual(users.map(rel), ['src/lib/supabase.js']);
  const text = read(join(SRC, 'lib/supabase.js'));
  assert.match(text, /createClient\(\s*url\s*,\s*publishableKey\b/);
  assert.match(text, /publishableKey\s*=\s*import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/);
  // Sin tokens en la URL (evita fijación de sesión por enlace).
  assert.match(text, /detectSessionInUrl:\s*false/);
});

test('solo la capa lib/ habla con Supabase; las vistas no consultan datos', () => {
  const importers = srcJs.filter((f) => /from\s+['"][./]*(lib\/)?supabase\.js['"]/.test(read(f)) || /@supabase\/supabase-js/.test(read(f)));
  for (const f of importers) assert.match(rel(f), /^src\/(lib\/|main\.js$)/, `${rel(f)} importa Supabase`);
  const views = srcJs.filter((f) => rel(f).startsWith('src/views/'));
  for (const f of views) {
    const t = read(f);
    assert.ok(!/\.from\(\s*['"]/.test(t) && !/\.rpc\(/.test(t) && !/fetch\(/.test(t), `${rel(f)} consulta datos`);
  }
});

test('las únicas consultas de datos de F-05 son la lectura de user_roles (protegida por RLS)', () => {
  const tables = new Set();
  for (const f of srcJs) for (const m of read(f).matchAll(/\.from\(\s*['"]([a-z_]+)['"]/g)) tables.add(m[1]);
  assert.deepEqual([...tables], ['user_roles']);
  const all = srcJs.map(read).join('\n');
  assert.ok(!/\.rpc\(/.test(all), 'F-05 no debería llamar RPC');
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(all), 'F-05 no debería escribir en tablas');
});

test('login: el mensaje de error es genérico y no reenvía error.message del servidor', () => {
  const t = read(join(SRC, 'lib/session.js'));
  assert.ok(!/error\??\.message/.test(t), 'session.js no debe mostrar error.message de Auth');
  assert.ok(!/error\??\.code|error_code/.test(t), 'session.js no debe distinguir por código de error');
  assert.match(t, /MSG_INVALID\s*=\s*'Correo o contraseña incorrectos\.'/);
  const login = read(join(SRC, 'views/login.js'));
  assert.ok(!/textContent\s*=\s*[^;]*(error|err)\.message/.test(login));
});

test('logout limpia la sesión local aunque falle la red', () => {
  assert.match(read(join(SRC, 'lib/session.js')), /signOut\(\{\s*scope:\s*'local'\s*\}\)/);
});

test('la contraseña de la semilla local no aparece en src/ ni en dist/', () => {
  const pw = 'Local-Only-' + 'Pass-2026';
  const hits = [...srcJs, ...distText].filter((f) => read(f).includes(pw)).map(rel);
  assert.deepEqual(hits, []);
});

test('el helper el() escribe texto con textContent', () => {
  const t = read(join(SRC, 'views/dom.js'));
  assert.match(t, /textContent\s*=\s*String\(value\)/);
  assert.match(t, /document\.createTextNode\(/);
});

test('router: sin sesión toda ruta lleva a login (incluidas rutas raras)', () => {
  const paths = ['/', '/gestora', '/custodio', '/comite', '/lider', '/inicio', '/sin-rol',
    '/__proto__', '/constructor', '/GESTORA', '/gestora/../comite', '/javascript:alert(1)'];
  for (const p of paths) {
    const r = resolveRoute(parseHash(`#${p}`), { authenticated: false, roles: ['kpi_manager'] });
    assert.equal(r.view, 'login', p);
    assert.equal(r.path, LOGIN_PATH, p);
  }
});

test('router: claves heredadas o roles desconocidos no conceden vistas', () => {
  for (const p of ['/__proto__', '/constructor', '/toString', '/hasOwnProperty']) assert.equal(roleForPath(p), null, p);
  assert.deepEqual(distinctRoles([{ role: '__proto__' }, { role: 'admin' }, { role: 'service_role' }]), []);
  const r = resolveRoute('/gestora', { authenticated: true, roles: ['admin', 'constructor'] });
  assert.equal(r.view, 'no-role');
});

test('router: un rol no llega a la ruta de otro rol', () => {
  for (const [role] of Object.entries(ROLE_ROUTES)) {
    for (const [other, path] of Object.entries(ROLE_ROUTES)) {
      if (other === role) continue;
      const r = resolveRoute(path, { authenticated: true, roles: [role] });
      assert.equal(r.view, role, `${role} pidió ${path}`);
      assert.ok(r.redirected);
    }
  }
});

test('ci.yml: Supabase local con CLI fija y solo la clave publicable exportada al build', () => {
  const ci = read(join(ROOT, '.github/workflows/ci.yml'));
  assert.match(ci, /supabase\/setup-cli@[0-9a-f]{40}\s+#\s*v\d/);
  assert.match(ci, /version:\s*\d+\.\d+\.\d+/);
  assert.match(ci, /sb_publishable_\*\)/, 'debe validar el prefijo de la clave publicable');
  const exported = [...ci.matchAll(/echo\s+"([A-Z0-9_]+)=.*>>\s*"\$GITHUB_ENV"/g)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), ['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL']);
  assert.ok(!/SECRET_KEY|SERVICE_ROLE_KEY/.test(ci), 'ci.yml no debe tocar la clave secreta');
  assert.match(ci, /rm -f "\$RUNNER_TEMP\/sb\.env"/, 'el volcado de supabase status se borra');
});
