// V-01 · Inicio del líder de unidad: por indicador de su unidad, color del mes, valor, meta
// mensual, avance frente al ritmo (motor), restricciones activas, excepciones vigentes y su
// bandeja de alertas. RLS limita todas las lecturas a sus unidades.
import { el } from '../dom.js';
import { field, messages, select } from '../form.js';
import {
  activeExceptions, evaluatedMonths, formatNumber, leaderIndicatorRows, leaderMeasurementsRange,
  monthOptions, paceAsOf, pickMonth, unitEvaluation,
} from '../../lib/dashboard.js';
import { todayInBusinessTz } from '../../lib/dates.js';
import { ROLE_LABELS } from '../../lib/route-logic.js';
import { listUnits } from '../../data/units.js';
import { listIndicators } from '../../data/indicators.js';
import { listEvaluations } from '../../data/evaluations.js';
import { listUnitTargets } from '../../data/targets.js';
import { listUnitCommitments } from '../../data/commitments.js';
import { listUnitMeasurements } from '../../data/measurements.js';
import { listCurrentExceptions } from '../../data/exceptions.js';
import { listMyAlerts, markAlertRead } from '../../data/alerts.js';
import { alertsInbox, colorBadge, escalationInfo, exceptionsTable, monthPicker } from '../dashboard-parts.js';

function paceCell(pace) {
  if (!pace) return el('span', { class: 'muted', text: 'No aplica' });
  if (!pace.ok) return el('span', { class: 'muted', text: pace.reason });
  return el('div', {}, [
    el('strong', { class: pace.behindAny ? 'warn' : 'ok', text: pace.behindAny ? 'Atrasada' : 'Al día' }),
    el('p', { class: 'small', text: pace.reason }),
  ]);
}

export function renderLeaderHome({ rows, session }) {
  const msg = messages();
  const today = todayInBusinessTz();
  const unitIds = [...new Set((rows ?? []).filter((r) => r.role === 'unit_leader' && r.unit_id).map((r) => r.unit_id))];
  const controls = el('div', { class: 'filters' });
  const summary = el('div', { class: 'unit-summary' });
  const body = el('div', { class: 'leader-body' }, [el('p', { text: 'Cargando tus indicadores…' })]);
  const exceptionsBox = el('div', { class: 'exceptions-box' });
  const inbox = el('div', { class: 'inbox-box' });
  const state = { units: [], indicators: [], unitId: unitIds[0] ?? null, month: null, alerts: [] };

  const unitName = (id) => state.units.find((u) => u.id === id)?.name ?? 'Unidad';

  async function refreshAlerts() {
    state.alerts = await listMyAlerts(session?.user?.id);
    inbox.replaceChildren(alertsInbox({ alerts: state.alerts, onRead }));
  }

  async function onRead(id) {
    try {
      await markAlertRead(id);
      await refreshAlerts();
      msg.ok('Alerta marcada como leída.');
    } catch (err) { msg.fail(err.message); }
  }

  async function show() {
    const unitId = state.unitId;
    body.replaceChildren(el('p', { text: 'Cargando…' }));
    try {
      const evaluations = await listEvaluations({ unitId });
      const evaluated = evaluatedMonths(evaluations);
      const month = pickMonth(state.month, evaluated, today);
      state.month = month;
      const range = leaderMeasurementsRange(month, today);
      const [targets, commitments, measurements, exceptions] = await Promise.all([
        listUnitTargets(unitId, month),
        listUnitCommitments(unitId),
        listUnitMeasurements(unitId, range.from, range.to),
        listCurrentExceptions(today, unitId),
      ]);
      if (unitId !== state.unitId) return;

      const months = monthOptions([...evaluated, month], today);
      const pickers = [monthPicker('leader-month', months, month, (m) => { state.month = m; show(); })];
      if (state.units.length > 1) {
        const sel = select('leader-unit', state.units.map((u) => ({ value: u.id, label: u.name })), unitId);
        sel.addEventListener('change', () => { state.unitId = sel.value; state.month = null; show(); });
        pickers.unshift(field('Unidad', sel));
      }
      controls.replaceChildren(...pickers);

      const global = unitEvaluation(evaluations, unitId, month);
      summary.replaceChildren(
        el('h3', { text: `${unitName(unitId)} · ${month}` }),
        el('p', { class: 'unit-color' }, ['Color de la unidad: ', colorBadge(global?.color ?? 'not_evaluated')]),
        el('div', { class: 'unit-escalation' }, [el('span', { text: 'Restricciones activas: ' }), escalationInfo(global)]),
      );

      const list = leaderIndicatorRows({
        unitId, indicators: state.indicators, evaluations, targets, commitments, measurements, month, today,
      });
      body.replaceChildren(list.length
        ? el('table', { class: 'data-table', 'aria-label': 'Mis indicadores' }, [
          el('caption', { text: `Mis indicadores (avance al ${paceAsOf(month, today)})` }),
          el('thead', {}, [el('tr', {}, ['Indicador', 'Color', 'Valor', 'Meta del mes', 'Avance vs. ritmo'].map((h) => el('th', { scope: 'col', text: h })))]),
          el('tbody', {}, list.map((r) => el('tr', { 'data-indicator': r.indicator.code }, [
            el('th', { scope: 'row', text: `${r.indicator.code} · ${r.indicator.name}` }),
            el('td', {}, [colorBadge(r.color), el('p', { class: 'small muted', text: r.reason })]),
            el('td', { text: formatNumber(r.value) }),
            el('td', { text: r.goal ?? '—' }),
            el('td', {}, [paceCell(r.pace)]),
          ]))),
        ])
        : el('p', { text: 'No hay indicadores activos.' }));

      exceptionsBox.replaceChildren(
        el('h3', { text: 'Excepciones vigentes de mi unidad' }),
        exceptionsTable(activeExceptions(exceptions, today), unitName),
      );
    } catch (err) {
      body.replaceChildren();
      msg.fail(err.message);
    }
  }

  async function load() {
    if (!state.unitId) {
      body.replaceChildren(el('p', { text: 'No tienes unidades asignadas.' }));
      return;
    }
    try {
      [state.units, state.indicators] = await Promise.all([listUnits(), listIndicators()]);
      state.units = state.units.filter((u) => unitIds.includes(u.id));
      await Promise.all([show(), refreshAlerts()]);
    } catch (err) {
      body.replaceChildren();
      msg.fail(err.message);
    }
  }

  load();
  return el('section', { class: 'card', 'aria-labelledby': 'role-title', 'data-role': 'unit_leader' }, [
    el('h2', { id: 'role-title', text: ROLE_LABELS.unit_leader }),
    el('p', { class: 'scope', text: `Unidades a tu cargo: ${unitIds.length}.` }),
    msg.status,
    msg.error,
    controls,
    summary,
    body,
    exceptionsBox,
    inbox,
  ]);
}
