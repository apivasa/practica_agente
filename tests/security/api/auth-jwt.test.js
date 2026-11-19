// S-03 — Autenticación y sesión contra la API real (categoría 2): JWT
// manipulado, clave publicable, registro cerrado, cierre de sesión y API de
// administración de Auth.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  skipReason, assertKeyFormats, env, loginAll, login, request, decode, encodeUnsigned, signHS256,
  USERS, ROLES, dateInDays,
} from './_lib.js';

const skip = skipReason();
const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;
let tokens;

const rest = (path, token, extra = {}) => request(`/rest/v1/${path}`, { token, ...extra });
const now = () => Math.floor(Date.now() / 1000);
const TABLES = ['units', 'user_roles', 'indicators', 'commitments', 'measurements', 'targets', 'evaluations', 'exceptions', 'alerts', 'audit_log'];

describe('pentest-api: autenticación y JWT', { skip }, () => {
  before(async () => {
    assertKeyFormats();
    tokens = await loginAll();
  });

  test('las claves en uso son las nuevas (sb_publishable_ / sb_secret_), no JWT legados', () => {
    assert.match(env.publishable, /^sb_publishable_/);
    assert.match(env.secret, /^sb_secret_/);
    assert.doesNotMatch(env.publishable, /^eyJ/);
  });

  test('los tokens de sesión son de rol authenticated y caducan', () => {
    for (const role of ROLES) {
      const { payload } = decode(tokens[role]);
      assert.equal(payload.role, 'authenticated', role);
      assert.equal(payload.sub, USERS[role].id, role);
      assert.ok(payload.exp - now() <= 3600 + 60, `${role}: exp demasiado lejano`);
    }
  });

  describe('JWT manipulado → 401', () => {
    const forged = () => {
      const t = tokens.lider1;
      const { header, payload, signature } = decode(t);
      const flip = (s) => s.slice(0, -4) + (s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
      return {
        'firma alterada': `${t.split('.').slice(0, 2).join('.')}.${flip(signature)}`,
        'sin firma': `${t.split('.').slice(0, 2).join('.')}.`,
        'role=service_role sin re-firmar': `${encodeUnsigned(header, { ...payload, role: 'service_role' })}.${signature}`,
        'sub de la gestora sin re-firmar': `${encodeUnsigned(header, { ...payload, sub: USERS.gestora.id })}.${signature}`,
        'exp extendido sin re-firmar': `${encodeUnsigned(header, { ...payload, exp: now() + 10 * 365 * 86400 })}.${signature}`,
        'alg none': `${encodeUnsigned({ alg: 'none', typ: 'JWT' }, { ...payload, sub: USERS.gestora.id, role: 'service_role' })}.`,
        'alg None (mayúscula)': `${encodeUnsigned({ alg: 'None', typ: 'JWT' }, { ...payload, sub: USERS.gestora.id })}.`,
        'HS256 con secreto inventado': signHS256({ ...payload, sub: USERS.gestora.id }, 'not-the-secret-not-the-secret-not-the-secret'),
        'HS256 firmado con la clave publicable (confusión de clave)': signHS256({ ...payload, role: 'service_role' }, env.publishable),
        'kid ajeno': `${encodeUnsigned({ ...header, kid: '../../../../dev/null' }, payload)}.${signature}`,
        'basura': 'not.a.jwt',
        'clave publicable como Bearer': env.publishable,
      };
    };

    test('cada variante es rechazada en todas las tablas', async () => {
      for (const [name, token] of Object.entries(forged())) {
        for (const t of TABLES) {
          const r = await rest(`${t}?select=*`, token);
          assert.ok([401, 403].includes(r.status), `${name} en ${t}: ${fmt(r)}`);
        }
        const w = await rest('user_roles', token, { method: 'POST', body: { user_id: USERS.lider1.id, role: 'kpi_manager' } });
        assert.ok([401, 403].includes(w.status), `${name} escribe: ${fmt(w)}`);
      }
    });

    test('token correctamente firmado pero vencido → 401', async (t) => {
      if (!env.jwtSecret) {
        assert.fail('PENTEST_JWT_SECRET no definido: no se puede probar el vencimiento');
      }
      const { payload } = decode(tokens.gestora);
      const valid = signHS256({ ...payload, iat: now() - 60, exp: now() + 300 }, env.jwtSecret);
      // Control: el mismo token con exp vigente sí es aceptado; si no, la
      // prueba de vencimiento no demostraría nada.
      const ctrl = await rest('units?select=id', valid);
      assert.equal(ctrl.status, 200, `control con firma válida: ${fmt(ctrl)}`);
      const expired = signHS256({ ...payload, iat: now() - 7200, exp: now() - 3600 }, env.jwtSecret);
      const r = await rest('units?select=id', expired);
      assert.equal(r.status, 401, fmt(r));
      t.diagnostic(`vencido: ${r.json?.code ?? ''} ${r.json?.message ?? ''}`);
    });

    test('firma válida con claims de rol inventados (app_metadata, user_role) no da acceso', async () => {
      assert.ok(env.jwtSecret, 'PENTEST_JWT_SECRET no definido');
      const ghost = '5e030000-0000-4000-8000-0000000000ff';
      const token = signHS256({
        aud: 'authenticated', role: 'authenticated', sub: ghost, iat: now(), exp: now() + 300,
        app_metadata: { role: 'kpi_manager', provider: 'email' }, user_metadata: { role: 'committee' }, user_role: 'committee',
      }, env.jwtSecret);
      for (const t of TABLES) {
        const r = await rest(`${t}?select=*`, token);
        assert.equal(r.status, 200, `${t}: ${fmt(r)}`);
        assert.deepEqual(r.json, [], `${t}: claims inventados ven datos`);
      }
      const w = await rest('exceptions', token, { method: 'POST', body: { unit_id: '22222222-2222-4222-8222-000000000001', scope: 'all', reason: 'x', expires_on: dateInDays(30), approved_by: ghost } });
      assert.ok([401, 403].includes(w.status), fmt(w));
    });

    test('firma válida con la sesión de un líder y claims de comité no aprueba excepciones', async () => {
      assert.ok(env.jwtSecret, 'PENTEST_JWT_SECRET no definido');
      const { payload } = decode(tokens.lider1);
      const token = signHS256({ ...payload, app_metadata: { ...payload.app_metadata, role: 'committee' }, user_role: 'committee', exp: now() + 300 }, env.jwtSecret);
      const r = await rest('exceptions', token, {
        method: 'POST',
        body: { unit_id: '22222222-2222-4222-8222-000000000001', scope: 'all', reason: 'x', expires_on: dateInDays(30), approved_by: USERS.lider1.id },
      });
      assert.equal(r.status, 403, fmt(r));
    });
  });

  describe('clave publicable y apikey', () => {
    test('sin apikey ni sesión, o con apikey inventada → 401', async () => {
      const none = await request('/rest/v1/units?select=id', { apikey: '' });
      assert.equal(none.status, 401, `sin apikey: ${fmt(none)}`);
      for (const apikey of ['sb_publishable_invented000000000000', 'sb_secret_invented00000000000000000']) {
        const r = await request('/rest/v1/units?select=id', { apikey });
        assert.equal(r.status, 401, `apikey=${apikey.slice(0, 16)}: ${fmt(r)}`);
        // Con un JWT de usuario válido el gateway local no valida la apikey
        // (H-S03-03, informativo): el acceso es el del usuario, nunca más.
        const w = await request('/rest/v1/user_roles', {
          apikey, token: tokens.lider1, method: 'POST', body: { user_id: USERS.lider1.id, role: 'kpi_manager' },
        });
        assert.ok([401, 403].includes(w.status), `apikey inventada + líder escala: ${fmt(w)}`);
      }
    });

    test('la clave publicable sola no lee, no escribe y no lista el esquema', async () => {
      for (const t of TABLES) {
        const r = await rest(`${t}?select=*`);
        assert.ok([401, 403].includes(r.status), `${t}: ${fmt(r)}`);
      }
      const root = await rest('');
      if (root.status === 200) {
        const paths = Object.keys(root.json?.paths ?? {}).filter((p) => p !== '/');
        assert.deepEqual(paths, [], 'OpenAPI para anon publica tablas');
      }
    });
  });

  describe('Auth (GoTrue)', () => {
    test('registro abierto deshabilitado (enable_signup = false)', async () => {
      const email = `pentest-signup-${Date.now()}@example.test`;
      const r = await request('/auth/v1/signup', { method: 'POST', body: { email, password: 'Pentest-Signup-2026!' } });
      assert.ok(r.status >= 400 && r.status < 500, `signup aceptado: ${fmt(r)}`);
      const l = await login(email, 'Pentest-Signup-2026!');
      assert.equal(l.status, 400, `el usuario de signup inicia sesión: ${fmt(l)}`);
    });

    test('contraseña incorrecta → 400 sin token', async () => {
      const r = await login(USERS.lider1.email, 'wrong-password');
      assert.equal(r.status, 400, fmt(r));
      assert.equal(r.json?.access_token, undefined);
    });

    test('la API de administración de Auth no acepta tokens de usuario ni la clave publicable', async () => {
      for (const token of [undefined, tokens.gestora, tokens.comite]) {
        const r = await request('/auth/v1/admin/users', { token });
        assert.ok([401, 403].includes(r.status), fmt(r));
        const c = await request('/auth/v1/admin/users', { token, method: 'POST', body: { email: 'pentest-admin@example.test', password: 'x-Pentest-2026' } });
        assert.ok([401, 403].includes(c.status), fmt(c));
      }
    });

    test('el usuario no se asigna app_metadata.role por /auth/v1/user', async () => {
      const r = await request('/auth/v1/user', {
        token: tokens.lider3, method: 'PUT', body: { app_metadata: { role: 'kpi_manager' }, data: { role: 'kpi_manager' } },
      });
      assert.ok(r.status === 200 || r.status >= 400, fmt(r));
      if (r.status === 200) assert.notEqual(r.json?.app_metadata?.role, 'kpi_manager');
      const roles = await rest('user_roles?select=role', tokens.lider3);
      assert.deepEqual(roles.json.map((x) => x.role), ['unit_leader']);
      const ur = await rest('user_roles?select=*', tokens.lider3);
      assert.equal(ur.json.length, 1);
    });

    test('logout revoca el refresh token y la sesión en Auth', async () => {
      const s = await login(USERS.lider3.email);
      assert.equal(s.status, 200, fmt(s));
      const { access_token: at, refresh_token: rt } = s.json;
      const out = await request('/auth/v1/logout?scope=local', { token: at, method: 'POST' });
      assert.ok([200, 204].includes(out.status), fmt(out));
      const refresh = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: rt } });
      assert.ok(refresh.status >= 400, `refresh tras logout: ${fmt(refresh)}`);
      const user = await request('/auth/v1/user', { token: at });
      assert.ok([401, 403].includes(user.status), `/auth/v1/user tras logout: ${fmt(user)}`);
    });
  });
});
