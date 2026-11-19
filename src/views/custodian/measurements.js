// M-04 · Custodio: captura manual de mediciones e importación CSV validada
// (vista previa con errores fila a fila; se guarda solo si no hay errores).
import { el } from '../dom.js';
import { field, select, messages, table } from '../form.js';
import {
  validateMeasurementInput, parseMeasurementsCsv, CSV_COLUMNS, CSV_MAX_BYTES, CSV_MAX_ROWS,
} from '../../../engine/index.js';
import { toEngineIndicator } from '../../lib/indicator-form.js';
import { describeMeasurement } from '../../lib/measurement-form.js';
import { todayInBusinessTz } from '../../lib/dates.js';
import { listMyIndicators } from '../../data/indicators.js';
import { listUnits } from '../../data/units.js';
import { listRecentMeasurements, insertMeasurements } from '../../data/measurements.js';

const PREVIEW_MAX = 50;

export function renderMeasurements({ rows }) {
  const msg = messages();
  const picker = el('div', { class: 'picker' }, [el('p', { text: 'Cargando tus indicadores…' })]);
  const body = el('div', { class: 'measurements-body' });
  const state = { indicators: [], units: [], current: null };

  async function load() {
    try {
      [state.indicators, state.units] = await Promise.all([listMyIndicators(rows), listUnits()]);
      if (!state.indicators.length) {
        picker.replaceChildren(el('p', { text: 'No custodias indicadores activos.' }));
        return;
      }
      const sel = select('ms-indicator', state.indicators.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })));
      sel.addEventListener('change', () => show(sel.value));
      picker.replaceChildren(field('Indicador', sel));
      show(sel.value);
    } catch (err) {
      picker.replaceChildren();
      msg.fail(err.message);
    }
  }

  const unitName = (id) => state.units.find((u) => u.id === id)?.name ?? id;

  function show(indicatorId) {
    const ind = state.indicators.find((i) => i.id === indicatorId);
    state.current = ind;
    msg.clear();
    const cfg = toEngineIndicator(ind);
    const type = ind.measurement_type;
    const cats = Object.keys(cfg.thresholdsByCategory);
    const recent = el('div', { class: 'recent' });

    async function refreshRecent() {
      try {
        const list = await listRecentMeasurements(ind.id);
        if (state.current !== ind) return;
        recent.replaceChildren(list.length
          ? table('Últimas mediciones', ['Fecha', 'Unidad', 'Dato'], list.map((m) => [m.measured_on, unitName(m.unit_id), describeMeasurement(m)]))
          : el('p', { text: 'Este indicador aún no tiene mediciones.' }));
      } catch (err) { msg.fail(err.message); }
    }

    // ---- Captura manual ----
    const today = todayInBusinessTz();
    const inputs = {
      fecha: el('input', { id: 'ms-date', type: 'date', value: today, max: today, required: true }),
      unidad: select('ms-unit', state.units.map((u) => ({ value: u.id, label: u.name }))),
    };
    const extra = [];
    if (type !== 'coverage') {
      inputs.valor = el('input', { id: 'ms-value', type: 'text', inputmode: type === 'cumulative_target' ? 'numeric' : 'decimal', required: true });
      extra.push(field('Valor', inputs.valor, type === 'cumulative_target'
        ? 'Cantidad de esa fecha (incremental, no acumulada), entero >= 0'
        : 'Número >= 0'));
    } else {
      inputs.app_id = el('input', { id: 'ms-app', type: 'text', maxlength: '100', required: true });
      inputs.cumple = select('ms-compliant', [{ value: 'sí', label: 'Sí' }, { value: 'no', label: 'No' }]);
      extra.push(field('Aplicación (app_id)', inputs.app_id), field('Cumple', inputs.cumple));
    }
    if (type === 'cumulative_target') {
      inputs.categoria = cats.length
        ? select('ms-category', cats.map((c) => ({ value: c, label: c })))
        : el('input', { id: 'ms-category', type: 'text', maxlength: '50' });
      inputs.tipo = select('ms-kind', [{ value: 'resuelta', label: 'Resuelta' }, { value: 'detectada', label: 'Detectada (nueva)' }]);
      extra.push(field('Categoría', inputs.categoria), field('Tipo', inputs.tipo));
    }
    const saveOne = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Guardar medición' });
    const manual = el('form', { class: 'measurement-form', novalidate: true, 'aria-labelledby': 'ms-manual-title' }, [
      el('h3', { id: 'ms-manual-title', text: 'Captura manual' }),
      field('Fecha', inputs.fecha),
      field('Unidad', inputs.unidad),
      ...extra,
      saveOne,
    ]);
    manual.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fields = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
      // La unidad se elige de la lista: se valida por id.
      const res = validateMeasurementInput(cfg, fields, { units: state.units, today: todayInBusinessTz() });
      if (!res.ok) { msg.fail(res.errors.map((e) => e.message)); return; }
      saveOne.disabled = true;
      try {
        await insertMeasurements(ind.id, [res.row]);
        msg.ok(`Medición del ${res.row.date} para ${unitName(res.row.unitId)} guardada.`);
        if (inputs.valor) inputs.valor.value = '';
        if (inputs.app_id) inputs.app_id.value = '';
        await refreshRecent();
      } catch (err) {
        msg.fail(err.message);
      } finally {
        saveOne.disabled = false;
      }
    });

    // ---- Importación CSV ----
    const spec = CSV_COLUMNS[type];
    const header = [...spec.required, ...spec.optional].join(',');
    const file = el('input', { id: 'ms-csv', type: 'file', accept: '.csv,text/csv' });
    const preview = el('div', { class: 'csv-preview' });
    let pending = [];
    const saveAll = el('button', { type: 'button', class: 'btn btn-primary', text: 'Guardar mediciones del archivo', disabled: true });

    file.addEventListener('change', async () => {
      pending = [];
      saveAll.disabled = true;
      msg.clear();
      preview.replaceChildren();
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > CSV_MAX_BYTES) {
        preview.replaceChildren(errorList([{ row: null, message: 'El archivo supera 1 MB' }]));
        return;
      }
      const text = await f.text();
      if (state.current !== ind) return;
      const result = parseMeasurementsCsv(text, cfg, { units: state.units, today: todayInBusinessTz() });
      if (result.errors.length) {
        preview.replaceChildren(errorList(result.errors));
        return;
      }
      pending = result.rows;
      saveAll.disabled = false;
      saveAll.textContent = `Guardar ${pending.length} mediciones`;
      preview.replaceChildren(
        el('p', { class: 'csv-ok', text: `${pending.length} filas válidas, listas para guardar.` }),
        table(`Vista previa (primeras ${Math.min(PREVIEW_MAX, pending.length)} filas)`,
          ['Fila', 'Fecha', 'Unidad', 'Dato'],
          pending.slice(0, PREVIEW_MAX).map((r) => [String(r.line), r.date, unitName(r.unitId), describeMeasurement({
            value: r.value, app_id: r.appId, compliant: r.compliant, category: r.category, kind: r.kind,
          })])),
      );
    });

    saveAll.addEventListener('click', async () => {
      if (!pending.length) return;
      saveAll.disabled = true;
      try {
        const n = await insertMeasurements(ind.id, pending);
        pending = [];
        file.value = '';
        preview.replaceChildren();
        saveAll.textContent = 'Guardar mediciones del archivo';
        msg.ok(`Se guardaron ${n} mediciones.`);
        await refreshRecent();
      } catch (err) {
        saveAll.disabled = false;
        msg.fail(err.message);
      }
    });

    const csv = el('section', { class: 'csv-import', 'aria-labelledby': 'ms-csv-title' }, [
      el('h3', { id: 'ms-csv-title', text: 'Importar CSV' }),
      el('p', { text: `Primera fila con la cabecera: ${header}. Separador coma o punto y coma. Unidad por su nombre. Máximo 1 MB y ${CSV_MAX_ROWS} filas. Si alguna fila tiene errores no se guarda ninguna.` }),
      field('Archivo CSV', file),
      preview,
      saveAll,
    ]);

    body.replaceChildren(manual, csv, recent);
    refreshRecent();
  }

  function errorList(errors) {
    return el('div', { class: 'csv-errors', role: 'alert' }, [
      el('p', { text: `El archivo tiene ${errors.length} ${errors.length === 1 ? 'error' : 'errores'}; no se guardó nada.` }),
      el('ul', {}, errors.map((e) => el('li', { text: e.row ? `Fila ${e.row}: ${e.message}` : e.message }))),
    ]);
  }

  load();
  return el('section', { class: 'card', 'aria-labelledby': 'measurements-title' }, [
    el('h2', { id: 'measurements-title', text: 'Mediciones' }),
    msg.status,
    msg.error,
    picker,
    body,
  ]);
}
