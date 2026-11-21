// V-04 — Comprobaciones de salud (disponibilidad y workflows programados).
// Funciones puras o con dependencias inyectadas (fetch, cliente de GitHub, reloj, espera)
// para poder probarlas sin red. Nunca incluyen claves, URLs de Supabase ni datos de
// unidades en los mensajes: el repositorio es público y los fallos acaban en un issue.
import { businessDate } from '../../engine/index.js';

export const DEFAULT_PAGES_URL = 'https://apivasa.github.io/practica_agente/';
export const HEALTH_LABEL = 'salud';
export const ISSUE_TITLE = 'Salud del sistema: comprobación fallida';

const HOUR_MS = 3_600_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Reglas por workflow programado. Configuración, no código: añadir un workflow es añadir una fila.
 * - requiresProduction: solo se exige que haya corrido si EVALUATION_ENABLED === 'true'.
 * - event: filtra por evento (p. ej. solo `schedule`); null = cualquiera.
 * - maxAgeHours: el último run válido no puede ser más viejo.
 * - monthly: en lugar de antigüedad, exige un run en el mes actual (Guayaquil) desde el día 2.
 * - requiredStep: paso que no puede quedar `skipped` con producción activa.
 * - maxDurationMin: duración máxima del run.
 */
export const WORKFLOW_RULES = Object.freeze([
  { file: 'ritmo-diario.yml', check: 'ritmo-diario', requiresProduction: true, event: null, maxAgeHours: 30, requiredStep: 'Evaluar', maxDurationMin: 5 },
  { file: 'evaluacion-mensual.yml', check: 'evaluacion-mensual', requiresProduction: true, event: null, monthly: true, requiredStep: 'Evaluar', maxDurationMin: 5 },
  { file: 'seguridad.yml', check: 'seguridad-semanal', requiresProduction: false, event: 'schedule', maxAgeHours: 8 * 24 },
  { file: 'ci.yml', check: 'ci-main', requiresProduction: false, event: 'push', latestOnly: true },
  // C-06 (H-ARQ-C05-01, ADR 0017 punto 10): cron dos veces al día (11:53 y 14:53 UTC), así que
  // 30 h toleran un día con ambos crons perdidos o muy retrasados, igual que ritmo-diario.
  { file: 'correo-alertas.yml', check: 'correo-alertas', requiresProduction: true, event: null, maxAgeHours: 30, requiredStep: 'Enviar correos', maxDurationMin: 10 },
]);

/**
 * Despliegue (V-04b, H-ARQ-V05b-02): último run de `Despliegue` en main, con disparo
 * `push` o `workflow_dispatch`. Fuera de WORKFLOW_RULES porque no es programado.
 * - maxPendingMin: un run sin terminar (queued, in_progress, waiting...) no puede llevar más.
 */
export const DEPLOY_RULE = Object.freeze({ file: 'deploy.yml', check: 'deploy-main', events: Object.freeze(['push', 'workflow_dispatch']), maxPendingMin: 60 });

/** @typedef {{ check: string, status: 'ok' | 'fail' | 'skip' | 'warn', detail: string }} Result */

/** @returns {Result} */
const result = (check, status, detail) => ({ check, status, detail });

/** ¿URL aceptable? https, o http solo hacia loopback (Supabase local / simulación en CI). */
export function safeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (u.protocol === 'https:') return u;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return u;
  return null;
}

/**
 * GET con reintento. Devuelve un Result sin cuerpo ni cabeceras de la respuesta.
 * @param {{ check: string, url: string, fetchImpl: typeof fetch, headers?: Record<string,string>,
 *   attempts?: number, delayMs?: number, timeoutMs?: number, sleep?: (ms:number)=>Promise<void> }} o
 * @returns {Promise<Result>}
 */
export async function checkHttp({ check, url, fetchImpl, headers = {}, attempts = 2, delayMs = 10_000, timeoutMs = 15_000, sleep = defaultSleep }) {
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchImpl(url, { method: 'GET', headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 200) return result(check, 'ok', i === 1 ? 'HTTP 200' : `HTTP 200 (intento ${i})`);
      last = `HTTP ${res.status}`;
    } catch (e) {
      // Solo el tipo de error: el mensaje podría incluir la URL.
      last = `sin respuesta (${e?.name === 'TimeoutError' ? 'timeout' : 'error de red'})`;
    }
    if (i < attempts) await sleep(delayMs);
  }
  return result(check, 'fail', `${last} tras ${attempts} intentos`);
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Disponibilidad: web de Pages (200) y Auth de Supabase (`/auth/v1/health`, 200) con la clave publicable.
 * La consulta a Supabase además evita la pausa por inactividad del plan gratuito.
 * Sin producción activa, ambas se omiten.
 */
export async function checkAvailability({ env, fetchImpl, sleep, delayMs }) {
  if (env.EVALUATION_ENABLED !== 'true') {
    const why = 'producción inactiva (EVALUATION_ENABLED no es true)';
    return [result('pages', 'skip', why), result('supabase', 'skip', why)];
  }
  const out = [];
  const pages = safeUrl(env.PAGES_URL || DEFAULT_PAGES_URL);
  out.push(
    pages
      ? await checkHttp({ check: 'pages', url: pages.href, fetchImpl, sleep, delayMs })
      : result('pages', 'fail', 'PAGES_URL no es https'),
  );
  const base = safeUrl(env.SUPABASE_URL);
  const key = String(env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!base) out.push(result('supabase', 'fail', 'falta SUPABASE_URL o no es https'));
  else if (!key.startsWith('sb_publishable_')) out.push(result('supabase', 'fail', 'falta SUPABASE_PUBLISHABLE_KEY (sb_publishable_...)'));
  else {
    const url = new URL('auth/v1/health', base.href.endsWith('/') ? base.href : `${base.href}/`).href;
    out.push(await checkHttp({ check: 'supabase', url, fetchImpl, headers: { apikey: key }, sleep, delayMs }));
  }
  return out;
}

const hoursBetween = (a, b) => (b - a) / HOUR_MS;
const fmtHours = (h) => `${Math.round(h)} h`;

/**
 * Evalúa un workflow programado con los datos ya leídos de la API (pura).
 * @param {typeof WORKFLOW_RULES[number]} rule
 * @param {{ workflow: any, runs: any[], jobs?: any[], now: Date, productionEnabled: boolean }} data
 * @returns {Result}
 */
export function assessWorkflow(rule, { workflow, runs, jobs = [], now, productionEnabled }) {
  if (!workflow) return result(rule.check, 'fail', `${rule.file} no existe en la rama por defecto`);
  if (workflow.state !== 'active') {
    return result(rule.check, 'fail', `${rule.file} deshabilitado (${workflow.state}); reactivar con PUT .../enable`);
  }
  if (rule.requiresProduction && !productionEnabled) {
    return result(rule.check, 'skip', 'activo; producción inactiva, no se exige ejecución');
  }
  const done = runs
    .filter((r) => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped')
    .filter((r) => !rule.event || r.event === rule.event)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const nowMs = now.getTime();
  const createdMs = Date.parse(workflow.created_at ?? '') || 0;

  let candidate = done[0];
  if (rule.monthly) {
    const month = businessDate(now).slice(0, 7);
    const day = Number(businessDate(now).slice(8, 10));
    candidate = done.find((r) => businessDate(new Date(r.created_at)).slice(0, 7) === month);
    if (!candidate) {
      if (day < 2) return result(rule.check, 'ok', 'día 1: el cierre del mes aún puede estar en curso');
      if (businessDate(new Date(createdMs)).slice(0, 7) === month) return result(rule.check, 'ok', 'workflow creado este mes; sin cierre que exigir');
      return result(rule.check, 'fail', `sin run del cierre mensual de ${month}`);
    }
  } else if (!candidate) {
    if (rule.maxAgeHours && hoursBetween(createdMs, nowMs) < rule.maxAgeHours) {
      return result(rule.check, 'ok', 'workflow reciente; aún no le toca correr');
    }
    return result(rule.check, rule.latestOnly ? 'skip' : 'fail', 'sin runs completados');
  }

  const problems = [];
  if (candidate.conclusion !== 'success') problems.push(`último run terminó en ${candidate.conclusion}`);
  if (rule.maxAgeHours) {
    const age = hoursBetween(Date.parse(candidate.created_at), nowMs);
    if (age > rule.maxAgeHours) problems.push(`último run hace ${fmtHours(age)} (máximo ${rule.maxAgeHours} h)`);
  }
  if (rule.maxDurationMin && candidate.run_started_at && candidate.updated_at) {
    const min = (Date.parse(candidate.updated_at) - Date.parse(candidate.run_started_at)) / 60_000;
    if (min > rule.maxDurationMin) problems.push(`duró ${Math.round(min)} min (máximo ${rule.maxDurationMin})`);
  }
  if (rule.requiredStep && productionEnabled && candidate.conclusion === 'success') {
    const steps = jobs.flatMap((j) => j.steps ?? []).filter((s) => s.name === rule.requiredStep);
    if (steps.length > 0 && steps.every((s) => s.conclusion === 'skipped')) {
      problems.push(`paso "${rule.requiredStep}" omitido con EVALUATION_ENABLED=true (¿falta un secreto?)`);
    }
  }
  const link = candidate.html_url ? ` — ${candidate.html_url}` : '';
  return problems.length > 0
    ? result(rule.check, 'fail', `${problems.join('; ')}${link}`)
    : result(rule.check, 'ok', `último run ${candidate.conclusion}${link}`);
}

/**
 * Cliente mínimo de la API REST de GitHub (solo lectura de Actions y escritura de issues).
 * @param {{ token: string, repo: string, apiUrl?: string, fetchImpl: typeof fetch }} o
 */
export function createGitHubClient({ token, repo, apiUrl = 'https://api.github.com', fetchImpl }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY inválido');
  const base = `${apiUrl.replace(/\/$/, '')}/repos/${repo}`;
  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'salud-workflow',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) return null;
    if (res.status === 422 && method === 'POST' && path === '/labels') return null; // ya existe
    if (!res.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]}: HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
  return {
    getWorkflow: (file) => call('GET', `/actions/workflows/${encodeURIComponent(file)}`),
    listRuns: (file, { branch, event } = {}) => {
      const q = new URLSearchParams({ per_page: '20' });
      if (branch) q.set('branch', branch);
      if (event) q.set('event', event);
      return call('GET', `/actions/workflows/${encodeURIComponent(file)}/runs?${q}`).then((d) => d?.workflow_runs ?? []);
    },
    listJobs: (runId) => call('GET', `/actions/runs/${Number(runId)}/jobs?per_page=20`).then((d) => d?.jobs ?? []),
    findOpenIssue: (label) =>
      call('GET', `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=10`).then(
        (list) => (list ?? []).find((i) => !i.pull_request) ?? null,
      ),
    ensureLabel: (name) => call('POST', '/labels', { name, color: 'd93f0b', description: 'Alertas del workflow de salud' }),
    createIssue: (title, body, labels) => call('POST', '/issues', { title, body, labels }),
    commentIssue: (number, body) => call('POST', `/issues/${Number(number)}/comments`, { body }),
  };
}

/** Comprobación de los workflows programados con la API de Actions. */
export async function checkWorkflows({ env, github, now, rules = WORKFLOW_RULES }) {
  const productionEnabled = env.EVALUATION_ENABLED === 'true';
  const branch = env.DEFAULT_BRANCH || 'main';
  const out = [];
  for (const rule of rules) {
    try {
      const workflow = await github.getWorkflow(rule.file);
      const runs = workflow ? await github.listRuns(rule.file, { branch, event: rule.event ?? undefined }) : [];
      let jobs = [];
      if (rule.requiredStep && productionEnabled && workflow?.state === 'active') {
        const latest = runs.find((r) => r.status === 'completed' && r.conclusion === 'success');
        if (latest) jobs = await github.listJobs(latest.id);
      }
      out.push(assessWorkflow(rule, { workflow, runs, jobs, now, productionEnabled }));
    } catch (e) {
      out.push(result(rule.check, 'fail', `no se pudo consultar la API de Actions (${String(e?.message ?? e).slice(0, 120)})`));
    }
  }
  return out;
}

const PENDING_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const IGNORED_CONCLUSIONS = new Set(['skipped', 'neutral']);
const runLink = (r) => (r?.html_url ? ` — ${r.html_url}` : '');

/**
 * Evalúa el último despliegue en main con los runs ya leídos de la API (pura).
 * - Un run sin terminar con más de maxPendingMin minutos: falla.
 * - Último completado en success, o sin runs: pasa.
 * - Último completado cancelado: aviso (warn), salvo que el despliegue anterior no
 *   cancelado haya fallado, porque la cancelación no lo corrige: entonces falla.
 * - Último completado en failure (o timed_out, startup_failure...): falla.
 * @param {typeof DEPLOY_RULE} rule
 * @param {{ workflow: any, runs: any[], now: Date }} data
 * @returns {Result}
 */
export function assessDeploy(rule, { workflow, runs, now }) {
  if (!workflow) return result(rule.check, 'fail', `${rule.file} no existe en la rama por defecto`);
  if (workflow.state !== 'active') {
    return result(rule.check, 'fail', `${rule.file} deshabilitado (${workflow.state}); reactivar con PUT .../enable`);
  }
  const relevant = (runs ?? [])
    .filter((r) => rule.events.includes(r.event))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const nowMs = now.getTime();

  const problems = [];
  const stuck = relevant.find((r) => {
    if (!PENDING_STATUSES.has(r.status)) return false;
    const since = Date.parse(r.run_started_at || r.created_at);
    return Number.isFinite(since) && (nowMs - since) / 60_000 > rule.maxPendingMin;
  });
  if (stuck) {
    const min = Math.round((nowMs - Date.parse(stuck.run_started_at || stuck.created_at)) / 60_000);
    problems.push(`un despliegue lleva ${min} min en ${stuck.status} (máximo ${rule.maxPendingMin})${runLink(stuck)}`);
  }

  const done = relevant.filter((r) => r.status === 'completed' && !IGNORED_CONCLUSIONS.has(r.conclusion));
  const latest = done[0];
  if (latest && latest.conclusion !== 'success') {
    if (latest.conclusion === 'cancelled') {
      const previous = done.find((r) => r.conclusion !== 'cancelled');
      if (previous && previous.conclusion !== 'success') {
        problems.push(`último despliegue cancelado y el anterior terminó en ${previous.conclusion}${runLink(previous)}`);
      } else if (problems.length === 0) {
        return result(rule.check, 'warn', `último despliegue cancelado, sin uno posterior en success${runLink(latest)}`);
      }
    } else {
      problems.push(`último despliegue terminó en ${latest.conclusion}${runLink(latest)}`);
    }
  }
  if (problems.length > 0) return result(rule.check, 'fail', problems.join('; '));
  if (!latest) return result(rule.check, 'ok', 'sin despliegues completados en main');
  return result(rule.check, 'ok', `último despliegue ${latest.conclusion}${runLink(latest)}`);
}

/** Comprobación del último despliegue en main con la API de Actions. */
export async function checkDeploy({ env, github, now, rule = DEPLOY_RULE }) {
  const branch = env.DEFAULT_BRANCH || 'main';
  try {
    const workflow = await github.getWorkflow(rule.file);
    const runs = workflow ? await github.listRuns(rule.file, { branch }) : [];
    return [assessDeploy(rule, { workflow, runs, now })];
  } catch (e) {
    return [result(rule.check, 'fail', `no se pudo consultar la API de Actions (${String(e?.message ?? e).slice(0, 120)})`)];
  }
}

/** Todas las comprobaciones. */
export async function runAll({ env, fetchImpl, github, now = new Date(), sleep, delayMs }) {
  return [
    ...(await checkAvailability({ env, fetchImpl, sleep, delayMs })),
    ...(await checkWorkflows({ env, github, now })),
    ...(await checkDeploy({ env, github, now })),
  ];
}

/** Nombres de checks fallidos, saneados (solo [a-z0-9-]). */
export function failedChecks(results) {
  return results.filter((r) => r.status === 'fail').map((r) => r.check);
}

/** Lista de checks para el issue a partir de la salida del job (cadena separada por comas). */
export function parseFailures(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]{1,40}$/.test(s));
}

/** Hora legible en America/Guayaquil. */
export function guayaquilTime(now) {
  const t = new Date(now.getTime() - 5 * HOUR_MS).toISOString().slice(0, 16).replace('T', ' ');
  return `${t} (America/Guayaquil)`;
}

/** Cuerpo del issue o comentario: solo nombres de check, hora y enlace al run. */
export function issueBody({ failures, runUrl, now }) {
  const list = failures.length > 0 ? failures.map((f) => `- \`${f}\``).join('\n') : '- `check` (el job de comprobación falló sin resumen; ver el log)';
  const link = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(runUrl ?? '') ? runUrl : '(enlace no disponible)';
  return [
    `Comprobación de salud fallida a las ${guayaquilTime(now)}.`,
    '',
    'Checks en falla:',
    list,
    '',
    `Run: ${link}`,
    '',
    'Runbook: `docs/operacion.md`, sección «Salud del sistema». Cerrar el issue cuando el siguiente run de `salud.yml` termine en verde.',
  ].join('\n');
}

/** Abre un issue con la etiqueta `salud` o comenta el abierto (sin duplicados). */
export async function upsertHealthIssue({ github, failures, runUrl, now = new Date() }) {
  const body = issueBody({ failures, runUrl, now });
  const open = await github.findOpenIssue(HEALTH_LABEL);
  if (open) {
    await github.commentIssue(open.number, body);
    return { action: 'commented', number: open.number };
  }
  await github.ensureLabel(HEALTH_LABEL);
  const created = await github.createIssue(ISSUE_TITLE, body, [HEALTH_LABEL]);
  return { action: 'created', number: created?.number ?? null };
}
