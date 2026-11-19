// V-03 · Gestora: completitud de datos por custodio y KPI para el mes a evaluar (actual o
// anterior): % de unidades con mediciones cargadas en el mes y lista de faltantes.
import { el } from '../dom.js';
import { field, messages, select } from '../form.js';
import { completeness, completenessMonths } from '../../lib/dashboard.js';
import { custodianCandidates } from '../../lib/indicator-form.js';
import { todayInBusinessTz } from '../../lib/dates.js';
import { monthEnd } from '../../../engine/index.js';
import { listIndicators } from '../../data/indicators.js';
import { listUnits } from '../../data/units.js';
import { listCustodianRoles } from '../../data/roles.js';
import { listMeasurementDates } from '../../data/measurements.js';

export function renderCompleteness() {
  const msg = messages();
  const today = todayInBusinessTz();
  const months = completenessMonths(today);
  const state = { month: months[0], indicators: [], units: [], custodians: [], measurements: [] };
  const sel = select('cmp-month', months.map((m, i) => ({ value: m, label: i === 0 ? `${m} (mes en curso)` : `${m} (mes anterior)` })), state.month);
  const body = el('div', { class: 'completeness-body' }, [el('p', { text: 'Cargando…' })]);

  function show() {
    const groups = completeness({ ...state, month: state.month });
    body.replaceChildren(...(groups.length ? groups.map((g) => el('section', { class: 'custodian-block', 'data-custodian': g.custodian }, [
      el('h3', { text: `${g.custodian}: ${g.pct} % cargado` }),
      el('table', { class: 'data-table', 'aria-label': `Completitud de ${g.custodian}` }, [
        el('thead', {}, [el('tr', {}, ['KPI', 'Unidades con datos', '% cargado', 'Faltan'].map((h) => el('th', { scope: 'col', text: h })))]),
        el('tbody', {}, g.items.map((it) => el('tr', { 'data-indicator': it.indicator.code }, [
          el('th', { scope: 'row', text: `${it.indicator.code} · ${it.indicator.name}` }),
          el('td', { text: `${it.loaded} de ${it.total}` }),
          el('td', { class: it.pct < 100 ? 'warn' : 'ok', text: `${it.pct} %` }),
          el('td', { text: it.missing.length ? it.missing.join(', ') : 'Completo' }),
        ]))),
      ]),
    ])) : [el('p', { text: 'No hay indicadores activos.' })]));
  }

  sel.addEventListener('change', () => { state.month = sel.value; show(); });

  async function load() {
    try {
      const [indicators, units, roles, measurements] = await Promise.all([
        listIndicators(), listUnits(), listCustodianRoles(),
        listMeasurementDates(`${months[1]}-01`, monthEnd(months[0])),
      ]);
      Object.assign(state, { indicators, units, measurements, custodians: custodianCandidates(roles, indicators) });
      show();
    } catch (err) {
      body.replaceChildren();
      msg.fail(err.message);
    }
  }

  load();
  return el('section', { class: 'card', 'aria-labelledby': 'cmp-title' }, [
    el('h2', { id: 'cmp-title', text: 'Completitud por custodio' }),
    el('p', { class: 'hint', text: 'Una unidad cuenta como cargada para un KPI si tiene al menos una medición con fecha dentro del mes.' }),
    field('Mes a evaluar', sel),
    msg.status,
    msg.error,
    body,
  ]);
}
