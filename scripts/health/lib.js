// V-04 — Comprobaciones de salud (disponibilidad y workflows programados).
// Funciones puras o con dependencias inyectadas (fetch, cliente de GitHub, reloj, espera)
// para poder probarlas sin red. Nunca incluyen claves, URLs de Supabase ni datos de
// unidades en los mensajes: el repositorio es público y los fallos acaban en un issue.
import { businessDate } from '../../engine/index.js';

export const DEFAULT_PAGES_URL = 'https://apivasa.github.io/practica_agente/';
export const HEALTH_LABEL = 'salud';
export const ISSUE_TITLE = 'Salud del sistema: comprobación fallida';

const HOUR_MS = 3_600_000;
const JOBS_MAX_PAGES = 5;
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
 *   90 min (H-ARQ-V05b-09): la suma de timeouts de deploy.yml ronda 75 min desde
 *   V-05c (verify espera el CI hasta 20 min), y 60 daría falsas alarmas.
 */
export const DEPLOY_RULE = Object.freeze({ file: 'deploy.yml', check: 'deploy-main', events: Object.freeze(['push', 'workflow_dispatch']), maxPendingMin: 90 });

/** Longitud máxima (en caracteres) de un valor escrito en el log o en el resumen del job. */
export const LOG_VALUE_MAX = 300;

// C0 (0x00-0x1f, incluye \r y \n), DEL y C1 (0x7f-0x9f, incluye NEL), separadores U+2028/U+2029.
const isLogControl = (cp) => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;

/**
 * F-21 (H-F20-01): deja un valor en una sola línea antes de escribirlo en stdout/stderr o en
 * $GITHUB_STEP_SUMMARY. Cambia cada carácter de control o separador de línea por un espacio y
 * recorta a `max` caracteres (code points) terminando en «…». Así ningún valor de la API puede
 * abrir una línea nueva que empiece con `::` (comandos de workflow de Actions).
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
export function sanitizeLogValue(value, max = LOG_VALUE_MAX) {
  const chars = Array.from(String(value ?? ''), (c) => (isLogControl(c.codePointAt(0)) ? ' ' : c));
  const limit = Number.isSafeInteger(max) && max > 0 ? max : LOG_VALUE_MAX;
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : chars.join('');
}

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
 * F-19 (H-F18-02 / QA-F18-01): candidato que evalúa assessWorkflow, extraído para que
 * checkWorkflows pida los jobs de `requiredStep` a ese mismo run y no al primer success en el
 * orden de la API. Pura.
 * - invalid: runs completados (no cancelados ni omitidos) con created_at inválido o futuro
 *   (F-18, H-F17-02): si hay alguno, assessWorkflow falla y no hay candidato.
 * - candidate: el más reciente (o, en reglas mensuales, el más reciente del mes en curso,
 *   America/Guayaquil), o null.
 * @param {typeof WORKFLOW_RULES[number]} rule
 * @param {{ runs: any[], now: Date }} data
 * @returns {{ candidate: any | null, invalid: any[] }}
 */
export function pickWorkflowCandidate(rule, { runs, now }) {
  const nowMs = now.getTime();
  // F-18 (H-F17-02 / H-ARQ-F17-01): created_at de cada run validado con parseApiTime, como en
  // assessDeploy. Un completado con fecha inválida o futura podría ser el más reciente (o el
  // único que cumple maxAgeHours), así que hace fallar el check. Empates: compareSameTime.
  const timeOf = (r) => parseApiTime(r?.created_at, nowMs);
  const doneAll = (runs ?? [])
    .filter((r) => r?.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped')
    .filter((r) => !rule.event || r.event === rule.event);
  const invalid = doneAll.filter((r) => !Number.isFinite(timeOf(r)));
  if (invalid.length > 0) return { candidate: null, invalid };
  const done = doneAll.sort((a, b) => timeOf(b) - timeOf(a) || compareSameTime(a, b));
  if (!rule.monthly) return { candidate: done[0] ?? null, invalid };
  const month = businessDate(now).slice(0, 7);
  return { candidate: done.find((r) => businessDate(new Date(timeOf(r))).slice(0, 7) === month) ?? null, invalid };
}

/**
 * Evalúa un workflow programado con los datos ya leídos de la API (pura).
 * `jobs` son los jobs del candidato (ver pickWorkflowCandidate); solo se usan con
 * `requiredStep` y producción activa.
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
  const nowMs = now.getTime();
  const { candidate, invalid } = pickWorkflowCandidate(rule, { runs, now });
  if (invalid.length > 0) {
    return result(
      rule.check,
      'fail',
      `${invalid.length} run(s) completado(s) con fecha inválida o en el futuro; no se puede determinar el más reciente${runLink(invalid[0])}`,
    );
  }
  // F-17 (H-ARQ-F16-03): misma validación que los runs de despliegue. Inválida o futura → 0
  // (época), que es fail-closed: no cuenta como «reciente» ni como «creado este mes».
  const parsedCreated = parseApiTime(workflow.created_at, nowMs);
  const createdMs = Number.isFinite(parsedCreated) ? parsedCreated : 0;

  if (rule.monthly && !candidate) {
    const month = businessDate(now).slice(0, 7);
    const day = Number(businessDate(now).slice(8, 10));
    if (day < 2) return result(rule.check, 'ok', 'día 1: el cierre del mes aún puede estar en curso');
    if (businessDate(new Date(createdMs)).slice(0, 7) === month) return result(rule.check, 'ok', 'workflow creado este mes; sin cierre que exigir');
    return result(rule.check, 'fail', `sin run del cierre mensual de ${month}`);
  }
  if (!candidate) {
    if (rule.maxAgeHours && hoursBetween(createdMs, nowMs) < rule.maxAgeHours) {
      return result(rule.check, 'ok', 'workflow reciente; aún no le toca correr');
    }
    return result(rule.check, rule.latestOnly ? 'skip' : 'fail', 'sin runs completados');
  }

  const problems = [];
  if (candidate.conclusion !== 'success') problems.push(`último run terminó en ${candidate.conclusion}`);
  if (rule.maxAgeHours) {
    const age = hoursBetween(parseApiTime(candidate.created_at, nowMs), nowMs);
    if (age > rule.maxAgeHours) problems.push(`último run hace ${fmtHours(age)} (máximo ${rule.maxAgeHours} h)`);
  }
  if (rule.maxDurationMin) {
    // F-19 (H-F18-01 / H-ARQ-F18-01): fechas validadas con parseApiTime. Si falta alguna, es
    // ilegible o futura, o la duración sale negativa, no se puede comprobar el máximo: problema.
    const started = parseApiTime(candidate.run_started_at, nowMs);
    const updated = parseApiTime(candidate.updated_at, nowMs);
    if (!Number.isFinite(started) || !Number.isFinite(updated)) {
      problems.push('duración no verificable: run_started_at o updated_at falta, es ilegible o está en el futuro');
    } else if (updated < started) {
      problems.push('duración no verificable: updated_at es anterior a run_started_at');
    } else {
      const min = (updated - started) / 60_000;
      if (min > rule.maxDurationMin) problems.push(`duró ${Math.round(min)} min (máximo ${rule.maxDurationMin})`);
    }
  }
  if (rule.requiredStep && productionEnabled && candidate.conclusion === 'success') {
    const stepProblem = requiredStepProblem(rule.requiredStep, jobs, candidate);
    if (stepProblem) problems.push(stepProblem);
  }
  const link = candidate.html_url ? ` — ${candidate.html_url}` : '';
  return problems.length > 0
    ? result(rule.check, 'fail', `${problems.join('; ')}${link}`)
    : result(rule.check, 'ok', `último run ${candidate.conclusion}${link}`);
}

/**
 * F-19 (H-F18-02 / QA-F18-01): problema con el paso requerido en los jobs del candidato, o null.
 * Fail-closed (F-20): falla si no hay jobs, si algún job no trae `run_id` entero igual al id
 * del candidato (H-F19-01), si el paso no aparece (renombrado o job omitido), si todas sus
 * apariciones quedaron `skipped`, o si alguna aparición no terminó en `success`
 * (H-F19-02 / QA-F19-01: `failure`, `null`, `skipped` en una pata de la matriz, etc.).
 */
function requiredStepProblem(step, jobs, candidate) {
  const list = Array.isArray(jobs) ? jobs : [];
  // F-21 (H-ARQ-F20-03 / QA-F20-02): el id se valida antes que la lista; checkWorkflows no pide
  // jobs sin id entero, así que con id inválido el motivo real es el id, no "sin jobs".
  if (!Number.isSafeInteger(candidate?.id)) {
    return `el último run no tiene id verificable; no se puede comprobar el paso "${step}"`;
  }
  if (list.length === 0) return `sin jobs del último run; no se puede comprobar el paso "${step}"`;
  if (list.some((j) => !Number.isSafeInteger(j?.run_id) || j.run_id !== candidate.id)) {
    return `los jobs recibidos no traen el run_id del último run; no se puede comprobar el paso "${step}"`;
  }
  const steps = list.flatMap((j) => (Array.isArray(j.steps) ? j.steps : [])).filter((s) => s?.name === step);
  if (steps.length === 0) return `paso "${step}" no aparece en el último run`;
  if (steps.every((s) => s.conclusion === 'skipped')) {
    return `paso "${step}" omitido con EVALUATION_ENABLED=true (¿falta un secreto?)`;
  }
  const bad = steps.filter((s) => s.conclusion !== 'success');
  if (bad.length > 0) {
    const seen = [...new Set(bad.map((s) => String(s.conclusion ?? 'sin conclusión')))].join(', ');
    return `paso "${step}" no terminó en success en todas sus apariciones (${bad.length} de ${steps.length}: ${seen})`;
  }
  return null;
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
    // F-19: per_page=100 (máximo de la API) y páginas siguientes según total_count, para que
    // un run con el paso requerido no dé un falso «paso no aparece». filter=latest (por
    // defecto): jobs del último intento del run.
    listJobs: async (runId) => {
      const jobs = [];
      for (let page = 1; page <= JOBS_MAX_PAGES; page++) {
        const d = await call('GET', `/actions/runs/${Number(runId)}/jobs?per_page=100&page=${page}`);
        const batch = Array.isArray(d?.jobs) ? d.jobs : [];
        jobs.push(...batch);
        const total = Number.isSafeInteger(d?.total_count) ? d.total_count : jobs.length;
        if (batch.length < 100 || jobs.length >= total) break;
      }
      return jobs;
    },
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
        // F-19 (H-F18-02 / QA-F18-01): los jobs del mismo candidato que evalúa assessWorkflow.
        const { candidate } = pickWorkflowCandidate(rule, { runs, now });
        if (candidate?.conclusion === 'success' && Number.isSafeInteger(candidate.id)) jobs = await github.listJobs(candidate.id);
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
 * - Último completado en failure (o timed_out, startup_failure...): falla, salvo que haya
 *   un run más nuevo pendiente dentro de maxPendingMin (F-13, H-ARQ-F12-02: rojo esperado
 *   H-F11-06): entonces aviso (warn) y decide ese run.
 *   F-14 (H-F13-01): ese aviso solo vale para un fallo aislado. Si el despliegue completado
 *   anterior al fallo (sin contar cancelados) tampoco terminó en success, es una cadena de
 *   fallos y se falla aunque haya un run nuevo pendiente. Ver isolatedFailure.
 * - F-15 (H-F14-01): un run completado con created_at inválido o futuro (ver parseApiTime)
 *   hace fallar el check: no se puede saber si es el más reciente. Un pendiente con
 *   created_at inválido se descarta (ni cubre ni cuenta como atascado). F-16 (H-F15-03): si
 *   solo su run_started_at es inválido, se conserva y el atasco se mide con created_at.
 * - F-16/F-17: con el mismo created_at el orden lo fija compareSameTime (id desc; sin id
 *   entero, fail-closed).
 * @param {typeof DEPLOY_RULE} rule
 * @param {{ workflow: any, runs: any[], now: Date }} data
 * @returns {Result}
 */
export function assessDeploy(rule, { workflow, runs, now }) {
  if (!workflow) return result(rule.check, 'fail', `${rule.file} no existe en la rama por defecto`);
  if (workflow.state !== 'active') {
    return result(rule.check, 'fail', `${rule.file} deshabilitado (${workflow.state}); reactivar con PUT .../enable`);
  }
  const nowMs = now.getTime();
  // F-15 (H-F14-01): fechas validadas con parseApiTime (texto ISO, no más de FUTURE_SKEW_MIN
  // en el futuro). Los runs con fecha inválida o futura no se ordenan con los demás.
  // - Completado (no omitido) con created_at inválido: podría ser el más reciente y decidir
  //   el resultado, así que no se puede dar ok ni warn: problema → fail.
  // - Pendiente con created_at inválido: se descarta. No puede dar ok por sí solo, no cubre un
  //   fallo (newerPendingRun ya lo rechaza) y no cuenta como atascado (lado seguro; lo exige
  //   qa-v04b «sin fechas válidas: no se considera atascado ni lanza»).
  // - F-16 (H-F15-03): pendiente con created_at válido y run_started_at ilegible o futuro: se
  //   conserva y el atasco se mide con created_at (sinceOf); newerPendingRun sigue sin dejar
  //   que cubra un fallo.
  // - F-16 (H-F15-02) / F-17 (H-F16-01): con el mismo created_at decide compareSameTime.
  const relevantAll = (runs ?? []).filter((r) => rule.events.includes(r?.event));
  const timeOf = (r) => parseApiTime(r.created_at, nowMs);
  const sinceOf = (r) => {
    const started = r.run_started_at ? parseApiTime(r.run_started_at, nowMs) : NaN;
    return Number.isFinite(started) ? started : timeOf(r);
  };
  const validTimes = (r) => Number.isFinite(timeOf(r));
  const invalid = relevantAll.filter((r) => !validTimes(r) && r.status === 'completed' && !IGNORED_CONCLUSIONS.has(r.conclusion));
  const relevant = relevantAll.filter(validTimes).sort((a, b) => timeOf(b) - timeOf(a) || compareSameTime(a, b));

  const problems = [];
  if (invalid.length > 0) {
    problems.push(
      `${invalid.length} despliegue(s) completado(s) con fecha inválida o en el futuro; no se puede determinar el más reciente${runLink(invalid[0])}`,
    );
  }
  const stuck = relevant.find((r) => PENDING_STATUSES.has(r.status) && (nowMs - sinceOf(r)) / 60_000 > rule.maxPendingMin);
  if (stuck) {
    const min = Math.round((nowMs - sinceOf(stuck)) / 60_000);
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
      // F-13 (H-ARQ-F12-02): rojo esperado (H-F11-06). Si hay un run más nuevo todavía
      // pendiente y dentro de maxPendingMin, él decide: se avisa sin fallar. Si ese run se
      // atasca (stuck) o termina en fallo, la siguiente corrida sí alerta.
      // F-14 (H-F13-01): una cadena de fallos no queda oculta por un run pendiente.
      const covering =
        problems.length === 0 && isolatedFailure(done, latest) ? newerPendingRun(relevant, latest, nowMs, rule.maxPendingMin) : null;
      if (covering) {
        return result(
          rule.check,
          'warn',
          `último despliegue terminó en ${latest.conclusion}${runLink(latest)}; hay uno más nuevo en ${covering.status} que lo cubre (rojo esperado H-F11-06)${runLink(covering)}`,
        );
      }
      problems.push(`último despliegue terminó en ${latest.conclusion}${runLink(latest)}`);
    }
  }
  if (problems.length > 0) return result(rule.check, 'fail', problems.join('; '));
  if (!latest) return result(rule.check, 'ok', 'sin despliegues completados en main');
  return result(rule.check, 'ok', `último despliegue ${latest.conclusion}${runLink(latest)}`);
}

/**
 * F-14 (H-F13-01): ¿el fallo `failed` es aislado? Lo es si el despliegue completado anterior
 * a él (el siguiente en `done`, que va de más nuevo a más viejo, saltando cancelados) terminó
 * en success, o si no hay ninguno anterior (primer despliegue o historial fuera de la página).
 * Si el anterior también falló (failure, timed_out, startup_failure...) es una cadena: false.
 * Nota: no se usa la antigüedad del fallo como alternativa (sugerencia de H-F13-01), porque
 * con dos fallos seguidos el más reciente suele tener menos de maxPendingMin y la cadena
 * volvería a quedar en warn (justo el caso que reproduce el hallazgo).
 * @param {any[]} done runs completados relevantes, ordenados de más nuevo a más viejo
 * @param {any} failed el último completado, que no terminó en success
 * @returns {boolean}
 */
export function isolatedFailure(done, failed) {
  const list = done ?? [];
  const i = list.indexOf(failed);
  if (i < 0) return false;
  const previous = list.slice(i + 1).find((r) => r?.conclusion !== 'cancelled');
  return !previous || previous.conclusion === 'success';
}

/**
 * F-16 (H-F15-02) / F-17 (H-F16-01): orden entre runs con el mismo created_at. Es un orden
 * lexicográfico por una clave fija, así que es total y transitivo, y el resultado no depende
 * del orden de entrada. Clave (ascendente = va antes = se trata como más reciente):
 *   1. rango 0: sin id entero seguro y no success (failure, cancelled, pendiente...);
 *      rango 1: con id entero seguro (Number.isSafeInteger);
 *      rango 2: sin id entero seguro y success.
 *   2. rango 1: id descendente (mayor = más reciente, como da la API).
 *      rangos 0 y 2: conclusion y luego String(id), solo para que el orden sea determinista.
 *   3. F-18 (QA-F17-01): rango 1 con el mismo id: no-success antes que success, luego
 *      conclusion (un run repetido entre páginas con distinta conclusión no puede dar ok).
 * Fail-closed: si el id no permite saber cuál es más reciente, un run no-success empatado
 * nunca queda detrás de un success, así que el empate no puede dar ok.
 */
function compareSameTime(a, b) {
  const ra = sameTimeRank(a);
  const rb = sameTimeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) return b.id - a.id || successLast(a) - successLast(b) || cmpText(a?.conclusion, b?.conclusion);
  return cmpText(a?.conclusion, b?.conclusion) || cmpText(a?.id, b?.id);
}

/** F-18 (QA-F17-01 / H-F17-01): con el mismo id entero seguro, el no-success va antes. */
function successLast(r) {
  return r?.conclusion === 'success' ? 1 : 0;
}

function sameTimeRank(r) {
  if (Number.isSafeInteger(r?.id)) return 1;
  return r?.conclusion === 'success' ? 2 : 0;
}

function cmpText(x, y) {
  const a = String(x ?? '');
  const b = String(y ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * F-16 (H-F15-01): ISO 8601 con fecha, hora y zona obligatoria (Z u offset ±hh:mm), que es lo
 * que da la API de GitHub. Date.parse solo no basta: acepta '1' o 'March 1 2001'.
 */
export const API_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** F-14 (H-F13-02): margen para relojes desfasados; un timestamp más allá de now + esto se rechaza. */
export const FUTURE_SKEW_MIN = 5;

/**
 * F-14 (H-F13-02): instante en ms de un timestamp de la API, o NaN si no es texto, no se
 * puede leer o está más de FUTURE_SKEW_MIN minutos en el futuro respecto a nowMs.
 * (Date.parse acepta no-strings: 12 sería el año 2001; un futuro haría negativa la espera.)
 * F-16 (H-F15-01): además debe cumplir API_TIME_RE; cualquier otro texto da NaN.
 * @param {unknown} value
 * @param {number} nowMs
 * @returns {number}
 */
export function parseApiTime(value, nowMs) {
  if (typeof value !== 'string' || !API_TIME_RE.test(value)) return NaN;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return NaN;
  return ms > nowMs + FUTURE_SKEW_MIN * 60_000 ? NaN : ms;
}

/**
 * F-13 (H-ARQ-F12-02): run pendiente creado después de `failed` y que aún no supera
 * maxPendingMin, o null.
 * F-14 (H-F13-02): los timestamps (created_at del fallo y del pendiente, run_started_at del
 * pendiente) deben ser texto y no estar más de FUTURE_SKEW_MIN min en el futuro; si no, no
 * cubren. run_started_at vacío o ausente usa created_at, como antes.
 * @param {any[]} runs
 * @param {any} failed
 * @param {number} nowMs
 * @param {number} maxPendingMin
 */
export function newerPendingRun(runs, failed, nowMs, maxPendingMin) {
  const failedMs = parseApiTime(failed?.created_at, nowMs);
  if (!Number.isFinite(failedMs)) return null;
  return (
    (runs ?? []).find((r) => {
      if (!PENDING_STATUSES.has(r?.status)) return false;
      const created = parseApiTime(r.created_at, nowMs);
      if (!Number.isFinite(created) || created <= failedMs) return false;
      const since = r.run_started_at ? parseApiTime(r.run_started_at, nowMs) : created;
      return Number.isFinite(since) && (nowMs - since) / 60_000 <= maxPendingMin;
    }) ?? null
  );
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
