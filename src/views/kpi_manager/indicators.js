// M-02 · Gestora: alta y edición de indicadores con los 7 atributos del modelo
// genérico, umbrales por categoría, custodio y activación.
import { el } from '../dom.js';
import { field, select, messages, table } from '../form.js';
import {
  buildIndicatorRow, formValuesFromRow, custodianCandidates, incoherentCustodians,
  TYPE_LABELS, DIRECTION_LABELS, FREQUENCY_LABELS, SOURCE_LABELS,
} from '../../lib/indicator-form.js';
import { listIndicators, saveIndicator, setIndicatorActive, assignCustodian } from '../../data/indicators.js';
import { listCustodianRoles } from '../../data/roles.js';

const opts = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export function renderIndicators() {
  const msg = messages();
  const listBox = el('div', { class: 'list-box', 'aria-busy': 'true' }, [el('p', { text: 'Cargando indicadores…' })]);
  const formBox = el('div', { class: 'form-box' });
  const state = { indicators: [], roles: [] };

  const newBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Nuevo indicador', onclick: () => openForm(null) });

  async function reload() {
    listBox.setAttribute('aria-busy', 'true');
    try {
      [state.indicators, state.roles] = await Promise.all([listIndicators(), listCustodianRoles()]);
      paintList();
    } catch (err) {
      listBox.replaceChildren();
      msg.fail(err.message);
    } finally {
      listBox.removeAttribute('aria-busy');
    }
  }

  function custodianLabel(ind, candidates) {
    if (!ind.custodian_user_id) return 'Sin custodio';
    return candidates.find((c) => c.userId === ind.custodian_user_id)?.label ?? `usuario ${ind.custodian_user_id.slice(0, 8)}…`;
  }

  function paintList() {
    const candidates = custodianCandidates(state.roles, state.indicators);
    const bad = new Set(incoherentCustodians(state.indicators, state.roles));
    const rows = state.indicators.map((ind) => [
      ind.code,
      ind.name,
      TYPE_LABELS[ind.measurement_type] ?? ind.measurement_type,
      ind.active ? 'Activo' : 'Inactivo',
      el('span', {}, [
        custodianLabel(ind, candidates),
        bad.has(ind.id) ? el('strong', { class: 'warn', text: ' (permisos incoherentes: vuelve a guardar el custodio)' }) : null,
      ]),
      el('span', { class: 'actions' }, [
        el('button', { type: 'button', class: 'btn', 'aria-label': `Editar ${ind.code}`, text: 'Editar', onclick: () => openForm(ind) }),
        el('button', {
          type: 'button', class: 'btn', 'aria-label': `${ind.active ? 'Desactivar' : 'Activar'} ${ind.code}`,
          text: ind.active ? 'Desactivar' : 'Activar',
          onclick: async () => {
            try {
              await setIndicatorActive(ind.id, !ind.active);
              msg.ok(`Indicador ${ind.code} ${ind.active ? 'desactivado' : 'activado'}.`);
              await reload();
            } catch (err) { msg.fail(err.message); }
          },
        }),
      ]),
    ]);
    listBox.replaceChildren(rows.length
      ? table('Indicadores', ['Código', 'Nombre', 'Tipo', 'Estado', 'Custodio', 'Acciones'], rows)
      : el('p', { text: 'Todavía no hay indicadores.' }));
  }

  function categoryRow(c = { name: '', green: '', yellow: '' }, container) {
    const n = container.children.length + 1;
    const name = el('input', { type: 'text', class: 'cat-name', 'aria-label': `Categoría ${n}`, value: c.name, maxlength: '50' });
    const g = el('input', { type: 'text', inputmode: 'decimal', class: 'cat-green', 'aria-label': `Verde de categoría ${n}`, value: c.green });
    const y = el('input', { type: 'text', inputmode: 'decimal', class: 'cat-yellow', 'aria-label': `Amarillo de categoría ${n}`, value: c.yellow });
    const row = el('div', { class: 'cat-row' }, [name, g, y]);
    row.append(el('button', { type: 'button', class: 'btn', 'aria-label': `Quitar categoría ${n}`, text: 'Quitar', onclick: () => row.remove() }));
    return row;
  }

  function openForm(ind) {
    msg.clear();
    const v = formValuesFromRow(ind);
    const candidates = custodianCandidates(state.roles, state.indicators);
    const input = (id, value, extra = {}) => el('input', { id, name: id, type: 'text', value, ...extra });

    const f = {
      code: input('ind-code', v.code, { required: true, maxlength: '40', autocomplete: 'off' }),
      name: input('ind-name', v.name, { required: true, maxlength: '120' }),
      description: el('textarea', { id: 'ind-description', name: 'ind-description', maxlength: '500', rows: '2' }),
      measurement_type: select('ind-type', opts(TYPE_LABELS), v.measurement_type),
      direction: select('ind-direction', opts(DIRECTION_LABELS), v.direction),
      window_days: input('ind-window', v.window_days, { inputmode: 'numeric' }),
      green: input('ind-green', v.green, { inputmode: 'decimal', required: true }),
      yellow: input('ind-yellow', v.yellow, { inputmode: 'decimal', required: true }),
      frequency: select('ind-frequency', opts(FREQUENCY_LABELS), v.frequency),
      min_sample: input('ind-min-sample', v.min_sample, { inputmode: 'numeric' }),
      source: select('ind-source', opts(SOURCE_LABELS), v.source),
      custodian: select('ind-custodian', [{ value: '', label: 'Sin custodio' },
        ...candidates.map((c) => ({ value: c.userId, label: c.label }))], v.custodian_user_id),
      active: el('input', { id: 'ind-active', name: 'ind-active', type: 'checkbox' }),
    };
    f.description.value = v.description;
    f.active.checked = v.active;

    const cats = el('div', { class: 'cat-list' });
    for (const c of v.categories) cats.append(categoryRow(c, cats));
    const addCat = el('button', { type: 'button', class: 'btn', text: 'Agregar categoría', onclick: () => cats.append(categoryRow(undefined, cats)) });

    const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Guardar indicador' });
    const cancel = el('button', { type: 'button', class: 'btn', text: 'Cancelar', onclick: () => { formBox.replaceChildren(); msg.clear(); } });

    const form = el('form', { class: 'indicator-form', novalidate: true, 'aria-labelledby': 'ind-form-title' }, [
      el('h3', { id: 'ind-form-title', text: ind ? `Editar indicador ${ind.code}` : 'Nuevo indicador' }),
      field('Código', f.code, 'Identificador corto, ej. CHG-FAIL'),
      field('Nombre', f.name),
      field('Descripción', f.description),
      field('Tipo de medición', f.measurement_type),
      field('Sentido', f.direction),
      field('Ventana (días)', f.window_days),
      field('Umbral verde', f.green),
      field('Umbral amarillo', f.yellow),
      el('fieldset', { class: 'cat-editor' }, [
        el('legend', { text: 'Umbrales por categoría (opcional): nombre, verde, amarillo' }),
        cats, addCat,
      ]),
      field('Frecuencia', f.frequency),
      field('Mínimo de muestra', f.min_sample),
      field('Fuente', f.source),
      field('Custodio', f.custodian, 'Usuarios con rol de custodio. Al guardar se le dan los permisos sobre este indicador.'),
      el('div', { class: 'field field-inline' }, [f.active, el('label', { for: 'ind-active', text: 'Activo' })]),
      el('div', { class: 'form-actions' }, [submit, cancel]),
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = {
        code: f.code.value, name: f.name.value, description: f.description.value,
        measurement_type: f.measurement_type.value, direction: f.direction.value,
        window_days: f.window_days.value, green: f.green.value, yellow: f.yellow.value,
        categories: [...cats.querySelectorAll('.cat-row')].map((r) => ({
          name: r.querySelector('.cat-name').value,
          green: r.querySelector('.cat-green').value,
          yellow: r.querySelector('.cat-yellow').value,
        })),
        frequency: f.frequency.value, min_sample: f.min_sample.value, source: f.source.value,
        active: f.active.checked,
      };
      const built = buildIndicatorRow(values);
      if (!built.ok) { msg.fail(built.errors); return; }
      submit.disabled = true;
      form.setAttribute('aria-busy', 'true');
      try {
        const saved = await saveIndicator(ind?.id ?? null, built.row);
        if ((saved.custodian_user_id ?? '') !== f.custodian.value || incoherentCustodians([saved], state.roles).length) {
          await assignCustodian(saved.id, f.custodian.value || null);
        }
        formBox.replaceChildren();
        msg.ok(`Indicador ${saved.code} guardado.`);
        await reload();
      } catch (err) {
        msg.fail(err.message);
      } finally {
        submit.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });

    formBox.replaceChildren(form);
    f.code.focus();
  }

  reload();
  return el('section', { class: 'card', 'aria-labelledby': 'indicators-title' }, [
    el('h2', { id: 'indicators-title', text: 'Indicadores' }),
    el('p', { text: 'Da de alta y edita indicadores. Cualquier indicador se describe con 7 atributos: tipo, sentido, ventana, umbrales, frecuencia, mínimo de muestra y fuente.' }),
    msg.status,
    msg.error,
    newBtn,
    formBox,
    listBox,
  ]);
}
