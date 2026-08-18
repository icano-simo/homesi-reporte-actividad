import type { RawLoanRow } from '@/lib/parsing/types';

/**
 * Regla de negocio confirmada por Isabella (2026-08-18): los loans con
 * HELOC LIEN POSITION = 2 no se cuentan en Commercial Activity -- no dejan
 * utilidad para la empresa y confunden los reportes si se incluyen. Es una
 * exclusión GLOBAL del universo de Activity (branch, metric, loan officer,
 * BD, filtros, drill-down, export), no un filtro visual: se aplica una sola
 * vez, sobre RawLoanRow, ANTES de classifyLoan() -- ver app/page.tsx.
 *
 * Condición única e intencionalmente estricta: `=== 2`. Ningún otro campo
 * (Channel, Loan Program, Branch, B2B, Loan Officer, milestone) participa de
 * esta decisión. Un archivo sin la columna, o con la celda vacía para esa
 * fila, da `helocLienPosition === null` -- no se excluye por default.
 */
export function isHelocLien2(raw: RawLoanRow): boolean {
  return raw.helocLienPosition === 2;
}
