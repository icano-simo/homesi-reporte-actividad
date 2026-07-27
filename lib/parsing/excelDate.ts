import type { YearMonth } from './types';

/**
 * Convierte un valor crudo de celda de Excel a 'YYYY-MM', probando en orden:
 *   1. null/undefined/'' -> null
 *   2. number -> serial de fecha de Excel (base 1899-11-30, UTC)
 *   3. Date -> año-mes en UTC
 *   4. string 'YYYY-MM-DD...' -> regex
 *   5. string 'M/D/YYYY' -> regex
 *   6. fallback: new Date(s); null si es inválida
 *
 * Toda la aritmética usa métodos UTC (Date.UTC, getUTCFullYear, getUTCMonth)
 * a propósito: los métodos locales (getFullYear/getMonth) desplazan el mes
 * según la zona horaria del navegador, lo que corre fechas cercanas al
 * límite de mes hacia el mes anterior o siguiente.
 */
export function excelValueToYearMonth(value: unknown): YearMonth | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    const ms = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  if (value instanceof Date) {
    return value.getUTCFullYear() + '-' + String(value.getUTCMonth() + 1).padStart(2, '0');
  }

  const s = String(value).trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + String(m[1]).padStart(2, '0');

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  return null;
}
