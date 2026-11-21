// S-05 — Pentest previo a producción, fase B: contra la URL publicada en
// GitHub Pages y el proyecto Supabase real de ESTE repositorio. Solo lo lanza a
// mano el job `s05-fase-b` de seguridad.yml (workflow_dispatch, fase_b != no).
//
// Reglas de alcance (agente de seguridad, no negociables):
//   - Solo dos hosts: apivasa.github.io/practica_agente y <ref>.supabase.co con
//     el ref del proyecto (P-02). `guardedFetch` rechaza cualquier otro.
//   - Sin la clave secreta: la URL de Supabase y la clave publicable se sacan del
//     propio front publicado, como haría un atacante.
//   - No destructivo: solo lecturas; las únicas escrituras son sondas que la
//     base debe rechazar por privilegios (anónimo) o que, si prosperaran, solo
//     tocarían la fila del propio usuario de prueba (reversible; ver
//     docs/seguridad/pentest-preproduccion.md › Fase B).
//   - Sin fuerza bruta: como mucho 2 inicios de sesión por rol de prueba.
//
// Variables:
//   S05_PAGES_URL        https://apivasa.github.io/practica_agente/
//   S05_PROJECT_REF      ref del proyecto Supabase de producción
//   S05_MODE             anonimo | roles
//   S05_TEST_USERS       (solo roles) JSON {"gestora":{"email","password"},
//                        "custodio":{…},"comite":{…},"lider":{…}} con cuentas
//                        de prueba dedicadas (secreto del environment produccion)
//   S05_REQUIRE=1        sin variables la prueba falla en vez de omitirse
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ANON_WRITE_PROBES, privilegeDenialProblem } from './anon-write-probes.js';

const PAGES = process.env.S05_PAGES_URL;
const REF = process.env.S05_PROJECT_REF;
const MODE = process.env.S05_MODE ?? 'anonimo';
const required = process.env.S05_REQUIRE === '1';
const configured = Boolean(PAGES && REF);
if (!configured && required) throw new Error('S05_REQUIRE=1 pero faltan S05_PAGES_URL / S05_PROJECT_REF');
const skip = configured ? false : 'fase B: solo en seguridad.yml › s05-fase-b (workflow_dispatch)';

const TABLES = [
  'units', 'user_roles', 'indicators', 'targets', 'commitments', 'measurements',
  'evaluations', 'exceptions', 'alerts', 'audit_log',
];
const PRIVATE_FNS = ['has_role', 'has_any_role', 'is_leader_of', 'is_custodian_of', 'exception_max_days'];

let SUPA; // https://<ref>.supabase.co
let KEY; // sb_publishable_...
const sessions = {}; // rol -> { token, sub }

// ---------------------------------------------------------------------------
// fetch con lista blanca de hosts
// ---------------------------------------------------------------------------
function allowed(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') return false;
  if (u.host === 'apivasa.github.io' && u.pathname.startsWith('/practica_agente/')) return true;
  return REF && u.host === `${REF}.supabase.co`;
}
let requests = 0;
async function guardedFetch(url, opts = {}) {
  if (!allowed(url)) throw new Error(`fuera de alcance: ${url}`);
  requests += 1;
  if (requests > 900) throw new Error('tope de peticiones de la fase B superado (no es una prueba de carga)');
  await new Promise((r) => setTimeout(r, 120)); // ritmo bajo: sin denegación de servicio
  return fetch(url, { redirect: 'manual', ...opts });
}
async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
  const h = { apikey: KEY, ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await guardedFetch(`${SUPA}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, text, json, headers: res.headers };
}
const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;
const sub = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;

describe('S-05 fase B · producción (no destructiva)', { skip }, () => {
  let html;
  let assets = [];

  before(async () => {
    assert.match(REF, /^[a-z0-9]{20}$/, 'S05_PROJECT_REF con formato inesperado');
    assert.equal(new URL(PAGES).href, 'https://apivasa.github.io/practica_agente/', 'solo la URL de Pages de este repo');
    const res = await guardedFetch(PAGES);
    assert.equal(res.status, 200, `Pages respondió ${res.status}`);
    html = await res.text();
    const srcs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map((m) => new URL(m[1], PAGES).href);
    for (const src of srcs.filter((s) => /\.(js|css)$/.test(s) && allowed(s))) {
      const r = await guardedFetch(src);
      assets.push({ src, status: r.status, text: await r.text() });
    }
    const bundle = assets.map((a) => a.text).join('\n');
    const urls = [...new Set(bundle.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/g) ?? [])];
    assert.deepEqual(urls, [`https://${REF}.supabase.co`], `el front apunta a ${urls.join(', ') || 'ningún Supabase'}`);
    SUPA = urls[0];
    const keys = [...new Set(bundle.match(/sb_publishable_[A-Za-z0-9_-]{10,}/g) ?? [])];
    assert.equal(keys.length, 1, 'el front debe llevar exactamente una clave publicable');
    KEY = keys[0];
  });

  after(async () => {
    for (const s of Object.values(sessions)) {
      await api('/auth/v1/logout', { method: 'POST', token: s.token }).catch(() => {});
    }
  });

  // -------------------------------------------------------------------------
  // Front publicado (categoría 4)
  // -------------------------------------------------------------------------
  describe('front publicado', () => {
    test('HTTPS obligatorio: http:// redirige a https://', async () => {
      // Única excepción a guardedFetch: mismo host, http, sin seguir la redirección.
      const res = await fetch(PAGES.replace('https://', 'http://'), { redirect: 'manual' });
      assert.ok([301, 302, 307, 308].includes(res.status), `http respondió ${res.status}`);
      assert.match(res.headers.get('location') ?? '', /^https:\/\/apivasa\.github\.io\/practica_agente\//);
    });

    test('HSTS servido por github.io', async () => {
      const res = await guardedFetch(PAGES);
      assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=\d{7,}/);
    });

    test('CSP por meta sin unsafe-inline/unsafe-eval, sin loopback y connect-src solo al proyecto', () => {
      const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
      assert.ok(m, 'sin meta CSP');
      const csp = m[1].replace(/&#39;|&apos;/g, "'");
      const scriptSrc = (csp.match(/script-src([^;]*)/) ?? [])[1] ?? '';
      assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval|\*/);
      assert.doesNotMatch(csp, /127\.0\.0\.1|localhost/);
      assert.match(csp, /upgrade-insecure-requests/);
      const connect = (csp.match(/connect-src([^;]*)/) ?? [])[1] ?? '';
      const origins = connect.trim().split(/\s+/).filter((o) => !o.startsWith("'"));
      for (const o of origins) assert.match(o, new RegExp(`^(https|wss)://${REF}\\.supabase\\.co$`), `connect-src permite ${o}`);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /base-uri 'self'|base-uri 'none'/);
    });

    test('sin secretos en el HTML ni en los assets publicados', () => {
      const all = [html, ...assets.map((a) => a.text)].join('\n');
      assert.doesNotMatch(all, /sb_secret_[A-Za-z0-9_-]{16,}/, 'clave secreta publicada');
      assert.doesNotMatch(all, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      assert.doesNotMatch(all, /\bgh[pousr]_[A-Za-z0-9]{30,}/, 'token de GitHub publicado');
      assert.doesNotMatch(all, /sbp_[a-f0-9]{40}/, 'token de acceso de Supabase publicado');
      // Claves legadas (JWT con role anon/service_role) no deben estar en el front.
      for (const jwt of all.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
        const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
        assert.ok(!['anon', 'service_role'].includes(p.role), `clave legada ${p.role} en el front`);
      }
    });

    test('sin scripts de terceros ni recursos sin integridad', () => {
      for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
        const u = new URL(m[1], PAGES);
        assert.equal(u.host, 'apivasa.github.io', `script de tercero: ${u.href}`);
      }
      assert.ok(assets.every((a) => a.status === 200), 'assets publicados que no cargan');
    });

    test('sin mapas de fuente ni archivos de desarrollo publicados', async () => {
      for (const p of ['.env', '.env.local', 'package.json', 'supabase/seed.sql', '.git/config']) {
        const r = await guardedFetch(new URL(p, PAGES).href);
        assert.equal(r.status, 404, `${p} está publicado`);
      }
      for (const a of assets.filter((x) => x.src.endsWith('.js'))) {
        assert.doesNotMatch(a.text, /sourceMappingURL=/, `${a.src} publica source map`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Auth de producción (categoría 2): configuración que config.toml no fija
  // -------------------------------------------------------------------------
  describe('Auth del proyecto real', () => {
    test('/auth/v1/settings: registro cerrado, sin anónimos, sin proveedores externos', async () => {
      const r = await api('/auth/v1/settings');
      assert.equal(r.status, 200, fmt(r));
      assert.equal(r.json.disable_signup, true, 'REGISTRO ABIERTO en producción (Authentication › Sign In / Providers › Allow new users to sign up)');
      const ext = r.json.external ?? {};
      assert.notEqual(ext.anonymous_users, true, 'inicio de sesión anónimo activado');
      const on = Object.entries(ext).filter(([k, v]) => v === true && k !== 'email').map(([k]) => k);
      assert.deepEqual(on, [], 'proveedores externos activos');
    });

    test('la clave publicable no abre la API de administración de Auth', async () => {
      const r = await api('/auth/v1/admin/users');
      assert.ok([401, 403].includes(r.status), fmt(r));
    });

    test('login: sin enumeración de usuarios (correo inexistente ≡ clave errónea)', async () => {
      const r = await api('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: 's05-no-existe@example.invalid', password: 'no-es-la-clave-s05' },
      });
      assert.ok([400, 429].includes(r.status), fmt(r));
      assert.ok(!r.json?.access_token);
    });
  });

  // -------------------------------------------------------------------------
  // API REST como anónimo (categorías 1 y 3)
  // -------------------------------------------------------------------------
  describe('API REST como anónimo (solo clave publicable)', () => {
    test('el esquema (OpenAPI) no se publica al anónimo', async () => {
      const r = await api('/rest/v1/', { headers: { Accept: 'application/openapi+json' } });
      const paths = Object.keys(r.json?.paths ?? {}).filter((p) => p !== '/');
      assert.deepEqual(paths, [], `OpenAPI publica: ${paths.join(', ')}`);
    });

    for (const t of TABLES) {
      test(`${t}: lectura denegada o vacía`, async () => {
        const r = await api(`/rest/v1/${t}?select=*&limit=5`);
        assert.ok(r.status < 500, fmt(r));
        if (r.status === 200) assert.deepEqual(r.json, [], `anon lee ${t}`);
      });
    }

    for (const [t, body] of Object.entries(ANON_WRITE_PROBES)) {
      // Sin privilegio INSERT para anon (hardening.sql): PostgreSQL rechaza antes de
      // tocar filas. El cuerpo usa columnas reales (S-05c, H-QA-S05b-01) para que
      // PostgREST no responda 400 PGRST204 antes del chequeo de privilegios; solo
      // vale 401/403 con 42501 «permission denied». Aunque anon tuviera INSERT, cada
      // sonda lleva una violación garantizada (FK inexistente, CHECK en blanco o
      // NOT NULL a null): respondería 23xxx, la prueba falla y no queda fila
      // (audit_log es append-only: una fila ahí no se podría borrar).
      test(`${t}: escritura anónima denegada por privilegio (42501)`, async () => {
        const r = await api(`/rest/v1/${t}`, { method: 'POST', body, headers: { Prefer: 'return=minimal' } });
        const problem = privilegeDenialProblem(r.status, r.json);
        assert.equal(problem, null, `anon POST ${t}: ${problem} · ${fmt(r)}`);
      });
    }

    test('funciones private no expuestas por RPC', async () => {
      for (const fn of PRIVATE_FNS) {
        const r = await api(`/rest/v1/rpc/${fn}`, { method: 'POST', body: {} });
        assert.ok([401, 403, 404].includes(r.status), `rpc/${fn}: ${fmt(r)}`);
      }
    });

    test('esquemas internos no accesibles (auth, private, storage)', async () => {
      for (const [schema, rel] of [['auth', 'users'], ['private', 'x'], ['storage', 'objects'], ['vault', 'secrets']]) {
        const r = await api(`/rest/v1/${rel}?select=*&limit=1`, { headers: { 'Accept-Profile': schema } });
        assert.ok(r.status >= 400 && r.status < 500, `${schema}.${rel}: ${fmt(r)}`);
      }
    });

    test('GraphQL no publica tablas al anónimo', async () => {
      const r = await api('/graphql/v1', { method: 'POST', body: { query: '{ __schema { queryType { fields { name } } } }' } });
      assert.ok(r.status < 500, fmt(r));
      const names = (r.json?.data?.__schema?.queryType?.fields ?? []).map((f) => f.name.toLowerCase().replace(/_/g, ''));
      const exposed = names.filter((n) => TABLES.some((t) => n.includes(t.replace(/_/g, ''))));
      assert.deepEqual(exposed, []);
    });

    test('JWT inventado o con alg none → 401', async () => {
      const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const payload = { sub: '00000000-0000-4000-8000-000000000000', role: 'service_role', exp: 4102444800 };
      for (const tok of [`${b({ alg: 'none', typ: 'JWT' })}.${b(payload)}.`, `${b({ alg: 'HS256', typ: 'JWT' })}.${b(payload)}.AAAA`]) {
        const r = await api('/rest/v1/units?select=id', { token: tok });
        assert.equal(r.status, 401, fmt(r));
      }
    });
  });

  // -------------------------------------------------------------------------
  // Con usuarios de prueba de los 4 roles (solo S05_MODE=roles)
  // -------------------------------------------------------------------------
  describe('API REST con los 4 roles (usuarios de prueba)', { skip: MODE !== 'roles' && 'S05_MODE=anonimo' }, () => {
    const ROLE_OF = { gestora: 'kpi_manager', custodio: 'custodian', comite: 'committee', lider: 'unit_leader' };
    let users;
    const own = {}; // rol -> { units:Set, kpis:Set }

    before(async () => {
      users = JSON.parse(process.env.S05_TEST_USERS ?? 'null');
      assert.ok(users, 'S05_MODE=roles exige el secreto S05_TEST_USERS');
      for (const role of Object.keys(ROLE_OF)) {
        const u = users[role];
        assert.ok(u?.email && u?.password, `falta el usuario de prueba ${role}`);
        const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: u.email, password: u.password } });
        assert.equal(r.status, 200, `login ${role}: ${r.status}`);
        sessions[role] = { token: r.json.access_token, sub: sub(r.json.access_token) };
        const roles = await api(`/rest/v1/user_roles?select=*`, { token: sessions[role].token });
        assert.equal(roles.status, 200, fmt(roles));
        const mine = roles.json.filter((x) => x.user_id === sessions[role].sub);
        assert.ok(mine.some((x) => x.role === ROLE_OF[role]), `${role}: el usuario de prueba no tiene el rol ${ROLE_OF[role]}`);
        own[role] = {
          units: new Set(mine.filter((x) => x.unit_id).map((x) => x.unit_id)),
          kpis: new Set(mine.filter((x) => x.indicator_id).map((x) => x.indicator_id)),
        };
      }
    });

    test('las sesiones de producción duran como mucho 1 h (H-S03-01)', () => {
      for (const s of Object.values(sessions)) {
        const p = JSON.parse(Buffer.from(s.token.split('.')[1], 'base64url'));
        assert.ok(p.exp - p.iat <= 3600, `jwt_expiry de producción = ${p.exp - p.iat} s`);
      }
    });

    test('login sin enumeración: cuenta existente con clave errónea ≡ correo inexistente (H-QA-S05b-02)', async () => {
      // 2 intentos fallidos en total (uno por caso), sin fuerza bruta. La cuenta
      // existente es la gestora de prueba: con su login correcto del before()
      // suma 2 inicios de sesión, dentro del tope de la cabecera.
      const login = (email, password) => api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      const wrong = 'no-es-la-clave-s05c-' + 'x'.repeat(8);
      assert.notEqual(users.gestora.password, wrong);
      const existing = await login(users.gestora.email, wrong);
      const missing = await login('s05-no-existe@example.invalid', wrong);
      for (const r of [existing, missing]) {
        assert.equal(r.status, 400, `login fallido debe dar 400 (429 = límite, repetir más tarde): ${fmt(r)}`);
        assert.ok(!r.json?.access_token, 'login fallido emitió token');
      }
      const shape = (r) => ({
        status: r.status,
        code: r.json?.code ?? null,
        error_code: r.json?.error_code ?? null,
        error: r.json?.error ?? null,
        msg: r.json?.msg ?? r.json?.message ?? r.json?.error_description ?? null,
        keys: Object.keys(r.json ?? {}).sort(),
      });
      assert.deepEqual(shape(existing), shape(missing), `enumeración: la respuesta distingue cuentas existentes\n  existente: ${fmt(existing)}\n  inexistente: ${fmt(missing)}`);
    });

    test('líder: solo ve su unidad y lo suyo (IDOR de lectura)', async () => {
      const { token, sub: me } = sessions.lider;
      const units = own.lider.units;
      const read = async (t) => {
        const r = await api(`/rest/v1/${t}?select=*`, { token });
        assert.equal(r.status, 200, `${t}: ${fmt(r)}`);
        return r.json;
      };
      assert.ok((await read('user_roles')).every((x) => x.user_id === me), 'user_roles ajenos');
      assert.ok((await read('units')).every((x) => units.has(x.id)), 'unidades ajenas');
      for (const t of ['targets', 'commitments', 'measurements', 'evaluations', 'exceptions']) {
        assert.ok((await read(t)).every((x) => units.has(x.unit_id)), `${t} de otra unidad`);
      }
      assert.ok((await read('alerts')).every((x) => x.recipient_user_id === me), 'alertas ajenas');
      assert.deepEqual(await read('audit_log'), [], 'el líder lee auditoría');
    });

    test('líder: filtros de otra unidad (or=, in=) no devuelven nada ajeno', async () => {
      const { token } = sessions.lider;
      const all = await api('/rest/v1/units?select=id', { token: sessions.gestora.token });
      const foreign = all.json.map((x) => x.id).filter((id) => !own.lider.units.has(id));
      if (!foreign.length) return;
      for (const q of [`unit_id=in.(${foreign.join(',')})`, `or=(unit_id.eq.${foreign[0]},unit_id.neq.${foreign[0]})`]) {
        for (const t of ['targets', 'measurements', 'evaluations', 'exceptions', 'commitments']) {
          const r = await api(`/rest/v1/${t}?select=unit_id&${q}`, { token });
          assert.ok(r.status < 500, fmt(r));
          if (r.status === 200) assert.ok(r.json.every((x) => own.lider.units.has(x.unit_id)), `${t} con ${q}`);
        }
      }
    });

    test('custodio: mediciones, compromisos y evaluaciones solo de sus KPI; sin excepciones ni auditoría', async () => {
      const { token } = sessions.custodio;
      const kpis = own.custodio.kpis;
      for (const t of ['measurements', 'commitments']) {
        const r = await api(`/rest/v1/${t}?select=indicator_id`, { token });
        assert.equal(r.status, 200, fmt(r));
        assert.ok(r.json.every((x) => kpis.has(x.indicator_id)), `${t} de otro KPI`);
      }
      const ev = await api('/rest/v1/evaluations?select=indicator_id', { token });
      assert.ok(ev.json.every((x) => x.indicator_id && kpis.has(x.indicator_id)), 'evaluaciones fuera de sus KPI');
      for (const t of ['exceptions', 'audit_log']) {
        const r = await api(`/rest/v1/${t}?select=*`, { token });
        assert.ok(r.status === 200 ? r.json.length === 0 : r.status < 500, `${t}: ${fmt(r)}`);
      }
    });

    test('comité y gestora: leen la auditoría; nadie la modifica', async () => {
      for (const role of ['gestora', 'comite']) {
        const r = await api('/rest/v1/audit_log?select=id&limit=1', { token: sessions[role].token });
        assert.equal(r.status, 200, `${role}: ${fmt(r)}`);
      }
      for (const role of Object.keys(ROLE_OF)) {
        // Filtro imposible: aun con privilegio no tocaría ninguna fila.
        const u = await api('/rest/v1/audit_log?id=eq.-1', { method: 'PATCH', token: sessions[role].token, body: { action: 's05' } });
        // Sin privilegio UPDATE/DELETE (H-F03-03): 401/403 aunque el filtro no toque filas.
        assert.ok([401, 403].includes(u.status), `${role} PATCH audit_log: ${fmt(u)}`);
        const d = await api('/rest/v1/audit_log?id=eq.-1', { method: 'DELETE', token: sessions[role].token });
        assert.ok([401, 403].includes(d.status), `${role} DELETE audit_log: ${fmt(d)}`);
      }
    });

    test('escalada: líder y custodio no se cambian el rol ni la unidad (fila propia)', async () => {
      // Si RLS fallara, solo cambiaría la fila del propio usuario de prueba; el
      // after() de esta suite no puede revertirlo sin la gestora, así que la
      // prueba lo comprueba y lo revierte con la sesión de la gestora de prueba.
      for (const role of ['lider', 'custodio']) {
        const { token, sub: me } = sessions[role];
        const before = await api(`/rest/v1/user_roles?select=*&user_id=eq.${me}`, { token: sessions.gestora.token });
        const r = await api(`/rest/v1/user_roles?user_id=eq.${me}`, {
          method: 'PATCH', token, body: { role: 'kpi_manager' }, headers: { Prefer: 'return=representation' },
        });
        const after = await api(`/rest/v1/user_roles?select=*&user_id=eq.${me}`, { token: sessions.gestora.token });
        if (JSON.stringify(after.json) !== JSON.stringify(before.json)) {
          for (const row of before.json) {
            await api(`/rest/v1/user_roles?user_id=eq.${me}&role=eq.kpi_manager`, {
              method: 'PATCH', token: sessions.gestora.token, body: { role: row.role },
            });
          }
        }
        assert.deepEqual(after.json, before.json, `ESCALADA: ${role} cambió su fila de user_roles (${fmt(r)})`);
      }
    });

    test('solo el comité aprueba: líder no crea excepciones (sonda con unidad inexistente)', async () => {
      // unit_id inexistente: aunque RLS fallara, la FK impide crear la fila.
      const r = await api('/rest/v1/exceptions', {
        method: 'POST', token: sessions.lider.token,
        body: { unit_id: '00000000-0000-4000-8000-0000000005e5', scope: 'all', reason: 's05-fase-b', expires_on: '2099-01-01', approved_by: sessions.lider.sub },
      });
      // RLS (o el trigger de C-02) debe rechazar antes de la FK: si aparece 23503
      // (violación de FK) es que la fila pasó la política del comité.
      assert.ok(r.status >= 400 && r.status < 500, `líder POST exceptions: ${fmt(r)}`);
      assert.doesNotMatch(r.text, /23503/, `la política dejó pasar al líder hasta la FK: ${fmt(r)}`);
    });
  });
});
