// S-04 — Anti-framing. frame-ancestors no aplica desde <meta> y GitHub Pages
// no permite la cabecera X-Frame-Options ni CSP, así que el front se protege
// del clickjacking desde JavaScript: si la página está dentro de un marco, se
// vacía y oculta el documento antes de que main.js arme la app (main.js
// importa este módulo primero y no arranca si #app no existe).
// Riesgo residual: con JavaScript desactivado no hay app que enmarcar.
export function isFramed(win = window) {
  try {
    return win.top !== win.self;
  } catch {
    return true; // acceso denegado a top: se asume enmarcado
  }
}

export function blockIfFramed(win = window) {
  if (!isFramed(win)) return false;
  const doc = win.document;
  doc.body?.replaceChildren();
  if (doc.body) doc.body.hidden = true;
  doc.documentElement.hidden = true;
  return true;
}

if (typeof window !== 'undefined') blockIfFramed();
