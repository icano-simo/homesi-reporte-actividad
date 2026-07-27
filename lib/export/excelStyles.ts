import type { Worksheet, Fill, Border } from 'exceljs';

/** Paleta de colores del reporte, port exacto de XL del legacy. */
export const XL = {
  NAVY: 'FF1E3A5F',
  NAVYLT: 'FFEAF0F7',
  GREY: 'FFF3F4F6',
  GREEN: 'FF059669',
  WHITE: 'FFFFFFFF',
  DARK: 'FF1F2937',
} as const;

/** Port de xfill() del legacy: relleno sólido. */
export function xfill(argb: string): Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** Port de xborderAll() del legacy: borde fino en las 4 caras de una celda. */
export function xborderAll(ws: Worksheet, r: number, c: number): void {
  const thin: Partial<Border> = { style: 'thin', color: { argb: 'FFD5DBE3' } };
  ws.getCell(r, c).border = { top: thin, left: thin, bottom: thin, right: thin };
}

/**
 * Port de xouterBorder() del legacy: borde grueso perimetral alrededor de un
 * rango de filas/columnas (p.ej. todas las filas de un OrgID), sin perturbar
 * la grilla fina interna que ya puso xborderAll().
 */
export function xouterBorder(ws: Worksheet, r1: number, r2: number, c1: number, c2: number): void {
  const thick: Partial<Border> = { style: 'medium', color: { argb: 'FF1E3A5F' } };
  for (let c = c1; c <= c2; c++) {
    const t = ws.getCell(r1, c);
    t.border = { ...t.border, top: thick };
    const b = ws.getCell(r2, c);
    b.border = { ...b.border, bottom: thick };
  }
  for (let r = r1; r <= r2; r++) {
    const l = ws.getCell(r, c1);
    l.border = { ...l.border, left: thick };
    const rr = ws.getCell(r, c2);
    rr.border = { ...rr.border, right: thick };
  }
}

/** Port de colLetter() del legacy: número de columna (1-based) a letra de Excel. */
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - m - 1) / 26;
  }
  return s;
}
