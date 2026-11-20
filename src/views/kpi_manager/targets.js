// M-07 · Gestora: alta y edición de metas mensuales (`targets`) de los indicadores de meta
// acumulada sin categorías, con "Proponer un tercio" (regla del motor) y el color del mes
// con la meta (misma regla que la evaluación mensual, como vista previa).
import { el } from '../dom.js';
import { field, select, messages } from '../form.js';
import { colorBadge } from '../dashboard-parts.js';
import { formatNumber } from '../../lib/dashboard.js';
import { todayInBusinessTz } from '../../lib/dates.js';
import { buildTargetFields, measurementsRange, parseMonth, targetIndicators, targetRows } from '../../lib/targets-form.js';
import { proposeThirdTarget } from '../../../engine/index.js';
import { listIndicators } from '../../data/indicators.js';
import { listUnits } from '../../data/units.js';
import { listCommitments } from '../../data/commitments.js';
import { listIndicatorMeasurements } from '../../data/measurements.js';
import { listIndicatorTargets } from '../../data/targets.js';
import { saveTarget } from '../../data/target-admin.js';

export function renderTargets() {
  const msg = messages();
  const picker = el('div', { class: 'picker' }, [el('p', { text: 'Cargando indicadores…' })]);
  const body = el('div', { class: 'targets-body' });
  const state = { indicators: [], units: [], indicator: null, month: todayInBusinessTz().slice(0, 7), seq: 0 };

  async function load() {
    try {
      const [all, units] = await Promise.all([listIndicators(), listUnits()]);
      state.indicators = targetIndicators(all);
      state.units = units;
      if (!state.indicators.length) {
        picker.replaceChildren(el('p', {
          text: 'No hay indicadores activos de meta acumulada sin categorías. Los que tienen umbrales por categoría (como VULN) toman la meta del paquete trimestral.',
        }));
        return;
      }
      const sel = select('tg-indicator', state.indicators.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })));
      const month = el('input', { id: 'tg-month', name: 'tg-month', type: 'text', value: state.month, maxlength: '7', inputmode: 'numeric', required: true });
      sel.addEventListener('change', () => show(sel.value, state.month));
      month.addEventListener('change', () => {
        const m = parseMonth(month.value);
        if (!m.ok) { msg.fail(m.error); return; }
        show(state.indicator.id, m.month);
      });
      picker.replaceChildren(field('Indicador', sel), field('Mes', month, 'AAAA-MM. La meta es acumulada del trimestre a ese mes.'));
      await show(sel.value, state.month);
    } catch (err) {
      picker.replaceChildren();
      msg.fail(err.message);
    }
  }

  async function show(indicatorId, month) {
    const indicator = state.indicators.find((i) => i.id === indicatorId);
    state.indicator = indicator;
    state.month = month;
    const seq = ++state.seq;
    msg.clear();
    body.replaceChildren(el('p', { text: 'Cargando metas…' }));
    try {
      const { from, to } = measurementsRange(month);
      const [targets, commitments, measurements] = await Promise.all([
        listIndicatorTargets(indicator.id, month), listCommitments(indicator.id),
        listIndicatorMeasurements(indicator.id, from, to),
      ]);
      if (seq !== state.seq) return false; // cambió el indicador o el mes mientras cargaba
      paint({ indicator, month, targets, commitments, measurements });
      return true;
    } catch (err) {
      if (seq !== state.seq) return false;
      body.replaceChildren();
      msg.fail(err.message);
      return false;
    }
  }

  function paint(data) {
    const { indicator, month, commitments } = data;
    const rows = targetRows({ ...data, units: state.units });
    const unitName = (id) => state.units.find((u) => u.id === id)?.name ?? id;

    const unit = select('tg-unit', state.units.map((u) => ({ value: u.id, label: u.name })));
    const value = el('input', { id: 'tg-value', name: 'tg-value', type: 'text', inputmode: 'decimal', required: true });
    const propose = el('button', {
      type: 'button', class: 'btn', text: 'Proponer un tercio',
      onclick: () => {
        const p = proposeThirdTarget({ commitments, unitId: unit.value, indicatorId: indicator.id, month });
        if (!p.ok) { msg.fail(`${unitName(unit.value)}: ${p.reason}.`); return; }
        value.value = String(p.value);
        msg.ok(p.explanation);
        value.focus();
      },
    });
    const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Guardar meta' });

    function edit(r) {
      unit.value = r.unit.id;
      value.value = r.target ? String(r.target.target_value) : '';
      value.focus();
    }

    const table = el('table', { class: 'data-table', 'aria-label': `Metas de ${month}` }, [
      el('caption', { text: `Metas de ${indicator.code} para ${month}` }),
      el('thead', {}, [el('tr', {}, ['Unidad', 'Paquete del trimestre', 'Meta acumulada del mes', 'Color con la meta', 'Motivo', 'Acciones']
        .map((h) => el('th', { scope: 'col', text: h })))]),
      el('tbody', {}, rows.map((r) => el('tr', { 'data-unit': r.unit.name }, [
        el('th', { scope: 'row', text: r.unit.name }),
        el('td', { text: r.packageTotal === null ? '—' : formatNumber(r.packageTotal) }),
        el('td', { text: r.target ? formatNumber(r.target.target_value) : 'Sin meta' }),
        el('td', {}, [colorBadge(r.evaluation.color)]),
        el('td', { class: 'small', text: r.evaluation.reason }),
        el('td', {}, [el('button', {
          type: 'button', class: 'btn', 'aria-label': `Editar meta de ${r.unit.name}`, text: 'Editar', onclick: () => edit(r),
        })]),
      ]))),
    ]);

    const form = el('form', { class: 'target-form', novalidate: true, 'aria-labelledby': 'tg-form-title' }, [
      el('h3', { id: 'tg-form-title', text: `Registrar o editar meta de ${month}` }),
      field('Unidad', unit),
      field('Meta acumulada del mes', value, 'Lo que debe estar resuelto desde el inicio del trimestre hasta el cierre del mes.'),
      el('div', { class: 'form-actions' }, [propose, submit]),
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const built = buildTargetFields({ month, value: value.value });
      if (!built.ok) { msg.fail(built.errors); return; }
      submit.disabled = true;
      form.setAttribute('aria-busy', 'true');
      const name = unitName(unit.value);
      try {
        await saveTarget(unit.value, indicator.id, built.fields.month, built.fields.target_value);
        const ok = await show(indicator.id, month);
        if (ok) msg.ok(`Meta de ${name} para ${month} guardada: ${formatNumber(built.fields.target_value)}.`);
      } catch (err) {
        msg.fail(err.message);
      } finally {
        submit.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });

    body.replaceChildren(
      rows.length ? table : el('p', { text: 'No hay unidades.' }),
      el('p', { class: 'hint', text: 'El color es una vista previa con la misma regla que la evaluación mensual; el color oficial lo guarda la evaluación programada.' }),
      form,
    );
  }

  load();
  return el('section', { class: 'card', 'aria-labelledby': 'targets-title' }, [
    el('h2', { id: 'targets-title', text: 'Metas mensuales' }),
    el('p', { text: 'Carga la meta parcial mensual de los indicadores de meta acumulada sin categorías. Sin meta del mes, el indicador queda sin evaluar.' }),
    msg.status,
    msg.error,
    picker,
    body,
  ]);
}
