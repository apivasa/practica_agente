// Vista de login: formulario accesible con etiquetas, errores anunciados
// (role="alert") y mensajes que no revelan si el correo existe.
import { el } from './dom.js';

/**
 * @param {object} opts
 * @param {(email: string, password: string) => Promise<{ ok: boolean, message?: string }>} opts.onSubmit
 * @param {string} [opts.notice] aviso previo (p. ej. configuración incompleta)
 */
export function renderLogin({ onSubmit, notice }) {
  const error = el('p', { id: 'login-error', class: 'form-error', role: 'alert', 'aria-live': 'assertive' });
  if (notice) error.textContent = notice;

  const email = el('input', {
    id: 'login-email', name: 'email', type: 'email', autocomplete: 'username',
    required: true, 'aria-describedby': 'login-error',
  });
  const password = el('input', {
    id: 'login-password', name: 'password', type: 'password', autocomplete: 'current-password',
    required: true, 'aria-describedby': 'login-error',
  });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Entrar' });

  const form = el('form', { class: 'card login-form', novalidate: true, 'aria-labelledby': 'login-title' }, [
    el('h2', { id: 'login-title', text: 'Iniciar sesión' }),
    el('div', { class: 'field' }, [el('label', { for: 'login-email', text: 'Correo' }), email]),
    el('div', { class: 'field' }, [el('label', { for: 'login-password', text: 'Contraseña' }), password]),
    error,
    submit,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    if (!email.value.trim() || !password.value) {
      error.textContent = 'Escribe tu correo y tu contraseña.';
      (email.value.trim() ? password : email).focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Entrando…';
    form.setAttribute('aria-busy', 'true');
    try {
      const result = await onSubmit(email.value, password.value);
      if (!result.ok) {
        error.textContent = result.message;
        password.value = '';
        password.focus();
      }
    } finally {
      if (form.isConnected) {
        submit.disabled = false;
        submit.textContent = 'Entrar';
        form.removeAttribute('aria-busy');
      }
    }
  });

  return form;
}
