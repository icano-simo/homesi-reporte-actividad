import type { Worksheet } from 'exceljs';

/**
 * ============================================================================
 * EL FORMATO COMPARTIDO DE LOS REPORTES DE PIPELINE — etapa RPT6
 * ============================================================================
 *
 * ⚠ ARCHIVO NUEVO SIN DECISIONES NUEVAS. Todo esto vivía dentro de
 * `app/api/pipeline/monthly-report/route.ts`. Sale de ahí porque el export del
 * día tiene que leerse IGUAL que el mensual, y dos copias del mismo encabezado
 * divergen a la primera corrección que se aplique a una sola.
 *
 * Es el mismo criterio con el que salieron `isClosedInMonth` y
 * `buildBranchForecastRows`: se extrae cuando aparece el segundo consumidor, no
 * antes y no después.
 */

/**
 * ⚠ LOS COLORES SALEN DE `app/styles/tokens.css`, no se inventan acá. Son los
 * cuatro de HomeSí más la escala neutra que ya usa toda la app, en ARGB porque
 * es lo que pide ExcelJS. Si alguno cambia en la marca, cambia ahí y acá.
 *
 * Los tonos derivados son mezclas del color de marca sobre blanco, porque un
 * relleno de Excel es OPACO: no hay opacidad, así que el tono claro hay que
 * calcularlo. El porcentaje va anotado en cada uno para poder rehacerlo.
 */
export const C = {
  navy: 'FF001A40',
  coral: 'FFFF4040',
  sky: 'FFA6DEFF',
  canvas: 'FFFCFCFA',
  white: 'FFFFFFFF',
  slate100: 'FFF1F5F9',
  slate200: 'FFE2E8F0',
  slate300: 'FFCBD5E1',
  slate500: 'FF64748B',
  /** coral al 28% sobre blanco: la fila de división. Al 12% no se leía. */
  coralSoft: 'FFFFCCCC',
  /** navy al 16% sobre blanco: las filas de branch. */
  navySoft: 'FFD8DCE4',
  /** sky al 45% sobre blanco: la banda de período. Al 25% se leía como blanco. */
  skySoft: 'FFD3EEFF',
  /**
   * La banda cebra de las filas de persona. Es `slate-100` y no `slate-50`:
   * medido contra una captura, al 50 no se distinguía del blanco y la cebra no
   * cumplía su única función, que es seguir una fila a lo ancho de veintidós
   * columnas de números.
   */
  zebra: 'FFF1F5F9',
} as const;

/** Arial: la app usa Inter, que Excel no tiene. */
export const FONT = 'Arial';

export type Fill = { type: 'pattern'; pattern: 'solid'; fgColor: { argb: string } };
export const fill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

export const THIN = { style: 'thin' as const, color: { argb: C.slate300 } };
export const MEDIUM = { style: 'medium' as const, color: { argb: C.navy } };

/** Un grupo de columnas bajo una banda: su rótulo y cuántas columnas de dato abarca. */
export interface ColumnGroup {
  label: string;
  span: number;
}

export interface ChannelGridSpec {
  /** Los grupos, en orden. La suma de sus `span` es la cantidad de columnas de dato. */
  groups: ColumnGroup[];
  /** El rótulo de cada columna de dato, en orden. */
  headers: string[];
  /**
   * La sub-fila, por índice de columna de dato. En el mensual son
   * `First lien` / `Second Lien` debajo de los dos `Closed`. Vacío = no se
   * escribe ninguna sub-fila, pero la fila EXISTE igual para que las dos hojas
   * tengan el encabezado a la misma altura.
   */
  sub?: Record<number, string>;
  /**
   * Alto de la fila de rótulos. El default alcanza para un rótulo de una línea;
   * si alguno se envuelve en dos --`Total Pipeline` a 16 de ancho-- hay que
   * subirlo o la segunda línea se monta sobre la banda de grupo de arriba.
   * Visto en la primera captura del export del día.
   */
  headerHeight?: number;
}

/**
 * La geometría que resulta de la especificación: dónde cae cada columna de dato
 * y qué columnas son aire.
 *
 * ⚠ LAS SEPARADORAS SON COLUMNAS DE VERDAD, angostas y vacías, no un borde. Es
 * lo que hace el archivo original de julio --D, H, J, O, R, de ancho 1,7 a 3,7--
 * y con veintidós columnas de números seguidas el aire entre bloques es lo que
 * permite leer una fila sin perder de vista en qué grupo se está.
 *
 * `at()` traduce el índice de columna de dato a su columna real, salteando las
 * separadoras. El resto del código habla en índices y nunca en columnas
 * absolutas -- eso es lo que hizo que agregar dos columnas al detalle en RPT3 no
 * rompiera ninguna fórmula.
 */
export interface ChannelGrid {
  at: (channelAt: number, i: number) => number;
  bankedAt: number;
  brokeredAt: number;
  channelSpan: number;
  sepCol: number;
  lastCol: number;
  /** Las columnas de aire: la de antes del primer canal, la del medio y las internas. */
  spacerCols: number[];
  dataCols: number;
}

/** La primera columna de datos: A y B son Branch y Loan Officer, C es aire. */
const FIRST_CHANNEL_AT = 4;
const GAP_COL = 3;

export function channelGrid(spec: ChannelGridSpec): ChannelGrid {
  const dataCols = spec.headers.length;
  const offsets: number[] = [];
  let off = 0;
  for (const g of spec.groups) {
    for (let k = 0; k < g.span; k++) offsets.push(off++);
    /* Una separadora después de cada grupo menos el último. */
    off++;
  }
  const channelSpan = offsets[offsets.length - 1] + 1;
  const bankedAt = FIRST_CHANNEL_AT;
  const sepCol = bankedAt + channelSpan;
  const brokeredAt = sepCol + 1;
  const internas: number[] = [];
  for (const base of [bankedAt, brokeredAt]) {
    for (let k = 0; k < channelSpan; k++) {
      if (!offsets.includes(k)) internas.push(base + k);
    }
  }
  return {
    at: (channelAt, i) => channelAt + offsets[i],
    bankedAt,
    brokeredAt,
    channelSpan,
    sepCol,
    lastCol: brokeredAt + channelSpan - 1,
    spacerCols: [GAP_COL, sepCol, ...internas],
    dataCols,
  };
}

/**
 * ============================================================================
 * ⚠ CUATRO FILAS DE ENCABEZADO, Y LA DE GRUPO ES LA QUE IMPORTA
 * ============================================================================
 *
 *   canal    navy sólido, texto blanco   la separación más fuerte de la hoja
 *   grupo    sky suave                   dónde termina un bloque y empieza otro
 *   columna  slate tenue                 el rótulo, que no tiene que competir
 *   sub                                  lo que distingue dos columnas homónimas
 *
 * La de grupo es la que faltaba en la primera versión del mensual: sin ella las
 * columnas de cada canal corren seguidas y no se ve dónde termina un bloque.
 *
 * Devuelve la fila del último encabezado, que es donde va el `freeze`.
 */
export function writeChannelHeader(sh: Worksheet, spec: ChannelGridSpec, g: ChannelGrid): number {
  const rowCanal = sh.addRow([]);
  const rowGrupo = sh.addRow([]);
  const rowCol = sh.addRow([]);
  const rowSub = sh.addRow([]);

  for (const channelAt of [g.bankedAt, g.brokeredAt]) {
    const c = rowCanal.getCell(channelAt);
    c.value = channelAt === g.bankedAt ? 'BANKED - RETAIL' : 'BROKERED';
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.font = { name: FONT, bold: true, size: 11, color: { argb: C.white } };
    c.fill = fill(C.navy);
    sh.mergeCells(rowCanal.number, channelAt, rowCanal.number, channelAt + g.channelSpan - 1);

    let i = 0;
    for (const grupo of spec.groups) {
      const desde = g.at(channelAt, i);
      const hasta = g.at(channelAt, i + grupo.span - 1);
      const gc = rowGrupo.getCell(desde);
      gc.value = grupo.label;
      gc.alignment = { horizontal: 'center' };
      gc.font = { name: FONT, bold: true, size: 10, color: { argb: C.navy } };
      gc.fill = fill(C.skySoft);
      gc.border = { top: THIN, bottom: THIN, left: MEDIUM, right: MEDIUM };
      if (hasta > desde) sh.mergeCells(rowGrupo.number, desde, rowGrupo.number, hasta);
      i += grupo.span;
    }

    spec.headers.forEach((h, idx) => {
      const cc = rowCol.getCell(g.at(channelAt, idx));
      cc.value = h;
      cc.alignment = { horizontal: 'center', vertical: 'bottom', wrapText: true };
      cc.font = { name: FONT, bold: true, size: 9, color: { argb: C.navy } };
      cc.fill = fill(C.slate100);
    });

    for (const [idx, txt] of Object.entries(spec.sub ?? {})) {
      const cc = rowSub.getCell(g.at(channelAt, Number(idx)));
      cc.value = txt;
      cc.alignment = { horizontal: 'center', wrapText: true };
      cc.font = { name: FONT, bold: true, size: 8, color: { argb: C.slate500 } };
    }
    for (let k = 0; k < g.dataCols; k++) {
      rowSub.getCell(g.at(channelAt, k)).fill = fill(C.slate100);
      rowSub.getCell(g.at(channelAt, k)).border = { bottom: MEDIUM };
    }
  }

  for (const r of [rowCanal, rowGrupo, rowCol, rowSub]) r.font = { name: FONT, bold: true };

  /* Branch y Loan Officer ocupan las cuatro filas, combinadas en vertical. */
  sh.getCell(rowCanal.number, 1).value = 'Branch';
  sh.getCell(rowCanal.number, 2).value = 'Loan Officer';
  sh.mergeCells(rowCanal.number, 1, rowSub.number, 1);
  sh.mergeCells(rowCanal.number, 2, rowSub.number, 2);
  for (const col of [1, 2]) {
    const cc = sh.getCell(rowCanal.number, col);
    cc.alignment = { vertical: 'bottom' };
    cc.font = { name: FONT, bold: true, size: 10, color: { argb: C.white } };
    cc.fill = fill(C.navy);
  }

  sh.getRow(rowCanal.number).height = 20;
  sh.getRow(rowCol.number).height = spec.headerHeight ?? 24;
  return rowSub.number;
}

/** El ancho de las columnas de una hoja con `channelGrid`. */
export function setChannelWidths(sh: Worksheet, g: ChannelGrid, dataWidth: (i: number) => number): void {
  sh.getColumn(1).width = 11;
  sh.getColumn(2).width = 30;
  for (const col of g.spacerCols) sh.getColumn(col).width = col === g.sepCol ? 3 : 2;
  for (const channelAt of [g.bankedAt, g.brokeredAt]) {
    for (let k = 0; k < g.dataCols; k++) sh.getColumn(g.at(channelAt, k)).width = dataWidth(k);
  }
}
