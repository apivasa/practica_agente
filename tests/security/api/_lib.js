// S-03 — Utilidades del pentest de la API real (PostgREST + Auth de Supabase
// local). Sin dependencias: fetch nativo y node:crypto de Node 22.
//
// Variables (las exporta el job `pentest-api` de seguridad.yml a partir de
// `supabase status -o env`):
//   PENTEST_API_URL          URL del gateway local (http://127.0.0.1:54321)
//   PENTEST_PUBLISHABLE_KEY  clave publicable sb_publishable_... (la del front)
//   PENTEST_SECRET_KEY       clave secreta sb_secret_... (solo fixtures locales)
//   PENTEST_JWT_SECRET       secreto JWT local (tokens vencidos / claims falsos)
//   PENTEST_DB_URL           cadena de conexión de Postgres local (catálogo)
//   PENTEST_REQUIRE=1        en CI: sin variables la prueba FALLA, no se omite
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const env = {
  url: process.env.PENTEST_API_URL?.replace(/\/$/, ''),
  publishable: process.env.PENTEST_PUBLISHABLE_KEY,
  secret: process.env.PENTEST_SECRET_KEY,
  jwtSecret: process.env.PENTEST_JWT_SECRET,
  dbUrl: process.env.PENTEST_DB_URL,
};

const required = process.env.PENTEST_REQUIRE === '1';
const configured = Boolean(env.url && env.publishable && env.secret);

// Fuera del job pentest-api (p. ej. `npm run test:unit` en ci.yml) no hay
// Supabase levantado: las pruebas de API se omiten. En el job pentest-api
// PENTEST_REQUIRE=1 convierte la falta de configuración en fallo.
export function skipReason() {
  if (configured) return false;
  if (required) {
    throw new Error('PENTEST_REQUIRE=1 pero faltan PENTEST_API_URL / PENTEST_PUBLISHABLE_KEY / PENTEST_SECRET_KEY');
  }
  return 'sin Supabase local (PENTEST_API_URL no definido): se ejecuta en seguridad.yml › pentest-api';
}

export function assertKeyFormats() {
  if (!/^sb_publishable_/.test(env.publishable)) throw new Error('la clave del front no es sb_publishable_...');
  if (!/^sb_secret_/.test(env.secret)) throw new Error('la clave del backend no es sb_secret_...');
}

// ---------------------------------------------------------------------------
// Datos del seed (supabase/seed.sql)
// ---------------------------------------------------------------------------
export const PASSWORD = 'Local-Only-Pass-2026';
export const USERS = {
  gestora: { id: '11111111-1111-4111-8111-000000000001', email: 'gestora@example.test' },
  custodio1: { id: '11111111-1111-4111-8111-000000000002', email: 'custodio1@example.test' },
  custodio2: { id: '11111111-1111-4111-8111-000000000003', email: 'custodio2@example.test' },
  comite: { id: '11111111-1111-4111-8111-000000000004', email: 'comite@example.test' },
  lider1: { id: '11111111-1111-4111-8111-000000000005', email: 'lider1@example.test' },
  lider2: { id: '11111111-1111-4111-8111-000000000006', email: 'lider2@example.test' },
  lider3: { id: '11111111-1111-4111-8111-000000000007', email: 'lider3@example.test' },
};
export const UNIT = {
  alfa: '22222222-2222-4222-8222-000000000001',
  beta: '22222222-2222-4222-8222-000000000002',
  gamma: '22222222-2222-4222-8222-000000000003',
};
export const KPI = {
  vuln: '33333333-3333-4333-8333-000000000001', // custodio1
  avail: '33333333-3333-4333-8333-000000000002', // custodio2
  mttr: '33333333-3333-4333-8333-000000000003', // custodio2
  obs: '33333333-3333-4333-8333-000000000004', // custodio2
};
export const CUSTODIAN_KPIS = {
  custodio1: [KPI.vuln],
  custodio2: [KPI.avail, KPI.mttr, KPI.obs],
};
export const LEADER_UNIT = { lider1: UNIT.alfa, lider2: UNIT.beta, lider3: UNIT.gamma };
export const ROLES = ['gestora', 'custodio1', 'custodio2', 'comite', 'lider1', 'lider2', 'lider3'];
export const ACTORS = [...ROLES, 'anon'];

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
export async function request(path, { token, apikey = env.publishable, method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (apikey) h.apikey = apikey;
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${env.url}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Llamada REST como un actor (`anon` = solo clave publicable). */
export function as(actor, tokens) {
  const token = actor === 'anon' ? undefined : tokens[actor];
  if (actor !== 'anon' && !token) throw new Error(`sin token para ${actor}`);
  return (path, opts = {}) => request(`/rest/v1/${path}`, { ...opts, token });
}

/** Llamada como backend (clave secreta). Solo para fixtures y verificación. */
export function admin(path, opts = {}) {
  return request(`/rest/v1/${path}`, { ...opts, apikey: env.secret });
}

export async function adminInsert(table, rows) {
  const r = await admin(table, { method: 'POST', body: rows, headers: { Prefer: 'return=representation' } });
  if (r.status !== 201) throw new Error(`fixture ${table}: ${r.status} ${r.text}`);
  return r.json;
}

export async function adminGet(path) {
  const r = await admin(path);
  if (r.status !== 200) throw new Error(`admin GET ${path}: ${r.status} ${r.text}`);
  return r.json;
}

// ---------------------------------------------------------------------------
// Sesiones: /auth/v1/token?grant_type=password. Se cachean en un archivo
// temporal para no superar el límite de inicios de sesión de GoTrue cuando
// corren varios archivos de prueba seguidos.
// ---------------------------------------------------------------------------
export async function login(email, password = PASSWORD) {
  return request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
}

export async function loginAll() {
  const cacheFile = join(tmpdir(), `pentest-tokens-${Buffer.from(env.url).toString('hex').slice(-24)}.json`);
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    const exp = Math.min(...Object.values(cached).map((t) => decode(t).payload.exp));
    if (exp * 1000 > Date.now() + 5 * 60_000) return cached;
  }
  const tokens = {};
  for (const role of ROLES) {
    const r = await login(USERS[role].email);
    if (r.status !== 200 || !r.json?.access_token) {
      throw new Error(`login ${role}: ${r.status} ${r.text}`);
    }
    tokens[role] = r.json.access_token;
  }
  writeFileSync(cacheFile, JSON.stringify(tokens), { mode: 0o600 });
  return tokens;
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
export function decode(token) {
  const [h, p, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url')),
    payload: JSON.parse(Buffer.from(p, 'base64url')),
    signature: s,
  };
}
export function encodeUnsigned(header, payload) {
  return `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
}
export function signHS256(payload, secret, header = { alg: 'HS256', typ: 'JWT' }) {
  const data = encodeUnsigned(header, payload);
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

// ---------------------------------------------------------------------------
// Catálogo de Postgres (psql contra la BD local)
// ---------------------------------------------------------------------------
export function sql(query) {
  if (!env.dbUrl) throw new Error('PENTEST_DB_URL no definido');
  return execFileSync('psql', [env.dbUrl, '-v', 'ON_ERROR_STOP=1', '-AtX', '-c', query], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

// Códigos de PostgREST para "denegado": 401 sin sesión (anon), 403 con sesión.
export const DENIED = [401, 403];
