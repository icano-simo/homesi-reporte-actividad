import type { Worksheet } from 'exceljs';
import type { ReportTree, MetricMap, Measure } from '@/lib/aggregation/types';
import type { YearMonth } from '@/lib/parsing/types';
import { sumMonths } from '@/lib/aggregation/sumMonths';
import { METRICS, MONTH_NAMES, type MetricKey } from '@/config/metrics';
import { BRANCH_ORDER } from '@/config/roster';
import { XL, xfill, xborderAll, xouterBorder, colLetter } from './excelStyles';

function monthAbbrev(ym: YearMonth): string {
  return MONTH_NAMES[Number(ym.split('-')[1]) - 1].slice(0, 3);
}

/**
 * Port de xlBranchSheet() del legacy: OrgID | Metric | meses... | Total,
 * un bloque "Total" seguido de un bloque por branch, sin drill-down. Todas
 * las sumas vienen de tree.total.maps / metricGroups[].total (ya calculados
 * por buildReportTree/computeMetricMaps) -- esta función solo escribe celdas.
 *
 * No se portó el parámetro withBlankAfter/lastMonthOfYear del legacy: el
 * único call site de xlBranchSheet en exportExcel() lo llama con `false`,
 * así que esa rama nunca se ejecutaba en la práctica.
 *
 * tree.branches solo trae los branches con actividad en `months` (correcto
 * para pantalla, Etapa 5). Para el Excel se recorre BRANCH_ORDER completo
 * (los 20 branches oficiales, en su orden) en vez de tree.branches: los que
 * no aparecen en tree.branches se emiten igual, con un MetricMap vacío
 * ({} -- cada mes cae en 0 sin ningún cálculo), preservando el orden
 * oficial y el conteo fijo de 20 bloques que tenía xlBranchSheet().
 */
export function buildBranchSheet(ws: Worksheet, tree: ReportTree, months: YearMonth[], measure: Measure): void {
  const fc = 3;
  const total = 3 + months.length;
  const amt = measure === 'amount';

  ws.getCell(1, 1).value = 'OrgID';
  ws.mergeCells(1, 1, 2, 1);
  ws.getCell(1, 2).value = 'Metric';
  ws.mergeCells(1, 2, 2, 2);

  let i = 0;
  while (i < months.length) {
    const year = months[i].split('-')[0];
    let span = 1;
    while (i + span < months.length && months[i + span].split('-')[0] === year) span++;
    const c0 = fc + i;
    ws.getCell(1, c0).value = year;
    if (span > 1) ws.mergeCells(1, c0, 1, c0 + span - 1);
    i += span;
  }
  ws.getCell(1, total).value = 'Total';
  ws.mergeCells(1, total, 2, total);
  months.forEach((ym, j) => (ws.getCell(2, fc + j).value = monthAbbrev(ym)));

  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= total; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = xfill(XL.NAVY);
      cell.font = { bold: true, color: { argb: XL.WHITE }, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      xborderAll(ws, r, c);
    }
  }

  let row = 3;

  function block(label: string, maps: Record<MetricKey, MetricMap>, isTot: boolean): void {
    const s0 = row;
    METRICS.forEach(({ key, label: metricLabel }) => {
      const map = maps[key];
      ws.getCell(row, 2).value = metricLabel;
      const rowTotal = sumMonths(map, months);
      months.forEach((ym, j) => {
        ws.getCell(row, fc + j).value = map[ym] || 0;
      });
      ws.getCell(row, total).value = {
        formula: 'SUM(' + colLetter(fc) + row + ':' + colLetter(total - 1) + row + ')',
        result: rowTotal,
      };
      for (let c = 1; c <= total; c++) {
        const cell = ws.getCell(row, c);
        xborderAll(ws, row, c);
        cell.alignment = { horizontal: c <= 2 ? 'left' : 'right', vertical: 'middle' };
        if (amt && c >= fc) cell.numFmt = '$#,##0';
      }
      ws.getCell(row, 2).font = { size: 10, color: { argb: key === 'cl' ? XL.GREEN : XL.DARK } };
      ws.getCell(row, total).font = { bold: true, size: 10 };
      ws.getCell(row, total).fill = xfill(XL.GREY);
      if (isTot) {
        for (let c = 1; c <= total; c++) {
          ws.getCell(row, c).fill = xfill(XL.NAVYLT);
          ws.getCell(row, c).font = { bold: true, size: 10, color: { argb: XL.NAVY } };
        }
      }
      row++;
    });
    ws.mergeCells(s0, 1, row - 1, 1);
    ws.getCell(s0, 1).value = label;
    ws.getCell(s0, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(s0, 1).font = { bold: true, size: 11, color: { argb: isTot ? XL.NAVY : XL.DARK } };
    for (let r = s0; r < row; r++) xborderAll(ws, r, 1);
    xouterBorder(ws, s0, row - 1, 1, total);
  }

  block('Total', tree.total.maps, true);

  const branchMap = new Map(tree.branches.map((b) => [b.branch, b]));
  BRANCH_ORDER.forEach((branchCode) => {
    const found = branchMap.get(branchCode);
    const maps = {} as Record<MetricKey, MetricMap>;
    if (found) {
      found.metricGroups.forEach((g) => {
        maps[g.metric] = g.total;
      });
    } else {
      // Branch oficial sin actividad en `months`: cada métrica queda con un
      // MetricMap vacío, así que todas sus celdas caen en 0 sin calcular nada.
      METRICS.forEach(({ key }) => {
        maps[key] = {};
      });
    }
    block(branchCode, maps, false);
  });

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 15;
  for (let c = fc; c <= total; c++) ws.getColumn(c).width = 8.5;
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
}

/**
 * Port de xlDrillSheet() del legacy: OrgID | Metric | drillLabel | meses... |
 * Total, con un bloque de Total general y luego branch -> métrica -> items
 * (Loan Officer o BD). Los items y sus totales ya vienen ordenados/sumados
 * en tree.branches[].metricGroups[].items (buildReportTree, Etapa 5) -- esta
 * función no agrupa ni suma, solo escribe celdas.
 *
 * A diferencia del legacy (que togglea withMetricTotal/withGrandTotal por
 * hoja: true/true para B2B, false/false para LO), acá ambas hojas drill
 * siempre incluyen el total general y el total por branch-métrica, porque
 * ReportTree ya los trae calculados en ambos casos -- no hay razón para
 * ocultarlos en una hoja sí y en la otra no.
 *
 * Igual que en buildBranchSheet: se recorre BRANCH_ORDER completo (20
 * branches, en orden oficial), no solo tree.branches. Un branch sin
 * actividad se emite con sus 4 filas de métrica en 0 (mismo formato visual
 * que un "Total" de métrica con items) pero sin ninguna fila de drill-down
 * debajo -- no hay loan officers/BD que listar si no hubo actividad.
 */
export function buildDrillSheet(
  ws: Worksheet,
  tree: ReportTree,
  months: YearMonth[],
  measure: Measure,
  drillLabel: string
): void {
  const fc = 4;
  const total = 4 + months.length;
  const amt = measure === 'amount';

  ws.getCell(1, 1).value = 'OrgID';
  ws.getCell(1, 2).value = 'Metric';
  ws.getCell(1, 3).value = drillLabel;
  months.forEach((ym, j) => (ws.getCell(1, fc + j).value = monthAbbrev(ym)));
  ws.getCell(1, total).value = 'Total';
  for (let c = 1; c <= total; c++) {
    const cell = ws.getCell(1, c);
    cell.fill = xfill(XL.NAVY);
    cell.font = { bold: true, color: { argb: XL.WHITE }, size: 10 };
    cell.alignment = { horizontal: c <= 3 ? 'left' : 'center', vertical: 'middle' };
    xborderAll(ws, 1, c);
  }

  let row = 2;

  function emit(metricLabel: string, itemLabel: string, map: MetricMap, metricKey: MetricKey, isTot: boolean): void {
    ws.getCell(row, 2).value = metricLabel;
    ws.getCell(row, 3).value = itemLabel;
    const rowTotal = sumMonths(map, months);
    months.forEach((ym, j) => {
      ws.getCell(row, fc + j).value = map[ym] || null;
    });
    ws.getCell(row, total).value = {
      formula: 'SUM(' + colLetter(fc) + row + ':' + colLetter(total - 1) + row + ')',
      result: rowTotal,
    };
    for (let c = 1; c <= total; c++) {
      const cell = ws.getCell(row, c);
      xborderAll(ws, row, c);
      cell.alignment = { horizontal: c <= 3 ? 'left' : 'right', vertical: 'middle' };
      if (amt && c >= fc) cell.numFmt = '$#,##0';
    }
    if (isTot) {
      for (let c = 3; c <= total; c++) {
        ws.getCell(row, c).fill = xfill(XL.NAVYLT);
        ws.getCell(row, c).font = { bold: true, size: 10, color: { argb: XL.NAVY } };
      }
      ws.getCell(row, 3).alignment = { horizontal: 'left', vertical: 'middle' };
    } else {
      ws.getCell(row, total).font = { bold: true, size: 10 };
      ws.getCell(row, total).fill = xfill(XL.GREY);
      if (metricKey === 'cl') ws.getCell(row, 3).font = { size: 10, color: { argb: XL.GREEN } };
    }
    row++;
  }

  // Bloque de Total general (equivalente a withGrandTotal=true del legacy).
  const gStart = row;
  METRICS.forEach(({ key, label }) => {
    const r = row;
    emit(label, 'Total', tree.total.maps[key], key, true);
    ws.getCell(r, 2).font = { bold: true, size: 10, color: { argb: key === 'cl' ? XL.GREEN : XL.NAVY } };
  });
  if (row - 1 > gStart) ws.mergeCells(gStart, 1, row - 1, 1);
  ws.getCell(gStart, 1).value = 'Total';
  ws.getCell(gStart, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(gStart, 1).font = { bold: true, size: 11, color: { argb: XL.NAVY } };
  for (let r = gStart; r < row; r++) {
    xborderAll(ws, r, 1);
    ws.getCell(r, 1).fill = xfill(XL.NAVYLT);
  }
  xouterBorder(ws, gStart, row - 1, 1, total);

  // Branch -> Métrica -> items (equivalente a withMetricTotal=true del legacy).
  const branchMap = new Map(tree.branches.map((b) => [b.branch, b]));
  BRANCH_ORDER.forEach((branchCode) => {
    const found = branchMap.get(branchCode);
    const bStart = row;

    if (found) {
      found.metricGroups.forEach((group) => {
        if (!group.items.length) return; // sin items no hay nada que abrir en el drill
        const mStart = row;
        emit(group.label, 'Total', group.total, group.metric, true);
        group.items.forEach((item) => emit(group.label, item.name, item.map, group.metric, false));
        if (row - 1 > mStart) ws.mergeCells(mStart, 2, row - 1, 2);
        ws.getCell(mStart, 2).value = group.label;
        ws.getCell(mStart, 2).alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getCell(mStart, 2).font = {
          bold: true,
          size: 10,
          color: { argb: group.metric === 'cl' ? XL.GREEN : XL.DARK },
        };
      });
    } else {
      // Branch oficial sin actividad: 4 filas de métrica en 0, sin drill-down.
      METRICS.forEach(({ key, label }) => {
        const r = row;
        emit(label, 'Total', {}, key, true);
        ws.getCell(r, 2).font = { bold: true, size: 10, color: { argb: key === 'cl' ? XL.GREEN : XL.DARK } };
      });
    }

    if (row - 1 > bStart) {
      ws.mergeCells(bStart, 1, row - 1, 1);
      ws.getCell(bStart, 1).value = branchCode;
      ws.getCell(bStart, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(bStart, 1).font = { bold: true, size: 11 };
      for (let r = bStart; r < row; r++) xborderAll(ws, r, 1);
    }
  });

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 15;
  ws.getColumn(3).width = 24;
  for (let c = fc; c <= total; c++) ws.getColumn(c).width = 8.5;
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];
}
