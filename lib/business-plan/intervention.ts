import type { BranchStatus, LoanOfficerRow } from './types';

/**
 * ============================================================================
 * ESTADO DE INTERVENCIÓN DE UN BRANCH
 * ============================================================================
 *
 * Etapa BP5 — ARCHIVO NUEVO.
 *
 * Hasta BP4 la columna Status de un branch intentaba resumir su RENDIMIENTO, y
 * eso no significaba nada: un branch con gente en riesgo y gente bien no tiene
 * un rendimiento único, y promediarlo escondía justo lo que había que ver.
 *
 * Ahora responde una pregunta operativa, que sí tiene una única respuesta:
 * **¿los que están en riesgo ya están atendidos?**
 *
 *   Sin riesgo     ningún Loan Officer en On Risk
 *   Atendido       todos los que están en riesgo tienen un plan activo
 *   Revisado       fueron revisados, pero todavía sin funnel elegido
 *   Pendiente (N)  N en riesgo sin revisar ni plan
 *
 * El orden importa: se degrada al peor caso. Basta uno sin revisar para que el
 * branch entero quede Pendiente -- si no, un branch con nueve atendidos y uno
 * abandonado se vería igual que uno con diez atendidos.
 */
export function branchStatus(atRisk: LoanOfficerRow[]): { status: BranchStatus; pendingCount: number } {
  if (atRisk.length === 0) return { status: 'no_risk', pendingCount: 0 };

  const pendingCount = atRisk.filter((lo) => lo.intervention === null).length;
  if (pendingCount > 0) return { status: 'pending', pendingCount };

  // Ya no hay pendientes: o todos tienen plan activo, o alguno quedó revisado.
  const allActive = atRisk.every((lo) => lo.intervention?.status === 'active');
  return { status: allActive ? 'handled' : 'reviewed', pendingCount: 0 };
}

export function branchStatusLabel(status: BranchStatus, pendingCount: number): string {
  switch (status) {
    case 'no_risk':
      return 'No risk';
    case 'handled':
      return 'Handled';
    case 'reviewed':
      return 'Reviewed';
    case 'pending':
      return `Pending (${pendingCount})`;
  }
}

/**
 * Clase del badge. "Sin riesgo" va en gris y no en verde a propósito: no es un
 * logro del branch, es la ausencia de un problema. El verde queda para
 * "Atendido", que sí implica que alguien hizo algo.
 */
export function branchStatusClass(status: BranchStatus): string {
  switch (status) {
    case 'no_risk':
      return 'badge badge--pill badge--neutral';
    case 'handled':
      return 'badge badge--pill badge--emerald';
    case 'reviewed':
      return 'badge badge--pill badge--sky';
    case 'pending':
      return 'badge badge--pill badge--rose';
  }
}
