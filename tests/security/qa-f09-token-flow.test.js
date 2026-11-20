// F-09 — QA independiente: comportamiento de la obtención de sesiones del
// pentest sin caché en disco. Traza al criterio de F-09:
//   - "ninguna prueba desactivada o debilitada": el reintento ante 429 no puede
//     convertir un fallo de inicio de sesión en éxito ni ocultar el 400 que
//     esperan las pruebas de contraseña incorrecta;
//   - "flujo archivo→petición eliminado": los tokens llegan por PENTEST_TOKENS
//     (entorno) y login-all.mjs solo escribe el JSON en stdout, nada más;
//   - el reintento está acotado y respeta Retry-After con tope.
// Sin red: fetch se sustituye; cada caso importa una instancia nueva de _lib.js
// (query string) para no compartir la caché en memoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGIN_ALL = join(HERE, 'api', 'login-all.mjs');
let n = 0;
const freshLib = () => import(`./api/_lib.js?qa-f09=${++n}`);

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp, sub = 'x') => {
  const data = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ exp, sub })}`;
  return `${data}.${createHmac('sha256', 'qa').update(data).digest('base64url')}`;
};
const ROLES = ['gestora', 'custodio1', 'custodio2', 'comite', 'lider1', 'lider2', 'lider3'];
const tokensFor = (exp) => Object.fromEntries(ROLES.map((r) => [r, jwt(exp, r)]));
const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('loginAll: PENTEST_TOKENS válido se usa sin iniciar sesión (sin red)', async () => {
  const t = tokensFor(inOneHour());
  await withEnv({ PENTEST_TOKENS: JSON.stringify(t) }, async () => {
    const lib = await freshLib();
    let calls = 0;
    const got = await withFetch(async () => { calls++; throw new Error('no debe llamar'); }, () => lib.loginAll());
    assert.equal(calls, 0);
    assert.deepEqual(got, t);
  });
});

test('loginAll: PENTEST_TOKENS vencido o malformado → inicia sesión real y luego usa la memoria', async () => {
  for (const raw of [JSON.stringify(tokensFor(Math.floor(Date.now() / 1000) - 10)), '{no-json', '[]']) {
    await withEnv({ PENTEST_TOKENS: raw }, async () => {
      const lib = await freshLib();
      let calls = 0;
      const fresh = jwt(inOneHour(), 'fresh');
      const impl = async () => { calls++; return new Response(JSON.stringify({ access_token: fresh }), { status: 200 }); };
      const first = await withFetch(impl, () => lib.loginAll());
      assert.equal(calls, ROLES.length, `raw=${raw.slice(0, 10)}`);
      assert.deepEqual(Object.keys(first).sort(), [...ROLES].sort());
      const second = await withFetch(impl, () => lib.loginAll());
      assert.equal(calls, ROLES.length, 'la segunda llamada debe salir de la memoria');
      assert.deepEqual(second, first);
    });
  }
});

test('loginAll: un 400 de Auth falla (no se oculta ni se reintenta)', async () => {
  await withEnv({ PENTEST_TOKENS: undefined }, async () => {
    const lib = await freshLib();
    let calls = 0;
    await withFetch(
      async () => { calls++; return new Response('{"error":"invalid_grant"}', { status: 400 }); },
      () => assert.rejects(lib.loginAll(), /login gestora: 400/),
    );
    assert.equal(calls, 1);
  });
});

test('loginAll: 429 persistente agota el reintento y FALLA (no queda como éxito ni omisión)', async () => {
  await withEnv({ PENTEST_TOKENS: undefined }, async () => {
    const lib = await freshLib();
    let calls = 0;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); // el sleep por defecto no espera de verdad
    try {
      await withFetch(
        async () => { calls++; return new Response('{"msg":"rate"}', { status: 429 }); },
        () => assert.rejects(lib.loginAll(), /login gestora: 429/),
      );
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    assert.equal(calls, lib.LOGIN_RETRY.attempts);
  });
});

test('login: contraseña incorrecta tras un 429 devuelve el 400 que esperan las pruebas de Auth', async () => {
  const lib = await freshLib();
  let calls = 0;
  const r = await withFetch(
    async () => { calls++; return new Response(calls === 1 ? '{}' : '{"error":"invalid_grant"}', { status: calls === 1 ? 429 : 400 }); },
    () => lib.login('lider1@example.test', 'wrong-password', { wait: async () => {} }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.json?.access_token, undefined);
  assert.equal(calls, 2);
});

test('login: espera = Retry-After en segundos, con tope maxMs; sin cabecera, retroceso exponencial', async () => {
  const lib = await freshLib();
  const { baseMs, maxMs, attempts } = lib.LOGIN_RETRY;
  for (const [header, expected] of [['1', 1000], ['3600', maxMs], [null, baseMs], ['0', baseMs], ['abc', baseMs]]) {
    const waits = [];
    let calls = 0;
    await withFetch(
      async () => {
        calls++;
        if (calls > 1) return new Response('{}', { status: 200 });
        return new Response('{}', { status: 429, headers: header === null ? {} : { 'retry-after': header } });
      },
      () => lib.login('a@example.test', 'p', { wait: async (ms) => waits.push(ms) }),
    );
    assert.deepEqual(waits, [expected], `retry-after=${header}`);
  }
  const waits = [];
  await withFetch(
    async () => new Response('{}', { status: 429 }),
    () => lib.login('a@example.test', 'p', { wait: async (ms) => waits.push(ms) }),
  );
  assert.equal(waits.length, attempts - 1, 'no espera tras el último intento');
  waits.forEach((ms, i) => assert.equal(ms, Math.min(baseMs * 2 ** i, maxMs)));
  assert.ok(waits.reduce((a, b) => a + b, 0) <= attempts * maxMs, 'espera total acotada');
});

test('login-all.mjs: stdout es solo el JSON de tokens (capturable en PENTEST_TOKENS); nada a stderr', () => {
  const t = tokensFor(inOneHour());
  const out = execFileSync(process.execPath, [LOGIN_ALL], {
    env: {
      PATH: process.env.PATH,
      PENTEST_API_URL: 'http://127.0.0.1:9', // inalcanzable: no debe usarse
      PENTEST_PUBLISHABLE_KEY: 'sb_publishable_qa',
      PENTEST_SECRET_KEY: 'sb_secret_qa',
      PENTEST_TOKENS: JSON.stringify(t),
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.deepEqual(JSON.parse(out), t);
  assert.equal(out, JSON.stringify(t), 'sin texto adicional en stdout');
});

test('login-all.mjs: sin configuración sale con error y no escribe nada en stdout', () => {
  for (const extra of [{}, { PENTEST_REQUIRE: '1' }]) {
    const r = spawnSync(process.execPath, [LOGIN_ALL], { env: { PATH: process.env.PATH, ...extra }, encoding: 'utf8' });
    assert.notEqual(r.status, 0, `exit con ${JSON.stringify(extra)}`);
    assert.equal(r.stdout, '');
  }
});
