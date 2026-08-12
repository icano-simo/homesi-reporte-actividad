/*
 * ============================================================================
 * ESTADO DE SALUD DE UN PRÉSTAMO — etiqueta y color del badge
 * ============================================================================
 *
 * Etapa UX1 — ARCHIVO NUEVO, sin lógica nueva: las dos funciones son las que
 * vivían en `PivotTable.tsx` (exportadas desde ahí) y que `LoanDetailModal.tsx`
 * importaba de vuelta, creando un import circular entre ambos. El comentario
 * de LoanDetailModal.tsx ya señalaba esta misma solución como la correcta:
 *
 *   "Si algún día se vuelve un problema real, la solución es mover
 *    healthStatusLabel/healthStatusColor a un archivo neutral que ambos
 *    importen, en vez de que se importen entre sí."
 *
 * Como esta etapa reemplaza el modal por un flyout (spec §5) y toca ambos
 * archivos igual, se aprovechó para cerrar ese pendiente.
 *
 * NADA de esto alimenta ningún cálculo: `classifyHealthy()` y el campo
 * `healthy` (lib/pipeline/) siguen intactos y son los que deciden Healthy
 * Pipeline. Acá solo se decide el TEXTO y el COLOR que ve el usuario.
 */

/** Clase CSS del badge, dentro del sistema `.badge` de components.css. */
export type HealthBadgeVariant = 'badge--emerald' | 'badge--amber' | 'badge--rose' | 'badge--neutral';

/**
 * Mismo criterio que classifyHealthy() en salesforce-file.ts ("On Track" o
 * vacío -> healthy) -- acá se devuelve la etiqueta visible en vez del boolean.
 */
export function healthStatusLabel(rawHealthiness: string): string {
  const v = rawHealthiness.trim();
  return v === '' ? 'Healthy' : v;
}

/**
 * Variante de badge a partir del label YA resuelto por healthStatusLabel() --
 * no vuelve a comparar contra el string crudo, solo mapea label -> variante.
 *
 * Etapa UX1: antes devolvía un objeto {background, color} con tokens sueltos
 * que cada consumidor pegaba como estilo inline. Ahora devuelve el nombre de
 * la clase del sistema de badges, así el color vive solo en el CSS (spec §2:
 * paleta de marca, nada de hex sueltos en el JSX).
 */
export function healthStatusVariant(label: string): HealthBadgeVariant {
  switch (label) {
    case 'Healthy':
    case 'On Track':
      return 'badge--emerald';
    case 'Delayed':
      return 'badge--amber';
    case 'Never':
      return 'badge--rose';
    default:
      // 'Out of Scope' y cualquier valor futuro no contemplado -- gris neutro.
      return 'badge--neutral';
  }
}
