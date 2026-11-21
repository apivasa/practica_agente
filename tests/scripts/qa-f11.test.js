// QA F-11 (tester) — cada caso traza a un punto del ítem (plan-maestro, fila F-11):
//  [P1] H-V05c-01 "`verify` comprueba que el SHA sigue siendo la punta de main" (salvo que lo
//       posterior sea solo documentación: los mismos paths-ignore de deploy.yml).
//  [P2] H-V05c-03a "quitar `\r` en clean_error".
//  [P3] H-C06-01 "fail-closed si la BD no tiene recipientAccess/expiredEmailAlerts/markAlertsEmailSkipped".
//  [P4] "prueba suma de timeouts de deploy.yml ≤ maxPendingMin".
//  (El punto 5, negativos de Excel, está en tests/engine/qa-f11.test.js.)
// gh se sustituye por un ejecutable falso (no hay red); nunca se llama a la API real.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runEmailStep } from '../../scripts/lib/email.js';
import { DEPLOY_RULE } from '../../scripts/health/lib.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIP = join(ROOT, 'scripts', 'ci', 'check-main-tip.sh');
const WAIT = join(ROOT, 'scripts', 'ci', 'wait-ci.sh');
const DEPLOY = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const DEPLOY_CODE = DEPLOY.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const OLD = '1'.repeat(40);
const NEW = '2'.repeat(40);
// Token ficticio armado en ejecución (sin literal con forma de token).
const TOKEN = ['ghs', 'qaF11', 'x'.repeat(12)].join('');

/**
 * Ejecuta un script con un gh falso. `answers` mapea un fragmento de la ruta pedida a
 * { out } (stdout, código 0) o { err } (stderr, código 1). Devuelve código, salida y las
 * rutas pedidas en orden.
 */
function withFakeGh(script, answers, env = {}, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-f11-'));
  try {
    const branches = Object.entries(answers).map(([frag, a], i) => {
      writeFileSync(join(dir, `a${i}`), a.out ?? a.err ?? '');
      const stream = a.err !== undefined ? '>&2' : '';
      const code = a.err !== undefined ? 1 : 0;
      return `  *'${frag}'*) cat "${dir}/a${i}" ${stream}; exit ${code} ;;`;
    }).join('\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\nprintf '%s\\n' "$2" >> "${dir}/calls"\ncase "$2" in\n${branches}\nesac\necho "HTTP 404: Not Found" >&2; exit 1\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const r = spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`, GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'org/app',
        HEAD_SHA: OLD, GH_TOKEN: TOKEN, TIP_RETRY_INTERVAL_SECONDS: '0', TIP_RETRIES: '2',
        CI_WAIT_TIMEOUT_SECONDS: '0', CI_WAIT_INTERVAL_SECONDS: '0', ...env,
      },
    });
    let calls = [];
    try { calls = readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean); } catch { /* sin llamadas */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mainAt = (sha) => ({ out: JSON.stringify({ sha, commit: { message: 'm' } }) });
const compare = (status, files) => ({ out: JSON.stringify({ status, ahead_by: 1, behind_by: 0, files }) });
const f = (filename, extra = {}) => ({ filename, status: 'modified', ...extra });
const COMMITS = 'repos/org/app/commits/main';
const COMPARE = `repos/org/app/compare/${OLD}...${NEW}`;

describe('[P1] check-main-tip.sh: en push, el SHA debe ser la punta de main', () => {
  test('SHA = punta de main → 0, sin consultar compare', () => {
    const r = withFakeGh(TIP, { [COMMITS]: mainAt(OLD) });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.calls, [COMMITS]);
  });

  test('main avanzó con un cambio de código (src/) → 1 con ::error::', () => {
    const r = withFakeGh(TIP, { [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', [f('src/app.js')]) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /::error::/);
  });

  for (const path of ['supabase/migrations/20270101000000_x.sql', 'engine/color.js', '.github/workflows/deploy.yml', 'package.json', 'index.html', 'scripts/ci/check-main-tip.sh']) {
    test(`main avanzó tocando ${path} (no está en paths-ignore) → 1`, () => {
      const r = withFakeGh(TIP, { [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', [f('docs/estado.md'), f(path)]) });
      assert.equal(r.code, 1, r.out);
    });
  }

  test('main avanzó solo con docs/** y *.md en cualquier carpeta (latido de estado) → 0', () => {
    const r = withFakeGh(TIP, {
      [COMMITS]: mainAt(NEW),
      [COMPARE]: compare('ahead', [f('docs/estado.md'), f('docs/reportes/F-11-qa.md'), f('README.md'), f('supabase/README.md'), f('docs/img/diagrama.png')]),
    });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.calls, [COMMITS, COMPARE]);
  });

  test('límite de la lista de compare: 299 archivos de docs → 0; 300 → 1 (no se puede afirmar)', () => {
    const files = (n) => Array.from({ length: n }, (_, i) => f(`docs/n${i}.md`));
    assert.equal(withFakeGh(TIP, { [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', files(299)) }).code, 0);
    assert.equal(withFakeGh(TIP, { [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', files(300)) }).code, 1);
  });

  for (const status of ['behind', 'diverged', 'identical']) {
    test(`compare con status ${status} (no es un avance lineal de main) → 1 aunque los archivos sean docs`, () => {
      const r = withFakeGh(TIP, { [COMMITS]: mainAt(NEW), [COMPARE]: compare(status, [f('docs/estado.md')]) });
      assert.equal(r.code, 1, r.out);
    });
  }

  test('se borra código en un commit posterior (archivo eliminado fuera de docs) → 1', () => {
    const r = withFakeGh(TIP, { [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', [f('src/old.js', { status: 'removed' })]) });
    assert.equal(r.code, 1, r.out);
  });

  // Hallazgo QA-F11-01: un renombrado de código a docs deja en la punta un contenido
  // desplegable distinto (el archivo de código ya no existe), pero filename es docs/.
  test('renombrado src/x.js → docs/x.md en un commit posterior → 1 (lo desplegable cambió)', () => {
    const r = withFakeGh(TIP, {
      [COMMITS]: mainAt(NEW),
      [COMPARE]: compare('ahead', [f('docs/x.md', { status: 'renamed', previous_filename: 'src/x.js' })]),
    });
    assert.equal(r.code, 1, r.out);
  });

  // Hallazgo QA-F11-02: sin lista de archivos no se puede afirmar «solo docs».
  test('respuesta de compare sin el campo files → 1 (falla cerrado, no se puede afirmar «solo docs»)', () => {
    const r = withFakeGh(TIP, { [COMMITS]: mainAt(NEW), [COMPARE]: { out: JSON.stringify({ status: 'ahead', ahead_by: 3 }) } });
    assert.equal(r.code, 1, r.out);
  });

  test('API caída en commits/main → reintenta TIP_RETRIES veces y falla cerrado (1)', () => {
    const r = withFakeGh(TIP, { [COMMITS]: { err: 'HTTP 503: Service Unavailable' } }, { TIP_RETRIES: '3' });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.calls.length, 3);
    assert.match(r.out, /::error::/);
  });

  test('API caída en compare → falla cerrado (1); no se despliega por omisión', () => {
    const r = withFakeGh(TIP, { [COMMITS]: mainAt(NEW), [COMPARE]: { err: 'HTTP 500' } });
    assert.equal(r.code, 1, r.out);
  });

  test('punta de main con SHA en mayúsculas o abreviado (respuesta anómala) → 1', () => {
    for (const sha of [NEW.toUpperCase().replace(/2/g, 'A'), NEW.slice(0, 7), null]) {
      const r = withFakeGh(TIP, { [COMMITS]: mainAt(sha) });
      assert.equal(r.code, 1, String(sha));
    }
  });

  test('workflow_dispatch se exime (0) y no consulta la API; schedule/workflow_run fallan sin consultarla', () => {
    const d = withFakeGh(TIP, {}, { GITHUB_EVENT_NAME: 'workflow_dispatch' });
    assert.equal(d.code, 0);
    assert.deepEqual(d.calls, []);
    for (const ev of ['schedule', 'workflow_run', 'repository_dispatch']) {
      const r = withFakeGh(TIP, { [COMMITS]: mainAt(OLD) }, { GITHUB_EVENT_NAME: ev });
      assert.equal(r.code, 1, ev);
      assert.deepEqual(r.calls, []);
    }
  });

  test('deploy.yml: el paso está en verify y todos los jobs que publican o migran dependen de verify', () => {
    const jobs = DEPLOY_CODE.split(/^jobs:\s*$/m)[1];
    const blocks = Object.fromEntries(
      jobs.split(/^ {2}(?=[A-Za-z0-9_-]+:\s*$)/m).filter((b) => /^[A-Za-z0-9_-]+:/.test(b)).map((b) => [b.split(':')[0], b]),
    );
    assert.match(blocks.verify, /run: bash scripts\/ci\/check-main-tip\.sh/);
    const needs = (name) => {
      const m = blocks[name].match(/^ {4}needs:\s*(.+)$/m);
      return m ? m[1].replace(/[[\]\s]/g, '').split(',').filter(Boolean) : [];
    };
    const reaches = (name, seen = new Set()) => name === 'verify' || needs(name).some((n) => !seen.has(n) && (seen.add(n), reaches(n, seen)));
    for (const name of Object.keys(blocks).filter((n) => n !== 'verify')) assert.ok(reaches(name), `${name} no depende de verify`);
  });
});

describe('[P2] clean_error quita \\r (el runner lo toma como salto de línea)', () => {
  const evil = `HTTP 502 ${TOKEN}\r::error::inyectado\r\n::warning::segunda`;

  test('check-main-tip.sh: sin \\r, sin token y sin comando de workflow inyectado al inicio de línea', () => {
    const r = withFakeGh(TIP, { [COMMITS]: { err: evil } }, { TIP_RETRIES: '1' });
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes('\r'), 'no hay \\r en la salida');
    assert.ok(!r.out.includes(TOKEN), 'no se imprime el token');
    for (const line of r.out.split('\n')) assert.doesNotMatch(line, /^::error::inyectado|^::warning::segunda/);
  });

  test('wait-ci.sh: sin \\r, sin token y sin comando de workflow inyectado al inicio de línea', () => {
    const r = withFakeGh(WAIT, { 'actions/runs': { err: evil } });
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes('\r'), 'no hay \\r en la salida');
    assert.ok(!r.out.includes(TOKEN), 'no se imprime el token');
    for (const line of r.out.split('\n')) assert.doesNotMatch(line, /^::error::inyectado|^::warning::segunda/);
  });
});

describe('[P3] runEmailStep falla cerrado (código 2) sin los métodos de C-06', () => {
  const KEY = ['re', 'qa', 'f11', 'clave', 'ficticia'].join('_');
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x', RESEND_API_KEY: KEY };
  const readSupabaseConfig = (e) => ({ url: e.SUPABASE_URL, secretKey: e.SUPABASE_SECRET_KEY });
  const ALERT = { id: 'qa-1', unit_id: 'u-1', recipient_user_id: '44444444-0000-4000-8000-000000000001', kind: 'color_change', payload: { unit_name: 'Unidad Uno', message: 'x' }, sent_at: '2027-02-01T11:00:00Z', emailed_at: null, email_attempts: 0 };

  /** BD con la forma de C-05 (sin C-06) que registra cualquier acceso. */
  function c05Db(calls) {
    const rec = (n, v) => async () => { calls.push(n); return v; };
    return {
      pendingEmailAlerts: rec('pendingEmailAlerts', [ALERT]),
      userEmail: rec('userEmail', 'destino@example.test'),
      markAlertEmailed: rec('markAlertEmailed', true),
      recordAlertEmailFailure: rec('recordAlertEmailFailure'),
      insertAudit: rec('insertAudit'),
    };
  }
  const c06 = {
    recipientAccess: async () => ({ email: 'destino@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'unit_leader', unit_id: 'u-1' }] }),
    expiredEmailAlerts: async () => [],
    markAlertsEmailSkipped: async () => [],
  };
  const okFetch = (sent) => async () => { sent.push(1); return new Response(JSON.stringify({ id: 'm' }), { status: 200 }); };
  const step = (db, sent, lines) => runEmailStep({
    env, makeDb: async () => db, readSupabaseConfig, log: (l) => lines.push(l), fetchImpl: okFetch(sent),
    now: () => new Date('2027-02-01T12:00:00Z'), sleep: async () => {},
  });

  test('BD de C-05 sin ninguno de los tres → 2, ::error:: con los tres nombres, ni lectura ni envío ni auditoría', async () => {
    const calls = []; const sent = []; const lines = [];
    const r = await step(c05Db(calls), sent, lines);
    assert.equal(r.code, 2);
    assert.deepEqual(calls, []);
    assert.equal(sent.length, 0);
    const err = lines.find((l) => l.startsWith('::error::')) ?? '';
    for (const m of ['recipientAccess', 'expiredEmailAlerts', 'markAlertsEmailSkipped']) assert.ok(err.includes(m), err);
    assert.ok(!lines.join('\n').includes(KEY));
  });

  for (const only of ['recipientAccess', 'expiredEmailAlerts', 'markAlertsEmailSkipped']) {
    test(`solo falta ${only} → 2 y nada se envía`, async () => {
      const calls = []; const sent = []; const lines = [];
      const db = { ...c05Db(calls), ...c06 };
      delete db[only];
      const r = await step(db, sent, lines);
      assert.equal(r.code, 2);
      assert.equal(sent.length, 0);
      assert.deepEqual(calls, []);
    });
  }

  test('un método presente pero que no es función (p. ej. true) cuenta como ausente → 2', async () => {
    const calls = []; const sent = []; const lines = [];
    const r = await step({ ...c05Db(calls), ...c06, expiredEmailAlerts: true }, sent, lines);
    assert.equal(r.code, 2);
    assert.equal(sent.length, 0);
  });

  test('una BD de clase con los métodos en el prototipo es válida y envía (0)', async () => {
    const calls = [];
    class Db {
      async pendingEmailAlerts() { return [ALERT]; }
      async userEmail() { return 'destino@example.test'; }
      async markAlertEmailed() { calls.push('mark'); return true; }
      async recordAlertEmailFailure() {}
      async insertAudit() {}
      recipientAccess() { return c06.recipientAccess(); }
      expiredEmailAlerts() { return c06.expiredEmailAlerts(); }
      markAlertsEmailSkipped() { return c06.markAlertsEmailSkipped(); }
    }
    const sent = []; const lines = [];
    const r = await step(new Db(), sent, lines);
    assert.equal(r.code, 0, lines.join('\n'));
    assert.equal(sent.length, 1);
    assert.deepEqual(calls, ['mark']);
  });

  test('con los tres métodos, un destinatario sin rol en la unidad no recibe correo (la comprobación se aplica)', async () => {
    const calls = []; const sent = []; const lines = [];
    const db = { ...c05Db(calls), ...c06, recipientAccess: async () => ({ email: 'destino@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'unit_leader', unit_id: 'otra' }] }) };
    const r = await step(db, sent, lines);
    assert.equal(sent.length, 0);
    assert.notEqual(r.code, 2);
  });

  test('sin RESEND_API_KEY sigue siendo 0 con ::notice:: sin abrir la BD (no cambia C-05)', async () => {
    const lines = [];
    const r = await runEmailStep({
      env: { ...env, RESEND_API_KEY: '' }, makeDb: async () => assert.fail('no debe abrir la BD'), readSupabaseConfig,
      log: (l) => lines.push(l), fetchImpl: async () => assert.fail('no debe llamar a Resend'),
    });
    assert.equal(r.code, 0);
    assert.ok(lines.some((l) => l.startsWith('::notice::')));
  });
});

describe('[P4] suma de timeout-minutes de deploy.yml ≤ maxPendingMin', () => {
  test('cada job fija timeout-minutes y la suma no supera DEPLOY_RULE.maxPendingMin', () => {
    const jobsSection = DEPLOY_CODE.split(/^jobs:\s*$/m)[1];
    const names = [...jobsSection.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
    const timeouts = [...jobsSection.matchAll(/^ {4}timeout-minutes:\s*(\d+)\s*$/gm)].map((m) => Number(m[1]));
    assert.ok(names.length > 0);
    assert.equal(timeouts.length, names.length, `jobs ${names.join(', ')} vs timeouts ${timeouts.join(', ')}`);
    const sum = timeouts.reduce((a, b) => a + b, 0);
    assert.ok(sum <= DEPLOY_RULE.maxPendingMin, `suma ${sum} > ${DEPLOY_RULE.maxPendingMin}`);
  });

  test('ningún timeout-minutes de deploy.yml es una expresión (que la suma no se pueda leer)', () => {
    assert.doesNotMatch(DEPLOY_CODE, /timeout-minutes:\s*\$\{\{/);
  });
});

// ---------------------------------------------------------------- intento 2
// [P1-a] H-ARQ-F11-01: dos merges seguidos. Si un merge más nuevo con código supera a este
//        run en su PRIMER intento, verify da deploy=false y el run termina en success sin
//        publicar; en un relanzamiento (intento > 1) es error. Solo build-pages lleva el if:.
// [P1-b] H-ARQ-F11-02: migrate y deploy-pages repiten la comprobación con --strict (superado =
//        error siempre), porque «Re-run failed jobs» no repite verify (cierra QA-F11-03).
// [P1-c] H-QA-V05c-03: el filtro de wait-ci.sh exige head_sha y event exactos.

/** check-main-tip.sh con GITHUB_OUTPUT en un archivo temporal; devuelve también su contenido. */
function tipRun(answers, env = {}, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-f11-out-'));
  const file = join(dir, 'out');
  writeFileSync(file, '');
  try {
    const r = withFakeGh(TIP, answers, { GITHUB_OUTPUT: file, ...env }, args);
    return { ...r, output: readFileSync(file, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const superseded = () => ({ [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', [f('docs/estado.md'), f('src/app.js')]) });

describe('[P1-a] carrera de merges: salida deploy de verify', () => {
  test('superado por código en el intento 1 → 0, ::warning:: (no ::error::) y GITHUB_OUTPUT = deploy=false exacto', () => {
    const r = tipRun(superseded(), { GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /::warning::/);
    assert.doesNotMatch(r.out, /::error::/);
    assert.equal(r.output, 'deploy=false\n');
  });

  for (const attempt of ['2', '3', '', '01', '1 ', 'abc']) {
    test(`superado por código con GITHUB_RUN_ATTEMPT=${JSON.stringify(attempt)} (relanzamiento o desconocido) → 1 y sin deploy=`, () => {
      const r = tipRun(superseded(), { GITHUB_RUN_ATTEMPT: attempt });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /::error::/);
      assert.equal(r.output, '');
    });
  }

  test('punta exacta, solo docs detrás y workflow_dispatch → 0 con deploy=true (una sola línea)', () => {
    for (const [answers, env] of [
      [{ [COMMITS]: mainAt(OLD) }, {}],
      [{ [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', [f('docs/estado.md')]) }, {}],
      [{}, { GITHUB_EVENT_NAME: 'workflow_dispatch' }],
    ]) {
      const r = tipRun(answers, { GITHUB_RUN_ATTEMPT: '1', ...env });
      assert.equal(r.code, 0, r.out);
      assert.equal(r.output, 'deploy=true\n');
    }
  });

  test('renombrado de código a docs en el intento 1 cuenta como código: deploy=false, nunca deploy=true', () => {
    const r = tipRun({ [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', [f('docs/x.md', { status: 'renamed', previous_filename: 'src/x.js' })]) }, { GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.output, 'deploy=false\n');
  });

  // Lo que no se puede afirmar no es «la carrera prevista»: falla aunque sea el intento 1.
  for (const [label, answers] of [
    ['compare sin files', { [COMMITS]: mainAt(NEW), [COMPARE]: { out: JSON.stringify({ status: 'ahead' }) } }],
    ['lista truncada (300)', { [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', Array.from({ length: 300 }, (_, i) => f(`docs/${i}.md`))) }],
    ['behind', { [COMMITS]: mainAt(NEW), [COMPARE]: compare('behind', [f('src/a.js')]) }],
    ['diverged', { [COMMITS]: mainAt(NEW), [COMPARE]: compare('diverged', [f('src/a.js')]) }],
    ['API caída', { [COMMITS]: { err: 'HTTP 503' } }],
  ]) {
    test(`intento 1 con ${label} → 1 (falla cerrado, no se convierte en deploy=false)`, () => {
      const r = tipRun(answers, { GITHUB_RUN_ATTEMPT: '1' });
      assert.equal(r.code, 1, r.out);
      assert.doesNotMatch(r.output, /deploy=(true|false)/);
    });
  }

  test('superado en el intento 1 sin GITHUB_OUTPUT → 1 (no se puede saltar la cadena)', () => {
    const r = withFakeGh(TIP, superseded(), { GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(r.code, 1, r.out);
  });

  test('deploy.yml: verify publica outputs.deploy del paso id: tip (sin --strict) y build-pages es el único con if:', () => {
    assert.match(DEPLOY_CODE, /^ {6}deploy: \$\{\{ steps\.tip\.outputs\.deploy \}\}\s*$/m);
    const verify = DEPLOY_CODE.split(/^ {2}verify:\s*$/m)[1].split(/^ {2}[\w-]+:\s*$/m)[0];
    const tipStep = verify.slice(verify.indexOf('id: tip'));
    assert.match(tipStep, /^ {8}run: bash scripts\/ci\/check-main-tip\.sh\s*$/m, 'verify corre sin --strict');
    const ifs = DEPLOY_CODE.split('\n').filter((l) => /^\s+(- )?if:/.test(l));
    assert.deepEqual(ifs, ["    if: needs.verify.outputs.deploy == 'true'"]);
  });
});

describe('[P1-b] --strict en migrate y deploy-pages', () => {
  test('superado por código → 1 también en el intento 1, y nunca escribe en GITHUB_OUTPUT', () => {
    for (const attempt of ['1', '2']) {
      const r = tipRun(superseded(), { GITHUB_RUN_ATTEMPT: attempt }, ['--strict']);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /::error::/);
      assert.equal(r.output, '');
    }
  });

  test('punta exacta, solo docs detrás y workflow_dispatch → 0 sin tocar GITHUB_OUTPUT', () => {
    for (const [answers, env] of [
      [{ [COMMITS]: mainAt(OLD) }, {}],
      [{ [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', [f('README.md')]) }, {}],
      [{}, { GITHUB_EVENT_NAME: 'workflow_dispatch' }],
    ]) {
      const r = tipRun(answers, { GITHUB_RUN_ATTEMPT: '2', ...env }, ['--strict']);
      assert.equal(r.code, 0, r.out);
      assert.equal(r.output, '');
    }
  });

  test('argumento desconocido o de más → 1 sin consultar la API', () => {
    for (const args of [['--lax'], ['--strict', 'x'], ['strict']]) {
      const r = tipRun({ [COMMITS]: mainAt(OLD) }, {}, args);
      assert.equal(r.code, 1, args.join(' '));
      assert.deepEqual(r.calls, [], args.join(' '));
    }
  });

  test('deploy.yml: migrate y deploy-pages corren --strict antes de la CLI de Supabase y de deploy-pages', () => {
    const block = (id) => DEPLOY_CODE.split(new RegExp(`^ {2}${id}:\\s*$`, 'm'))[1].split(/^ {2}[\w-]+:\s*$/m)[0];
    for (const [id, effect] of [['migrate', /uses: supabase\/setup-cli@/], ['deploy-pages', /uses: actions\/deploy-pages@/]]) {
      const b = block(id);
      const strict = b.search(/run: bash scripts\/ci\/check-main-tip\.sh --strict\s*$/m);
      assert.ok(strict > 0, `${id}: falta check-main-tip.sh --strict`);
      assert.ok(strict < b.search(effect), `${id}: --strict va después del efecto`);
      assert.match(b, /HEAD_SHA: \$\{\{ github\.sha \}\}/);
      assert.match(b, /GH_TOKEN: \$\{\{ github\.token \}\}/);
      assert.match(b, /contents: read/, `${id}: el token necesita contents: read`);
    }
  });
});

describe('[P1-c] wait-ci.sh: solo cuenta un run con head_sha y event exactos', () => {
  const runs = (r) => ({ out: JSON.stringify({ workflow_runs: [r] }) });
  const base = { id: 7, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success' };

  test('run de CI success con head_sha y event push exactos → 0', () => {
    const r = withFakeGh(WAIT, { 'actions/runs': runs({ ...base, head_sha: OLD, event: 'push' }) });
    assert.equal(r.code, 0, r.out);
  });

  for (const [label, extra] of [
    ['sin head_sha', { event: 'push' }],
    ['sin event', { head_sha: OLD }],
    ['head_sha de otro commit', { head_sha: NEW, event: 'push' }],
    ['event pull_request', { head_sha: OLD, event: 'pull_request' }],
    ['head_sha null', { head_sha: null, event: 'push' }],
  ]) {
    test(`run success ${label} no cuenta → 1 (no apareció el CI del commit)`, () => {
      const r = withFakeGh(WAIT, { 'actions/runs': runs({ ...base, ...extra }) });
      assert.equal(r.code, 1, r.out);
    });
  }
});
