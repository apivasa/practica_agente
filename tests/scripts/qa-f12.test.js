// QA F-12 (tester) — cada caso traza a un punto del criterio de aceptación de F-12:
//  [a] check-main-tip.sh ya no exime workflow_dispatch: un run de dispatch superado por
//      código falla, también con --strict; un disparo nuevo en la punta despliega.
//      (Orquestador: «la misma regla que push».)
//  [b] el `status` de compare impreso solo contiene [a-z_] (una línea).
//  [c] H-F11-06 (rojo esperado de deploy-pages --strict cuando entra un merge mientras
//      migrate corre) documentado en el mensaje/script.
//  [d] la ruta `expired` del correo marca y audita atómicamente vía la RPC
//      public.mark_alerts_email_expired (aquí: la capa JS; la BD en supabase/tests/125_qa_f12).
// gh se sustituye por un ejecutable falso (sin red); nunca se llama a la API real.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sendAlertEmails, runEmailStep, MAX_ATTEMPTS } from '../../scripts/lib/email.js';
import { createDb } from '../../scripts/lib/db.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIP = join(ROOT, 'scripts', 'ci', 'check-main-tip.sh');
const TIP_SRC = readFileSync(TIP, 'utf8');
const DEPLOY = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

const OLD = '3'.repeat(40);
const NEW = '4'.repeat(40);
const TOKEN = ['ghs', 'qaF12', 'y'.repeat(12)].join('');
const COMMITS = 'repos/org/app/commits/main';
const COMPARE = `repos/org/app/compare/${OLD}...${NEW}`;

/**
 * check-main-tip.sh con un gh falso: `answers` mapea un fragmento de ruta a { out } o { err }.
 * Devuelve código, salida, rutas pedidas y contenido de GITHUB_OUTPUT.
 */
function tip(answers, env = {}, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-f12-'));
  try {
    const outFile = join(dir, 'out');
    writeFileSync(outFile, '');
    const branches = Object.entries(answers).map(([frag, a], i) => {
      writeFileSync(join(dir, `a${i}`), a.out ?? a.err ?? '');
      const err = a.err !== undefined;
      return `  *'${frag}'*) cat "${dir}/a${i}" ${err ? '>&2' : ''}; exit ${err ? 1 : 0} ;;`;
    }).join('\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\nprintf '%s\\n' "$2" >> "${dir}/calls"\ncase "$2" in\n${branches}\nesac\necho "HTTP 404" >&2; exit 1\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const r = spawnSync('bash', [TIP, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'org/app',
        HEAD_SHA: OLD, GH_TOKEN: TOKEN, TIP_RETRIES: '1', TIP_RETRY_INTERVAL_SECONDS: '0', GITHUB_OUTPUT: outFile, ...env,
      },
    });
    let calls = [];
    try { calls = readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean); } catch { /* sin llamadas */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, calls, output: readFileSync(outFile, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mainAt = (sha) => ({ out: JSON.stringify({ sha }) });
const compare = (status, files) => ({ out: JSON.stringify({ status, files: files.map((filename) => ({ filename })) }) });
const superseded = (status = 'ahead') => ({ [COMMITS]: mainAt(NEW), [COMPARE]: compare(status, ['src/app.js']) });

describe('[a] workflow_dispatch sigue la regla de la punta de main', () => {
  test('disparo nuevo en la punta → 0, consulta commits/main y deploy=true', () => {
    const r = tip({ [COMMITS]: mainAt(OLD) }, { GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.calls, [COMMITS]);
    assert.equal(r.output, 'deploy=true\n');
  });

  for (const attempt of ['2', '5', '']) {
    test(`dispatch viejo superado por código (relanzamiento, intento ${JSON.stringify(attempt)}) sin --strict → 1 sin deploy=`, () => {
      const r = tip(superseded(), { GITHUB_RUN_ATTEMPT: attempt });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /::error::Hay un commit más nuevo en main \(4{40}\)/);
      assert.equal(r.output, '');
    });
  }

  for (const attempt of ['1', '2', '']) {
    test(`dispatch viejo superado por código con --strict (intento ${JSON.stringify(attempt)}) → 1 sin tocar GITHUB_OUTPUT`, () => {
      const r = tip(superseded(), { GITHUB_RUN_ATTEMPT: attempt }, ['--strict']);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /::error::/);
      assert.equal(r.output, '');
    });
  }

  test('dispatch superado en el intento 1 sin --strict nunca publica (deploy=false, nunca deploy=true)', () => {
    const r = tip(superseded(), { GITHUB_RUN_ATTEMPT: '1' });
    assert.doesNotMatch(r.output, /deploy=true/);
    assert.equal(r.output, 'deploy=false\n');
  });

  test('dispatch con API caída, compare behind/diverged o sin lista de archivos → 1 (no se exime)', () => {
    for (const [label, answers] of [
      ['API caída', { [COMMITS]: { err: 'HTTP 503' } }],
      ['behind', superseded('behind')],
      ['diverged', superseded('diverged')],
      ['sin files', { [COMMITS]: mainAt(NEW), [COMPARE]: { out: JSON.stringify({ status: 'ahead' }) } }],
    ]) {
      for (const args of [[], ['--strict']]) {
        const r = tip(answers, { GITHUB_RUN_ATTEMPT: '1' }, args);
        assert.equal(r.code, 1, `${label} ${args}: ${r.out}`);
        assert.doesNotMatch(r.output, /deploy=true/, label);
      }
    }
  });

  // «La misma regla que push»: mismo código de salida y misma salida deploy= en una matriz.
  test('paridad: dispatch y push dan el mismo resultado en todos los escenarios', () => {
    const scenarios = [
      ['punta', { [COMMITS]: mainAt(OLD) }],
      ['solo docs detrás', { [COMMITS]: mainAt(NEW), [COMPARE]: compare('ahead', ['docs/estado.md', 'README.md']) }],
      ['código detrás', superseded()],
      ['renombrado código→docs', { [COMMITS]: mainAt(NEW), [COMPARE]: { out: JSON.stringify({ status: 'ahead', files: [{ filename: 'docs/x.md', previous_filename: 'src/x.js' }] }) } }],
      ['behind', superseded('behind')],
      ['API caída', { [COMMITS]: { err: 'HTTP 502' } }],
    ];
    for (const [label, answers] of scenarios) {
      for (const attempt of ['1', '2']) {
        for (const args of [[], ['--strict']]) {
          const d = tip(answers, { GITHUB_RUN_ATTEMPT: attempt }, args);
          const p = tip(answers, { GITHUB_RUN_ATTEMPT: attempt, GITHUB_EVENT_NAME: 'push' }, args);
          const ctx = `${label} intento ${attempt} ${args.join(' ')}`;
          assert.equal(d.code, p.code, ctx);
          assert.equal(d.output, p.output, ctx);
          assert.deepEqual(d.calls, p.calls, ctx);
        }
      }
    }
  });

  test('deploy.yml: verify exige refs/heads/main y confirm=desplegar antes del paso de la punta (un dispatch desde otra rama no llega)', () => {
    const verify = DEPLOY.split(/^ {2}verify:\s*$/m)[1].split(/^ {2}[\w-]+:\s*$/m)[0];
    const ref = verify.indexOf('"${GITHUB_REF}" != "refs/heads/main"');
    const confirm = verify.indexOf('"${CONFIRM}" != "desplegar"');
    const step = verify.indexOf('run: bash scripts/ci/check-main-tip.sh');
    assert.ok(ref > 0 && confirm > 0 && step > ref && step > confirm);
    // Sin if: por evento en el paso de la punta: lo decide el script.
    const tipStep = verify.slice(verify.lastIndexOf('- name:', step), step);
    assert.doesNotMatch(tipStep, /^\s*if:/m);
  });
});

describe('[b] status de compare saneado a [a-z_] en una línea', () => {
  // Separadores de línea Unicode y NUL armados en ejecución (sin caracteres invisibles en la fuente).
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const LINE_BREAK = new RegExp(`\\r\\n|\\r|\\n|${LS}|${PS}`);
  const nasty = ['ahead\n::error::inyectado', 'behind\n', 'diverged\r\n::add-mask::x', 'AHEAD', 'ahead%0A::warning::z', 'be-hind', `${LS}ahead`, `behind${PS}::error::p`, `ahead${String.fromCharCode(0)}x`];
  for (const status of nasty) {
    for (const args of [[], ['--strict']]) {
      // Nombre en ASCII: los separadores y el NUL se muestran como \uXXXX en el log del CI.
      const shown = JSON.stringify(status).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      test(`status ${shown} ${args.join(' ') || 'sin --strict'} (relanzamiento) → 1, una línea y status [a-z_]`, () => {
        const r = tip({ [COMMITS]: mainAt(NEW), [COMPARE]: compare(status, ['src/a.js']) }, { GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'push' }, args);
        assert.equal(r.code, 1, r.out);
        const lines = r.out.split(LINE_BREAK).filter((l) => l.length > 0);
        assert.equal(lines.length, 1, JSON.stringify(r.out));
        assert.ok(lines[0].startsWith('::error::'), lines[0]);
        // «::error::» aporta los dos únicos «::» de la línea: el status no inyecta otro comando.
        assert.equal((lines[0].match(/::/g) ?? []).length, 2, `solo un comando de workflow: ${lines[0]}`);
        const m = lines[0].match(/cambios desplegables \(([^)]*)\)/);
        assert.ok(m, lines[0]);
        assert.match(m[1], /^[a-z_]+$/);
        assert.equal(r.output, '');
      });
    }
  }

  test('un status anómalo con solo docs detrás nunca se toma por «solo documentación» (no deploy=true)', () => {
    for (const status of ['ahead\n', ' ahead', 'Ahead']) {
      for (const attempt of ['1', '2']) {
        const r = tip({ [COMMITS]: mainAt(NEW), [COMPARE]: compare(status, ['docs/estado.md']) }, { GITHUB_RUN_ATTEMPT: attempt, GITHUB_EVENT_NAME: 'push' });
        assert.doesNotMatch(r.output, /deploy=true/, `${JSON.stringify(status)} ${attempt}`);
        assert.doesNotMatch(r.out, /solo con cambios de documentación/);
      }
    }
  });

  test('el saneo vive en el filtro jq del script (gsub a [^a-z_])', () => {
    assert.match(TIP_SRC, /gsub\("\[\^a-z_\]"; ""\)/);
  });
});

describe('[c] H-F11-06 documentado en el mensaje y en el script', () => {
  test('--strict superado en el intento 1: ::error:: cita H-F11-06, dice que es esperado y pide no relanzar', () => {
    for (const ev of ['push', 'workflow_dispatch']) {
      const r = tip(superseded(), { GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: ev }, ['--strict']);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /^::error::.*H-F11-06.*no relances este run/m, ev);
    }
  });

  test('el rojo esperado solo se anuncia en ese caso: no en relanzamiento, ni sin --strict, ni con behind', () => {
    const cases = [
      [superseded(), '2', ['--strict']],
      [superseded(), '', ['--strict']],
      [superseded('behind'), '1', ['--strict']],
      [superseded(), '2', []],
    ];
    for (const [answers, attempt, args] of cases) {
      const r = tip(answers, { GITHUB_RUN_ATTEMPT: attempt, GITHUB_EVENT_NAME: 'push' }, args);
      assert.equal(r.code, 1, r.out);
      assert.doesNotMatch(r.out, /Rojo esperado|H-F11-06/, `${attempt} ${args}`);
    }
  });

  test('el script y deploy.yml (job deploy-pages) explican H-F11-06 en comentarios', () => {
    assert.match(TIP_SRC, /^# F-12 \(H-F11-06\):/m);
    const pages = DEPLOY.split(/^ {2}deploy-pages:\s*$/m)[1].split(/^ {2}[\w-]+:\s*$/m)[0];
    assert.match(pages, /#.*H-F11-06/);
  });
});

describe('[d] ruta expired: marca y auditoría en una sola RPC', () => {
  const NOW = new Date('2027-05-20T15:00:00Z');
  const CONFIG = { apiKey: ['re', 'QAF12', 'ficticia'].join('_'), from: 'alertas@example.test', appUrl: null, lookbackDays: 7 };
  const ID1 = 'f12d0000-0000-4000-8000-000000000001';
  const ID2 = 'f12d0000-0000-4000-8000-000000000002';

  /** BD simulada con la RPC; registra cada llamada en orden. */
  function fakeDb({ rpc } = {}) {
    const log = [];
    return {
      log,
      pendingEmailAlerts: async () => [],
      userEmail: async () => null,
      markAlertEmailed: async () => true,
      recordAlertEmailFailure: async () => {},
      recipientAccess: async () => null,
      insertAudit: async (rows) => { log.push(['insertAudit', rows]); },
      expiredEmailAlerts: async () => [
        { id: ID1, kind: 'color_change', sent_at: '2027-05-01T00:00:00Z', email_attempts: 0 },
        { id: ID2, kind: 'color_change', sent_at: '2027-05-02T00:00:00Z', email_attempts: 2 },
      ],
      markAlertsEmailSkipped: async (ids) => { log.push(['markAlertsEmailSkipped', ids]); return ids; },
      markAlertsEmailExpired: async (ids, opts) => { log.push(['rpc', ids, opts]); return rpc ? rpc(ids) : ids; },
    };
  }

  test('si la RPC falla, la corrida no marca ni audita por otra vía (ni marca suelta ni insertAudit)', async () => {
    const db = fakeDb({ rpc: () => { throw new Error('mark_alerts_email_expired: HTTP 500'); } });
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
    assert.deepEqual(db.log.map((l) => l[0]), ['rpc']);
    assert.equal(s.expired, 0);
    assert.equal(s.errors.length, 1);
    assert.match(s.errors[0], /fuera de la ventana/);
  });

  test('el error de la RPC no filtra la clave de Resend', async () => {
    const db = fakeDb({ rpc: () => { throw new Error(`fallo con ${CONFIG.apiKey}`); } });
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
    assert.doesNotMatch(s.errors.join(' '), new RegExp(CONFIG.apiKey));
  });

  test('la RPC recibe el mismo corte (before) y tope que la consulta de vencidas', async () => {
    let query;
    const db = fakeDb();
    db.expiredEmailAlerts = async (q) => { query = q; return [{ id: ID1 }]; };
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
    const [, ids, opts] = db.log.find((l) => l[0] === 'rpc');
    assert.deepEqual(ids, [ID1]);
    assert.equal(opts.before, query.before);
    assert.equal(opts.maxAttempts, query.maxAttempts);
    assert.equal(opts.maxAttempts, MAX_ATTEMPTS);
  });

  test('ids que la RPC devuelve de más (no pedidos) no inflan el resumen más allá de lo devuelto; sin ids no se llama', async () => {
    const db = fakeDb({ rpc: () => [ID1] });
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
    assert.equal(s.expired, 1);
    const empty = fakeDb();
    empty.expiredEmailAlerts = async () => [{ id: null }, {}];
    await sendAlertEmails(empty, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
    assert.deepEqual(empty.log, []);
  });

  test('la capa real (createDb) siempre expone markAlertsEmailExpired: en producción la ruta expired es la RPC', async () => {
    const rpcCalls = [];
    const sb = { rpc: async (name, params) => { rpcCalls.push([name, params]); return { data: [{ alert_id: ID2 }, { alert_id: 7 }, null], error: null }; } };
    const db = createDb(sb);
    assert.equal(typeof db.markAlertsEmailExpired, 'function');
    const out = await db.markAlertsEmailExpired([ID2], { before: 'b', maxAttempts: 3, skippedAt: 's', lookbackDays: 7 });
    assert.deepEqual(out, [ID2]);
    assert.deepEqual(rpcCalls, [['mark_alerts_email_expired', { p_ids: [ID2], p_before: 'b', p_max_attempts: 3, p_skipped_at: 's', p_lookback_days: 7 }]]);
  });

  test('con la RPC fallando, runEmailStep termina en error (no en verde silencioso)', async () => {
    const db = fakeDb({ rpc: () => { throw new Error('caída'); } });
    const { code } = await runEmailStep({
      env: { RESEND_API_KEY: CONFIG.apiKey, ALERT_EMAIL_FROM: CONFIG.from },
      fetchImpl: async () => assert.fail('no envía'),
      makeDb: async () => db,
      readSupabaseConfig: () => ({}),
      now: () => NOW,
      log: () => {},
    });
    assert.notEqual(code, 0);
  });
});
