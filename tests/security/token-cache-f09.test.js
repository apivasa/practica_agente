// F-09 — Regresión de CodeQL js/file-access-to-http (alertas #14..#16): los
// tokens de sesión del pentest no se leen de archivos ni se escriben a disco
// antes de enviarlos por HTTP. También prueba la lógica pura de la caché.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { validTokens, login, ROLES, LOGIN_RETRY } from './api/_lib.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = join(ROOT, 'tests', 'security', 'api');
const read = (p) => readFileSync(p, 'utf8');

test('F-09: ningún archivo de tests/security/api usa node:fs ni tmpdir', () => {
  for (const f of readdirSync(API).filter((n) => /\.(m?js)$/.test(n))) {
    const src = read(join(API, f));
    assert.doesNotMatch(src, /from ['"](node:)?fs(\/promises)?['"]/, `${f} importa fs`);
    assert.doesNotMatch(src, /\btmpdir\s*\(/, `${f} usa tmpdir()`);
    assert.doesNotMatch(src, /pentest-tokens-/, `${f} conserva la caché en archivo`);
  }
});

test('F-09: en tests/, e2e/ y scripts/ no hay lectura de tmpdir que acabe en fetch', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|ts)$/.test(e.name)) {
        const s = read(p);
        if (/\btmpdir\s*\(/.test(s) && /readFileSync/.test(s) && /\bfetch\s*\(/.test(s)) offenders.push(p);
      }
    }
  };
  for (const d of ['tests', 'e2e', 'scripts']) {
    try { walk(join(ROOT, d)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  assert.deepEqual(offenders.map((p) => p.slice(ROOT.length + 1)), []);
});

test('F-09: el job pentest-api pasa los tokens por entorno, sin archivo ni eco', () => {
  const wf = read(join(ROOT, '.github', 'workflows', 'seguridad.yml'));
  assert.match(wf, /PENTEST_TOKENS="\$\(node tests\/security\/api\/login-all\.mjs\)"/);
  assert.doesNotMatch(wf, /PENTEST_TOKENS[^\n]*(>|tee|GITHUB_ENV|GITHUB_OUTPUT|echo)/);
  assert.doesNotMatch(wf, /echo[^\n]*\$PENTEST_TOKENS/);
});

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp) => {
  const data = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ exp, sub: 'x' })}`;
  return `${data}.${createHmac('sha256', 'k').update(data).digest('base64url')}`;
};
const all = (exp) => Object.fromEntries(ROLES.map((r) => [r, jwt(exp)]));
const now = 1_800_000_000_000;

test('validTokens: acepta tokens completos y vigentes; solo devuelve los roles conocidos', () => {
  const t = { ...all(now / 1000 + 3600), extra: 'x.y.z' };
  const v = validTokens(t, now);
  assert.deepEqual(Object.keys(v).sort(), [...ROLES].sort());
});

test('validTokens: rechaza vencidos, por vencer (<5 min), incompletos y basura', () => {
  assert.equal(validTokens(all(now / 1000 - 1), now), null);
  assert.equal(validTokens(all(now / 1000 + 120), now), null);
  const partial = all(now / 1000 + 3600);
  delete partial.lider3;
  assert.equal(validTokens(partial, now), null);
  for (const bad of [null, undefined, 'x', [], { ...all(now / 1000 + 3600), gestora: 'no-jwt' }, { ...all(now / 1000 + 3600), comite: 'a.b.c' }]) {
    assert.equal(validTokens(bad, now), null);
  }
});

test('login: reintento acotado ante 429 (sin bucle infinito) y sin reintentar otros códigos', async () => {
  const realFetch = globalThis.fetch;
  const waits = [];
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{"msg":"rate"}', { status: 429 }); };
    const r = await login('a@example.test', 'p', { wait: async (ms) => waits.push(ms) });
    assert.equal(r.status, 429);
    assert.equal(calls, LOGIN_RETRY.attempts);
    assert.ok(waits.every((ms) => ms <= LOGIN_RETRY.maxMs));

    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(calls < 3 ? '{}' : '{"access_token":"t"}', { status: calls < 3 ? 429 : 200, headers: calls < 3 ? { 'retry-after': '1' } : {} }); };
    const ok = await login('a@example.test', 'p', { wait: async () => {} });
    assert.equal(ok.status, 200);
    assert.equal(calls, 3);

    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{}', { status: 400 }); };
    assert.equal((await login('a@example.test', 'bad', { wait: async () => {} })).status, 400);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
