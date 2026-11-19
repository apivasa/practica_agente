// M-03 · Custodio: compromisos por unidad, indicador y periodo, con umbral
// negociado (override del general) y paquete por categoría en meta acumulada.
import { el } from '../dom.js';
import { field, select, messages, table } from '../form.js';
import { effectiveThresholds } from '../../../engine/index.js';
import { toEngineIndicator } from '../../lib/indicator-form.js';
import { buildCommitmentFields } from '../../lib/commitment-form.js';
import { listMyIndicators } from '../../data/indicators.js';
import { listUnits } from '../../data/units.js';
import { listCommitments, saveCommitment } from '../../data/commitments.js';

/** Categorías del paquete: las de los umbrales del indicador, o "total". */
function packageCategories(ind) {
  const keys = Object.keys(ind.thresholds_by_category ?? {}).filter((k) => k !== '__proto__');
  return keys.length ? keys : ['total'];
}

export function renderCommitments({ rows }) {
  const msg = messages();
  const picker = el('div', { class: 'picker' }, [el('p', { text: 'Cargando tus indicadores…' })]);
  const body = el('div', { class: 'commitments-body' });
  const state = { indicators: [], units: [], current: null };

  async function load() {
    try {
      [state.indicators, state.units] = await Promise.all([listMyIndicators(rows), listUnits()]);
      if (!state.indicators.length) {
        picker.replaceChildren(el('p', { text: 'No custodias indicadores activos.' }));
        return;
      }
      const sel = select('cm-indicator', state.indicators.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })));
      sel.addEventListener('change', () => show(sel.value));
      picker.replaceChildren(field('Indicador', sel));
      await show(sel.value);
    } catch (err) {
      picker.replaceChildren();
      msg.fail(err.message);
    }
  }

  async function show(indicatorId) {
    const ind = state.indicators.find((i) => i.id === indicatorId);
    state.current = ind;
    msg.clear();
    body.replaceChildren(el('p', { text: 'Cargando compromisos…' }));
    let list;
    try {
      list = await listCommitments(ind.id);
    } catch (err) {
      body.replaceChildren();
      msg.fail(err.message);
      return;
    }
    if (state.current !== ind) return; // cambió de indicador mientras cargaba
    paint(ind, list);
  }

  function paint(ind, list) {
    const cfg = toEngineIndicator(ind);
    const unitName = (id) => state.units.find((u) => u.id === id)?.name ?? id;
    const isCumulative = ind.measurement_type === 'cumulative_target';
    const cats = packageCategories(ind);

    const general = el('p', { class: 'general-thresholds',
      text: `Umbral general: verde ${ind.green_threshold}, amarillo ${ind.yellow_threshold}.` });

    const rowsOut = list.map((c) => {
      const eff = effectiveThresholds(cfg, c);
      return [
        unitName(c.unit_id),
        c.period,
        String(eff.green),
        String(eff.yellow),
        eff.overridden ? 'Negociado' : 'General',
        c.package_by_category ? Object.entries(c.package_by_category).map(([k, v]) => `${k}: ${v}`).join(', ')
          : c.package_total != null ? String(c.package_total) : '—',
        el('button', { type: 'button', class: 'btn', 'aria-label': `Editar ${unitName(c.unit_id)} ${c.period}`, text: 'Editar', onclick: () => fill(c) }),
      ];
    });

    const unit = select('cm-unit', state.units.map((u) => ({ value: u.id, label: u.name })));
    const period = el('input', { id: 'cm-period', type: 'text', placeholder: '2027-Q1 o 2027-03', maxlength: '7', required: true });
    const green = el('input', { id: 'cm-green', type: 'text', inputmode: 'decimal' });
    const yellow = el('input', { id: 'cm-yellow', type: 'text', inputmode: 'decimal' });
    const pkgInputs = Object.fromEntries(cats.map((k) => [k, el('input', { id: `cm-pkg-${k.replace(/[^A-Za-z0-9_-]/g, '_')}`, type: 'text', inputmode: 'numeric' })]));
    const notes = el('textarea', { id: 'cm-notes', rows: '2', maxlength: '500' });
    const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Guardar compromiso' });

    function fill(c) {
      unit.value = c.unit_id;
      period.value = c.period;
      green.value = c.green_override ?? '';
      yellow.value = c.yellow_override ?? '';
      for (const [k, input] of Object.entries(pkgInputs)) {
        input.value = c.package_by_category?.[k] ?? (k === 'total' && c.package_total != null ? c.package_total : '');
      }
      notes.value = c.notes ?? '';
      period.focus();
    }

    const form = el('form', { class: 'commitment-form', novalidate: true, 'aria-labelledby': 'cm-form-title' }, [
      el('h3', { id: 'cm-form-title', text: 'Registrar o editar compromiso' }),
      field('Unidad', unit),
      field('Periodo', period, 'Trimestre AAAA-Qn (ej. 2027-Q1) o mes AAAA-MM (ej. 2027-03)'),
      field('Umbral verde negociado', green, 'Vacío = se usa el umbral general'),
      field('Umbral amarillo negociado', yellow),
      isCumulative ? el('fieldset', {}, [
        el('legend', { text: 'Paquete del periodo por categoría' }),
        ...cats.map((k) => field(`Paquete ${k}`, pkgInputs[k])),
      ]) : null,
      field('Notas', notes),
      submit,
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const built = buildCommitmentFields(cfg, {
        period: period.value, green: green.value, yellow: yellow.value,
        packages: Object.fromEntries(Object.entries(pkgInputs).map(([k, i]) => [k, i.value])),
        notes: notes.value,
      });
      if (!built.ok) { msg.fail(built.errors); return; }
      submit.disabled = true;
      try {
        await saveCommitment(unit.value, ind.id, built.fields);
        const fresh = await listCommitments(ind.id);
        paint(ind, fresh);
        msg.ok(`Compromiso de ${unitName(unit.value)} para ${built.fields.period} guardado.`);
      } catch (err) {
        msg.fail(err.message);
      } finally {
        submit.disabled = false;
      }
    });

    body.replaceChildren(
      general,
      rowsOut.length
        ? table('Compromisos y umbrales efectivos', ['Unidad', 'Periodo', 'Verde', 'Amarillo', 'Origen', 'Paquete', 'Acciones'], rowsOut)
        : el('p', { text: 'Este indicador aún no tiene compromisos.' }),
      form,
    );
  }

  load();
  return el('section', { class: 'card', 'aria-labelledby': 'commitments-title' }, [
    el('h2', { id: 'commitments-title', text: 'Compromisos' }),
    el('p', { text: 'Negocia con cada unidad el umbral y, en metas acumuladas, el paquete del periodo. Un umbral negociado sobrescribe el general para esa unidad y periodo.' }),
    msg.status,
    msg.error,
    picker,
    body,
  ]);
}
