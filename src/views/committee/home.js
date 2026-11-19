// V-02 · Inicio del comité: matriz unidad × indicador con el color del mes y el nivel de
// escalada por unidad, alertas recientes (bandeja propia) y excepciones vigentes.
import { el } from '../dom.js';
import { messages } from '../form.js';
import {
  activeExceptions, committeeMatrix, evaluatedMonths, formatNumber, monthOptions, pickMonth,
} from '../../lib/dashboard.js';
import { todayInBusinessTz } from '../../lib/dates.js';
import { ROLE_LABELS, findRoute } from '../../lib/route-logic.js';
import { listUnits } from '../../data/units.js';
import { listIndicators } from '../../data/indicators.js';
import { listEvaluations } from '../../data/evaluations.js';
import { listCurrentExceptions } from '../../data/exceptions.js';
import { listMyAlerts, markAlertRead } from '../../data/alerts.js';
import { alertsInbox, colorBadge, escalationInfo, exceptionsTable, monthPicker } from '../dashboard-parts.js';

const EXCEPTIONS_PATH = '/comite/excepciones';

function cell(ev) {
  if (!ev) return el('td', {}, [colorBadge('not_evaluated')]);
  return el('td', { title: ev.reason ?? '' }, [
    colorBadge(ev.color),
    ev.value !== null && ev.value !== undefined ? el('span', { class: 'small', text: ` ${formatNumber(ev.value)}` }) : null,
  ]);
}

export function renderCommitteeHome({ session }) {
  const msg = messages();
  const today = todayInBusinessTz();
  const controls = el('div', { class: 'filters' });
  const matrixBox = el('div', { class: 'matrix-box' }, [el('p', { text: 'Cargando la matriz…' })]);
  const exceptionsBox = el('div', { class: 'exceptions-box' });
  const inbox = el('div', { class: 'inbox-box' });
  const state = { units: [], indicators: [], evaluations: [], month: null };

  const unitName = (id) => state.units.find((u) => u.id === id)?.name ?? 'Unidad';

  async function refreshAlerts() {
    const alerts = await listMyAlerts(session?.user?.id, 30);
    inbox.replaceChildren(alertsInbox({ alerts, onRead, title: 'Alertas recientes' }));
  }

  async function onRead(id) {
    try {
      await markAlertRead(id);
      await refreshAlerts();
      msg.ok('Alerta marcada como leída.');
    } catch (err) { msg.fail(err.message); }
  }

  function showMatrix() {
    const evaluated = evaluatedMonths(state.evaluations);
    const month = pickMonth(state.month, evaluated, today);
    state.month = month;
    controls.replaceChildren(monthPicker('committee-month', monthOptions([...evaluated, month], today), month, (m) => {
      state.month = m;
      showMatrix();
    }));
    const { columns, rows } = committeeMatrix({ units: state.units, indicators: state.indicators, evaluations: state.evaluations, month });
    matrixBox.replaceChildren(rows.length
      ? el('table', { class: 'data-table matrix', 'aria-label': 'Matriz unidad por indicador' }, [
        el('caption', { text: `Color por unidad e indicador · ${month}` }),
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col', text: 'Unidad' }),
          el('th', { scope: 'col', text: 'Color de la unidad' }),
          el('th', { scope: 'col', text: 'Escalada' }),
          ...columns.map((c) => el('th', { scope: 'col', title: c.name, text: c.code })),
        ])]),
        el('tbody', {}, rows.map((r) => el('tr', { 'data-unit': r.unit.name }, [
          el('th', { scope: 'row', text: r.unit.name }),
          el('td', {}, [colorBadge(r.global?.color ?? 'not_evaluated')]),
          el('td', {}, [escalationInfo(r.global)]),
          ...r.cells.map(cell),
        ]))),
      ])
      : el('p', { text: 'No hay unidades.' }));
  }

  async function load() {
    try {
      const [units, indicators, evaluations, exceptions] = await Promise.all([
        listUnits(), listIndicators(), listEvaluations(), listCurrentExceptions(today),
      ]);
      Object.assign(state, { units, indicators, evaluations });
      showMatrix();
      const link = findRoute(EXCEPTIONS_PATH)
        ? el('a', { href: `#${EXCEPTIONS_PATH}`, text: 'Aprobar o revocar una excepción' })
        : null;
      exceptionsBox.replaceChildren(
        el('h3', { text: 'Excepciones vigentes' }),
        exceptionsTable(activeExceptions(exceptions, today), unitName),
        link,
      );
      await refreshAlerts();
    } catch (err) {
      matrixBox.replaceChildren();
      msg.fail(err.message);
    }
  }

  load();
  return el('section', { class: 'card', 'aria-labelledby': 'role-title', 'data-role': 'committee' }, [
    el('h2', { id: 'role-title', text: ROLE_LABELS.committee }),
    msg.status,
    msg.error,
    controls,
    matrixBox,
    exceptionsBox,
    inbox,
  ]);
}
