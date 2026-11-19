// Punto de entrada del front. Pantalla mínima; las vistas llegan en ítems posteriores.
export const APP_TITLE = 'App de control de capacidad RUN';

export function renderHome(root) {
  const main = document.createElement('main');
  const h1 = document.createElement('h1');
  h1.textContent = APP_TITLE;
  const p = document.createElement('p');
  p.textContent = 'Seguimiento de indicadores RUN por unidad.';
  main.append(h1, p);
  root.replaceChildren(main);
}

const root = document.getElementById('app');
if (root) {
  renderHome(root);
}
