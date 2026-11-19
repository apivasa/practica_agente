// Pantalla de inicio por rol: nombre del rol y un placeholder del contenido
// que llegará en ítems posteriores.
import { el } from './dom.js';
import { ROLE_LABELS } from '../lib/route-logic.js';

const PLACEHOLDERS = {
  kpi_manager: 'Aquí verás el alta de indicadores, la asignación de custodios y el tablero de completitud por custodio.',
  custodian: 'Aquí cargarás las mediciones de tus indicadores y negociarás umbrales y compromisos con las unidades.',
  committee: 'Aquí verás todas las unidades, las alertas, las escaladas y las excepciones por aprobar.',
  unit_leader: 'Aquí verás tus indicadores, su color, tu meta mensual, tu avance y tus restricciones activas.',
};

/**
 * @param {object} opts
 * @param {string} opts.role clave de rol (kpi_manager, custodian, committee, unit_leader)
 * @param {Array<{ role: string, unit_id: string|null, indicator_id: string|null }>} opts.rows filas de user_roles
 */
export function renderRoleHome({ role, rows }) {
  const scoped = rows.filter((r) => r.role === role);
  let scope = null;
  if (role === 'custodian') scope = `Indicadores a tu cargo: ${scoped.length}.`;
  if (role === 'unit_leader') scope = `Unidades a tu cargo: ${scoped.length}.`;

  return el('section', { class: 'card', 'aria-labelledby': 'role-title', 'data-role': role }, [
    el('h2', { id: 'role-title', text: ROLE_LABELS[role] }),
    scope && el('p', { class: 'scope', text: scope }),
    el('p', { class: 'placeholder', text: PLACEHOLDERS[role] }),
  ]);
}
