'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ResolvedLoan } from '@/lib/pipeline/types';
import {
  buildLoanProgramRanking,
  buildLoanTypeRanking,
  buildPropertyStateRanking,
  earliestFundedDisbursementDate,
  fundedLoansInRange,
  hasPropertyStateData,
  NO_PROPERTY_STATE_LABEL,
  type RankingRow,
} from '@/lib/pipeline/analytics';
import {
  buildBranchScorecard,
  buildBusinessDeveloperScorecard,
  buildLoanOfficerScorecard,
  type PersonScorecardResult,
  type ScorecardRow,
} from '@/lib/pipeline/scorecards';
import {
  getDefaultPeriodSelection,
  getDefaultYtdSelection,
  periodDateRange,
  periodLabel,
  periodMonths,
  quarterOfMonth,
  utcToday,
  type PeriodSelection,
} from '@/lib/pipeline/period';
import type { DateRange } from '@/lib/pipeline/aggregate';
import {
  avgTicketByMonth,
  buildMonthlyTotals,
  buildMonthlyTypeBreakdown,
  currentYear,
  type MonthlyAvgTicket,
  type MonthlyTotal,
  type MonthlyTypeBreakdown,
} from '@/lib/pipeline/trends';
import { buildStrategyMix, type StrategyMixRow } from '@/lib/pipeline/strategyMix';
import { classifyStrategy, hasStrategyData, type Strategy } from '@/lib/pipeline/strategy';
import { buildParetoRows, type ParetoRow } from '@/lib/pipeline/paretoMix';
import PeriodSelector from './PeriodSelector';
import { useOrgRoster, type OrgRoster } from './useOrgRoster';
import LoanDetailModal, { type LoanDetailModalColumn, type LoanDetailModalLoan } from './LoanDetailModal';
import { closedLoanToModalLoan } from './PivotTable';
import { AlertTriangleIcon, ArrowUpIcon, ArrowDownIcon, MinusIcon } from '@/components/ui/icons';

export interface TabAnalyticsProps {
  /** Mismo array que ya reciben PivotTable/AdverseTable -- pipeline_resolved_loans del snapshot activo, sin filtrar por canal ni por fecha todavía. */
  resolvedLoans: ResolvedLoan[];
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Version corta para etiquetas de espacio fijo (ej. sobre una barra de
 * chart) -- "15.6M" en vez de "15,559,781". El valor completo (fmtAmount)
 * sigue siendo el que se muestra en tablas y en el tooltip del chart; esto
 * es solo para no desbordar columnas angostas. Mismo criterio de magnitud
 * que el port legacy `fmtAmt` (lib/aggregation/format.ts), sin el prefijo
 * "$" -- este módulo no usa "$" en ningún otro número.
 */
function fmtAmountShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return Math.round(n / 1e3) + 'K';
  return fmtInt(Math.round(n));
}

/**
 * Etapa BI-REDESIGN-1 -- "mejora transversal" del brief de Isa: una barra
 * horizontal delgada detrás del label de cada fila, proporcional a su
 * conteo contra el máximo de la tabla -- mismo objetivo visual que Pareto
 * (escanear "grande vs. chico" de un vistazo) pero sin SVG, un solo
 * `<td>` con gradiente en vez de un elemento nuevo. `--accent-soft`
 * (tokens.css, ya usado para hovers suaves en el resto de la app) es el
 * único color -- cero hex nuevo. `max <= 0` (tabla vacía) devuelve `{}`
 * -- sin barra, no una división por cero silenciosa.
 */
function rankBarStyle(value: number, max: number): CSSProperties {
  if (max <= 0) return {};
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return { background: `linear-gradient(to right, var(--accent-soft) ${pct}%, transparent ${pct}%)` };
}

function RankingTable({
  title,
  columnLabel,
  rows,
  totalCount,
  onRowClick,
}: {
  title: string;
  columnLabel: string;
  rows: RankingRow[];
  totalCount: number;
  /** Etapa F7, Parte 5: drill-down al modal de detalle -- opcional, sin cambio de comportamiento donde no se pasa. */
  onRowClick?: (row: RankingRow) => void;
}) {
  const rowsTotalCount = rows.reduce((sum, r) => sum + r.count, 0);
  const rowsTotalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
  const maxRowCount = Math.max(0, ...rows.map((r) => r.count));

  /*
   * Red de seguridad, mismo criterio que splitCtcAndClosing/aggregate.ts: el
   * ranking agrupa TODOS los loans que recibe (el vacío va a "Sin
   * programa"/"Sin tipo", nunca se descarta uno), así que la suma de sus
   * counts tiene que coincidir siempre con el total de funded del período.
   * Si no coincide, es un préstamo contado dos veces o ninguna -- se avisa en
   * dev, no se esconde.
   */
  if (process.env.NODE_ENV !== 'production' && rowsTotalCount !== totalCount) {
    console.warn(`[TabAnalytics] ${title}: rowsTotalCount (${rowsTotalCount}) no coincide con totalCount (${totalCount})`);
  }

  return (
    <div className="tbl-card">
      <div className="tbl-card__head">
        <span className="tbl-card__title">
          {title} ({fmtInt(rowsTotalCount)})
        </span>
      </div>
      <div className="tbl-scroll">
        <table className="piv">
          <colgroup>
            <col style={{ width: '55%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '25%' }} />
          </colgroup>
          <thead>
            <tr className="mo-row">
              <th className="lbl">{columnLabel}</th>
              <th>Count</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className={'metric' + (onRowClick ? ' metric--drill' : '')}
                key={row.label}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                <td className="lbl" style={{ textAlign: 'left' }}>
                  {row.label}
                </td>
                {/* Etapa AJUSTES-ANALYTICS-1, punto 2: la barra vivía en la columna del NOMBRE -- se mueve a Count, la columna que en realidad describe. */}
                <td className="val" style={rankBarStyle(row.count, maxRowCount)}>
                  {fmtInt(row.count)}
                </td>
                <td className="val">{fmtAmount(row.amount)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={3}>
                  No funded loans in this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="grp total">
                <td className="lbl">Total</td>
                <td className="val">{fmtInt(rowsTotalCount)}</td>
                <td className="val">{fmtAmount(rowsTotalAmount)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function fmtPercent(n: number): string {
  return n.toFixed(1) + '%';
}

/**
 * Scorecard genérico (Branch / Loan Officer / Business Developer): mismas
 * columnas para los 3 -- cerrados, monto total, monto promedio, % del
 * total. `totalCount` es el universo real del scorecard (para Branch, el
 * total de funded del período; para los de persona, `resolvedCount`, no
 * `totalInput` -- los excluidos/no-mapeados/vacíos no tienen fila propia,
 * así que no deben contarse en el % de cada fila resuelta).
 */
function ScorecardTable({
  title,
  columnLabel,
  rows,
  totalCount,
  onRowClick,
  diagnostic,
}: {
  title: string;
  columnLabel: string;
  rows: ScorecardRow[];
  totalCount: number;
  /** Etapa F7, Parte 5: drill-down al modal de detalle -- opcional, sin cambio de comportamiento donde no se pasa. */
  onRowClick?: (row: ScorecardRow) => void;
  /**
   * Etapa F7, Parte 9: reemplaza el texto plano de diagnóstico (Parte 7)
   * por un ícono junto al título -- silencioso si `count === 0`, igual
   * que antes. El resumen simple + el detalle técnico completo van juntos
   * en el `title` del ícono (tooltip nativo), nunca como texto en pantalla.
   */
  diagnostic?: { count: number; summary: string; detail: string };
}) {
  const rowsTotalCount = rows.reduce((sum, r) => sum + r.closedCount, 0);
  const rowsTotalAmount = rows.reduce((sum, r) => sum + r.totalAmount, 0);
  const maxRowClosedCount = Math.max(0, ...rows.map((r) => r.closedCount));

  if (process.env.NODE_ENV !== 'production' && rowsTotalCount !== totalCount) {
    console.warn(`[TabAnalytics] ${title}: rowsTotalCount (${rowsTotalCount}) no coincide con totalCount (${totalCount})`);
  }

  return (
    <div className="tbl-card">
      <div className="tbl-card__head">
        <span className="tbl-card__title">
          {title} ({fmtInt(rowsTotalCount)})
        </span>
        {diagnostic && diagnostic.count > 0 && (
          <span
            title={`${diagnostic.summary}\n${diagnostic.detail}`}
            style={{ marginLeft: '6px', color: 'var(--amber-700)', cursor: 'help', display: 'inline-flex', verticalAlign: 'middle' }}
          >
            <AlertTriangleIcon size={14} />
          </span>
        )}
      </div>
      <div className="tbl-scroll">
        <table className="piv">
          <colgroup>
            <col style={{ width: '34%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr className="mo-row">
              <th className="lbl">{columnLabel}</th>
              <th>Closed</th>
              <th>Total Amount</th>
              <th>Avg Amount</th>
              <th>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className={'metric' + (onRowClick ? ' metric--drill' : '')}
                key={row.key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                <td className="lbl" style={{ textAlign: 'left' }} title={row.label}>
                  {row.label}
                </td>
                {/* Etapa AJUSTES-ANALYTICS-1, punto 2: la barra vivía en la columna del NOMBRE -- se mueve a Closed, la columna que en realidad describe. */}
                <td className="val" style={rankBarStyle(row.closedCount, maxRowClosedCount)}>
                  {fmtInt(row.closedCount)}
                </td>
                <td className="val">{fmtAmount(row.totalAmount)}</td>
                <td className="val">{fmtAmount(Math.round(row.avgAmount))}</td>
                <td className="val">{fmtPercent(row.percentOfTotal)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="lbl" style={{ color: 'var(--slate-500)', fontWeight: 500 }} colSpan={5}>
                  No funded loans in this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="grp total">
                <td className="lbl">Total</td>
                <td className="val">{fmtInt(rowsTotalCount)}</td>
                <td className="val">{fmtAmount(rowsTotalAmount)}</td>
                <td className="val">—</td>
                <td className="val">100.0%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/**
 * Nota de diagnóstico -- Etapa F7, Parte 7 (silencio si `count === 0`,
 * usado por los 3 scorecards). `summary` es un resumen corto en lenguaje
 * simple (sin nombres de tabla/jerga técnica) y el detalle completo
 * (nombres de tabla, desglose exacto) va SOLO en `title` -- tooltip nativo
 * del navegador al pasar el mouse, nunca texto plano permanente en
 * pantalla.
 *
 * Etapa F7, Parte 8: reusado tal cual (mismo componente, sin lógica
 * nueva) para las 3 notas de Rankings/Scorecards/Monthly Trends que eran
 * texto de implementación filtrado a la UI -- ahí `count={1}` a propósito
 * (esas notas no son condicionales, siempre hay algo breve que mostrar;
 * `count` solo existe para el chequeo `=== 0` de los scorecards, así que
 * cualquier valor no-cero cumple lo mismo).
 */
function DiagnosticsNote({ count, summary, detail }: { count: number; summary: string; detail: string }) {
  if (count === 0) return null;
  return (
    <p
      className="foot-note"
      style={{ marginBottom: '12px', display: 'inline-block', cursor: 'help', borderBottom: '1px dotted var(--slate-400)' }}
      title={detail}
    >
      {summary}
    </p>
  );
}

/**
 * Reconciliación explícita para los scorecards de persona (Loan Officer /
 * Business Developer): a diferencia de Branch (donde todo loan tiene
 * branch), un loan puede quedar fuera de la tabla por 3 motivos distintos
 * -- se listan los 3, con su propio conteo, para que
 * `resolved + blank + excluded + unmapped === totalInput` sea verificable
 * (el `console.warn` de red de seguridad sigue exactamente igual, solo el
 * texto visible cambió).
 */
/**
 * Redacción del diagnóstico "excluded" -- Etapa F7, Parte 19. Antes decía
 * "known non-person entry/entries" (describe el MECANISMO --
 * `org.source_name_excluded` -- no el significado). Es engañoso: la
 * propia documentación de `buildExcludedIndex()`
 * (`lib/business-plan/aliasIndex.ts`) dice que la mayoría de esos 36
 * nombres NO son cuentas de sistema, son personas reales que no
 * pertenecen a la división ("no son LOs de la división") -- el caso real
 * ya confirmado, Anthony Ditoma, es exactamente eso, no un dato mal
 * capturado. La redacción nueva no asume el motivo (podría ser otra
 * división HOY, una cuenta de sistema MAÑANA) -- "outside this
 * scorecard's roster" cubre ambos sin necesitar distinguirlos en el
 * texto visible, y sin nombrar `org.source_name_excluded` en ningún
 * lado. No se trae un motivo/`reason` al tooltip: `source_name_excluded`
 * no tiene ese campo modelado hoy en ningún lado del código
 * (`useOrgRoster.ts` solo trae `source_system, name_raw`;
 * `buildExcludedIndex()` solo recibe esos dos) -- agregarlo requeriría
 * tocar `useOrgRoster.ts` y `lib/business-plan/aliasIndex.ts` (este
 * último, compartido con Business Plan, deliberadamente sin cambios
 * desde la Parte 2), los dos fuera del alcance de esta etapa. Queda
 * anotado como mejora futura posible, no bloqueante.
 */
/**
 * Etapa F7.22: detecta U+FFFD ("�") en un nombre crudo -- confirmado
 * leyendo los BYTES crudos (sin ningún parseo nuestro) de exports CSV
 * reales de Salesforce que el dato ya llega roto en el archivo ANTES de
 * que este código lo lea (ej. "Javier Peñaloza" -> "Javier Pe<U+FFFD>aloza"
 * ya en el CSV de origen). Confirmado que NO es un bug de este parser: un
 * export XLSX de la misma fecha, con los mismos nombres, se lee limpio
 * (XLSX guarda texto en XML UTF-8; el problema es específico de cómo
 * Salesforce genera el CSV). U+FFFD significa "byte no decodificable" --
 * el carácter original ya se perdió de forma irrecuperable, no hay letra
 * correcta que reponer. Por eso esto NUNCA reemplaza el carácter a mano,
 * solo avisa para que se sepa que el nombre llegó dañado desde el origen.
 */
function hasDamagedEncoding(nameRaw: string): boolean {
  return nameRaw.includes('�');
}

function personDiagnosticsNote(result: PersonScorecardResult): { count: number; summary: string; detail: string } {
  const { totalInput, resolvedCount, blankCount, excludedCount, unmappedCount, unmappedNames } = result.diagnostics;
  const accounted = resolvedCount + blankCount + excludedCount + unmappedCount;
  if (process.env.NODE_ENV !== 'production' && accounted !== totalInput) {
    console.warn(`[TabAnalytics] reconciliación de persona no cuadra: resolved+blank+excluded+unmapped=${accounted}, totalInput=${totalInput}`);
  }
  const problemCount = blankCount + excludedCount + unmappedCount;

  const parts: string[] = [];
  if (unmappedCount > 0) parts.push(`${fmtInt(unmappedCount)} unrecognized name${unmappedCount === 1 ? '' : 's'}`);
  if (excludedCount > 0) parts.push(`${fmtInt(excludedCount)} outside this scorecard's roster`);
  if (blankCount > 0) parts.push(`${fmtInt(blankCount)} with no name recorded`);

  /* Caso puro (solo excluidos, sin no-reconocidos ni vacíos): frase dedicada, mismo tono del ejemplo pedido -- para el resto, la frase general de siempre, solo con la parte "excluded" reformulada. */
  const onlyExcluded = excludedCount === problemCount && excludedCount > 0;
  const summary = onlyExcluded
    ? `${fmtInt(excludedCount)} loan${excludedCount === 1 ? "'s owner is" : "s' owners are"} outside this scorecard's roster`
    : `${fmtInt(problemCount)} of ${fmtInt(totalInput)} loan${totalInput === 1 ? '' : 's'} could not be matched to a person (${parts.join(', ')})`;

  const detailParts: string[] = [`${fmtInt(resolvedCount)} loan${resolvedCount === 1 ? '' : 's'} resolved to a person via the company roster.`];
  if (excludedCount > 0) {
    detailParts.push(
      `${fmtInt(excludedCount)} loan${excludedCount === 1 ? ' belongs' : 's belong'} to someone not part of this division's roster -- their production is included in the totals above, but they don't get their own row in this breakdown.`
    );
  }
  if (unmappedCount > 0) {
    detailParts.push(
      `${fmtInt(unmappedCount)} with a name not yet recognized: ${unmappedNames
        .map((u) => `${u.nameRaw}${hasDamagedEncoding(u.nameRaw) ? ' [damaged in Salesforce export -- character lost at the source, not a parsing error]' : ''} (${u.rows})`)
        .join(', ')}.`
    );
  }
  if (blankCount > 0) {
    detailParts.push(`${fmtInt(blankCount)} with no Loan Officer/Owner value recorded.`);
  }
  const detail = detailParts.join('\n');

  return { count: problemCount, summary, detail };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Espacio reservado arriba de la barra más alta para su etiqueta de valor -- ver SimpleMonthlyChart. */
const CHART_LABEL_RESERVE = 18;

/** 'YYYY-MM' -> 'Jan' -- sin construir ningún Date, mismo criterio que trends.ts (slice, no parseo de fecha). */
function shortMonth(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH_SHORT[m - 1];
}

/*
 * Etapa AJUSTES-ANALYTICS-1, punto 4 -- antes esta paleta mezclaba 2 colores
 * de marca (navy, sky) con 3 colores SEMÁNTICOS de estado (emerald-700,
 * amber-500, rose-700 -- reservados en el resto de la app para
 * positivo/advertencia/negativo, ver el header de tokens.css). Un tipo de
 * préstamo cualquiera cayendo en rose-700 se lee como "en riesgo" sin
 * serlo -- no es solo un problema estético.
 *
 * Confirmado contra el header de tokens.css (no asumido): los ÚNICOS 4
 * colores "oficiales" de marca HomeSí son 'Enriching Skies' (--navy,
 * #001A40), 'Warm Embrace' (--coral, #FF4040), 'Light Sky' (--sky,
 * #A6DEFF) y 'New Day' (--canvas, #FCFCFA) -- este último es el fondo del
 * canvas global, ilegible como relleno de segmento sólido, así que la
 * paleta categórica queda en los otros 3 (navy oscuro + coral/rojo, como
 * pide el punto 4, más sky). Menos colores que antes (3, no 5): si un
 * período trae más de 3 Loan Type reales, cicla por `idx % length` (mismo
 * mecanismo que ya tenía `colorForType`, sin cambios ahí) -- se documenta
 * la repetición en vez de inventar una 4ta marca que no es de marca.
 * "Sin tipo" sigue en slate (placeholder, nunca un color "real"), sin
 * cambios.
 */
const TYPE_COLORS = ['var(--navy)', 'var(--coral)', 'var(--sky)'];
const NO_TYPE_COLOR = 'var(--slate-400)';
const NO_TYPE_LABEL = 'Sin tipo';

/** Texto de la etiqueta dentro de cada segmento -- claro sobre navy/coral (oscuros/saturados), oscuro sobre sky (claro). Mismo orden que TYPE_COLORS. */
const TYPE_TEXT_COLORS = ['var(--canvas)', 'var(--canvas)', 'var(--navy)'];
const NO_TYPE_TEXT_COLOR = 'var(--navy)';

/**
 * Alto mínimo (px) para que la etiqueta de un segmento entre sin salirse --
 * fuente de 8.5px + line-height 1 caben con margen en 16px. Por debajo de
 * esto (típico de VA, 1-3 de ~40 cierres/mes) se omite la etiqueta y el
 * dato sigue disponible solo por tooltip -- mismo criterio que ya se aplicó
 * para el overflow de Closings/Amount, ahora a nivel de un segmento
 * individual en vez del chart completo.
 */
const MIN_SEGMENT_LABEL_HEIGHT = 16;

/**
 * Alto mínimo VISUAL (px) para que un segmento se distinga del `box-shadow`
 * inset de 1px que separa segmentos contiguos (`.trend-seg`, ver CSS) --
 * confirmado con captura real que un segmento de ~2.3px (VA en enero/marzo,
 * 1 de ~40 cierres) queda consumido casi por completo por ese contorno de
 * 1px arriba + 1px abajo, sin franja de color perceptible. 5px deja
 * siempre >= 3px de color real visible incluso con el contorno.
 */
const MIN_SEGMENT_HEIGHT_PX = 5;

/**
 * Reparte el alto (px) de la barra apilada entre sus tipos: al que le toque
 * menos de MIN_SEGMENT_HEIGHT_PX por su proporción real se le da ese piso
 * visual, y a los demás (por encima del piso) se les recorta
 * proporcionalmente lo necesario para que la suma siga dando exactamente
 * `stackPx` -- ningún segmento se pisa con su vecino, la barra entera sigue
 * sumando el 100% del stack. En julio (VA ya por encima del piso de forma
 * natural) esto no cambia nada frente al cálculo anterior.
 */
function allocateSegmentHeights(byType: { count: number }[], stackPx: number, minPx: number): number[] {
  const total = byType.reduce((sum, t) => sum + t.count, 0);
  if (total <= 0) return byType.map(() => 0);
  const natural = byType.map((t) => (t.count / total) * stackPx);
  const belowFloor = natural.map((h) => h > 0 && h < minPx);
  const reserved = Math.min(stackPx, belowFloor.filter(Boolean).length * minPx);
  const aboveWeight = byType.reduce((sum, t, i) => sum + (belowFloor[i] ? 0 : t.count), 0);
  const remaining = stackPx - reserved;
  return byType.map((t, i) => {
    if (natural[i] === 0) return 0;
    if (belowFloor[i]) return minPx;
    return aboveWeight > 0 ? (t.count / aboveWeight) * remaining : natural[i];
  });
}

function colorForType(label: string, orderedLabels: string[]): string {
  if (label === NO_TYPE_LABEL) return NO_TYPE_COLOR;
  const idx = orderedLabels.filter((l) => l !== NO_TYPE_LABEL).indexOf(label);
  return TYPE_COLORS[idx % TYPE_COLORS.length];
}

function textColorForType(label: string, orderedLabels: string[]): string {
  if (label === NO_TYPE_LABEL) return NO_TYPE_TEXT_COLOR;
  const idx = orderedLabels.filter((l) => l !== NO_TYPE_LABEL).indexOf(label);
  return TYPE_TEXT_COLORS[idx % TYPE_TEXT_COLORS.length];
}

/**
 * Barras mensuales simples (cierres o monto) -- las 12 del año en curso,
 * siempre las 12, con valor 0 explícito donde no hay datos (nunca se omite
 * un mes en silencio). El mes que cae dentro del período seleccionado en el
 * selector de arriba se resalta (`.trend-chart__col--highlight`) -- no
 * reemplaza la serie completa, la resalta dentro de ella.
 */
function SimpleMonthlyChart({
  totals,
  highlightMonths,
  getValue,
  formatValue,
  formatLabel = formatValue,
  height = 110,
  onBarClick,
}: {
  totals: MonthlyTotal[];
  highlightMonths: Set<string>;
  getValue: (t: MonthlyTotal) => number;
  formatValue: (n: number) => string;
  /** Texto corto sobre la barra, si difiere del formato completo (que siempre va en el tooltip). */
  formatLabel?: (n: number) => string;
  height?: number;
  /** Etapa AJUSTES-ANALYTICS-1, punto 6a: drill-down por mes -- antes este chart no tenía ninguno. Sin handler (Avg Ticket sigue sin pasar uno propio en un caso, ver más abajo), sin cambio de comportamiento. */
  onBarClick?: (month: string) => void;
}) {
  const max = Math.max(1, ...totals.map(getValue));
  return (
    <div className="trend-chart">
      {/* El plot reserva CHART_LABEL_RESERVE px por encima de `height` -- si no, la
          etiqueta de valor de la barra más alta se sale por arriba del contenedor
          (align-items: flex-end solo garantiza que la barra en sí no se salga). */}
      <div className="trend-chart__plot" style={{ height: height + CHART_LABEL_RESERVE + 'px' }}>
        {totals.map((t, i) => {
          const value = getValue(t);
          const isHighlighted = highlightMonths.has(t.month);
          return (
            <div
              key={t.month}
              className={'trend-chart__col' + (isHighlighted ? ' trend-chart__col--highlight' : '')}
              style={{ ['--bar-i' as string]: i }}
            >
              <div className="trend-chart__value">{value > 0 ? formatLabel(value) : ''}</div>
              <div
                className="trend-chart__bar"
                style={{ height: Math.max(1, (value / max) * height) + 'px', cursor: onBarClick ? 'pointer' : undefined }}
                title={`${shortMonth(t.month)} ${t.month.slice(0, 4)}: ${formatValue(value)}${value === 0 ? ' (no data yet)' : ''}`}
                onClick={onBarClick ? () => onBarClick(t.month) : undefined}
              />
            </div>
          );
        })}
      </div>
      <div className="trend-chart__axis">
        {totals.map((t) => (
          <div key={t.month} className="trend-chart__tick">
            {shortMonth(t.month)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barra apilada por Loan Type, mismas 12 columnas -- un mes sin loans queda con la columna vacía (altura 0), nunca ausente del eje. */
function TypeBreakdownChart({
  breakdown,
  highlightMonths,
  height = 130,
  onSegmentClick,
}: {
  breakdown: MonthlyTypeBreakdown[];
  highlightMonths: Set<string>;
  height?: number;
  /** Etapa AJUSTES-ANALYTICS-1, punto 6a: drill-down por segmento (mes + tipo) -- antes este chart no tenía ninguno. */
  onSegmentClick?: (month: string, typeLabel: string) => void;
}) {
  const monthlyTotals = breakdown.map((m) => m.byType.reduce((sum, t) => sum + t.count, 0));
  const max = Math.max(1, ...monthlyTotals);
  const allLabels = [...new Set(breakdown.flatMap((m) => m.byType.map((t) => t.label)))];

  return (
    <div className="trend-chart">
      <div className="trend-chart__plot" style={{ height: height + 'px' }}>
        {breakdown.map((m, i) => {
          const total = monthlyTotals[i];
          const isHighlighted = highlightMonths.has(m.month);
          const stackPx = Math.max(1, (total / max) * height);
          return (
            <div
              key={m.month}
              className={'trend-chart__col' + (isHighlighted ? ' trend-chart__col--highlight' : '')}
              style={{ ['--bar-i' as string]: i }}
            >
              {/* Sin número total visible -- Closings by Month ya lo muestra; acá solo el desglose por tipo (tooltip por segmento). */}
              <div
                className="trend-chart__stack"
                style={{ display: 'flex', flexDirection: 'column-reverse', width: '100%', height: stackPx + 'px' }}
              >
                {(() => {
                  const segHeights = allocateSegmentHeights(m.byType, stackPx, MIN_SEGMENT_HEIGHT_PX);
                  return m.byType.map((t, ti) => {
                    const segPx = segHeights[ti];
                    return (
                      <div
                        key={t.label}
                        className="trend-seg"
                        style={{
                          height: segPx + 'px',
                          background: colorForType(t.label, allLabels),
                          cursor: onSegmentClick ? 'pointer' : undefined,
                        }}
                        title={`${t.label}: ${fmtInt(t.count)}`}
                        onClick={onSegmentClick ? () => onSegmentClick(m.month, t.label) : undefined}
                      >
                        {segPx >= MIN_SEGMENT_LABEL_HEIGHT && (
                          <span className="trend-seg__label" style={{ color: textColorForType(t.label, allLabels) }}>
                            {fmtInt(t.count)}
                          </span>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          );
        })}
      </div>
      <div className="trend-chart__axis">
        {breakdown.map((m) => (
          <div key={m.month} className="trend-chart__tick">
            {shortMonth(m.month)}
          </div>
        ))}
      </div>
      <div className="trend-legend">
        {allLabels.map((label) => (
          <span key={label}>
            <i className="trend-legend__dot" style={{ background: colorForType(label, allLabels) }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Ticket promedio mensual -- Etapa F7, Parte 15. Línea simple, no barras:
 * es una sola serie continua (a diferencia de Closings/Amount, que son
 * conteo/monto discretos por mes) -- mismo criterio ya usado para la
 * curva acumulada del Pareto (Parte 11-14): SVG a mano con `<polyline>` +
 * puntos, no una librería de charts. Sigue las mismas convenciones
 * visuales que el resto de Monthly Trends (mismo `shortMonth`, mismo
 * resaltado coral del mes seleccionado, mismo patrón de tooltip "(no
 * data yet)" para meses sin datos) -- solo la marca (línea, no barra)
 * es distinta, porque la naturaleza del dato lo es.
 */
function AvgTicketChart({
  rows,
  highlightMonths,
  overallAvg,
  onPointClick,
}: {
  rows: MonthlyAvgTicket[];
  highlightMonths: Set<string>;
  /** Promedio ponderado del año completo (suma de amount / suma de count de los meses CON datos) -- no el promedio simple de los 8 promedios mensuales. */
  overallAvg: number;
  /** Etapa AJUSTES-ANALYTICS-1, punto 6a: drill-down por mes -- antes este chart no tenía ninguno. Sin efecto en meses sin datos (avgAmount === 0): no hay nada que abrir ahí. */
  onPointClick?: (month: string) => void;
}) {
  const width = 640;
  const plotHeight = 110;
  const topReserve = CHART_LABEL_RESERVE;
  /** Espacio para las etiquetas de mes ("Jan".."Dec"), ahora dentro del mismo SVG que los puntos -- ver fix de alineación más abajo. */
  const bottomReserve = 18;
  const leftPad = 8;
  const rightPad = 64;
  const innerWidth = width - leftPad - rightPad;
  const step = rows.length > 1 ? innerWidth / (rows.length - 1) : 0;

  /*
   * FIX (reportado con captura real): escala 0-based hacía que los 8
   * meses reales (todos entre ~$329K y ~$375K, una banda angosta) se
   * amontonaran en el 12% superior de los 110px del plot -- una
   * diferencia de 1-13px entre meses es indistinguible a simple vista,
   * y se leyó como "mayo/junio caen a 0" aunque los valores en sí eran
   * correctos (confirmado con los mismos números reales, ver reporte).
   * El ticket promedio no es como un conteo -- $0 acá es un centinela de
   * "sin datos", no un valor bajo real, así que forzar la escala a
   * arrancar en $0 no aporta nada y sí destruye la legibilidad.
   *
   * Fix real: los meses CON datos usan una escala acotada a su propio
   * rango (con margen), para usar el alto completo del plot -- los
   * meses SIN datos (`avgAmount === 0`) van fijos abajo del todo, fuera
   * de esa escala, como "no aplica" en vez de competir por el mismo eje
   * fino que separa $329K de $375K.
   */
  const realValues = rows.filter((r) => r.avgAmount > 0).map((r) => r.avgAmount);
  const minReal = realValues.length > 0 ? Math.min(...realValues) : 0;
  const maxReal = realValues.length > 0 ? Math.max(...realValues) : 0;
  const rawSpan = maxReal - minReal;
  const margin = rawSpan > 0 ? rawSpan * 0.15 : Math.max(1, maxReal * 0.1);
  const domainMin = Math.max(0, minReal - margin);
  const domainMax = maxReal + margin;
  const domainSpan = Math.max(1, domainMax - domainMin);

  function x(i: number): number {
    return leftPad + i * step;
  }
  function y(avg: number): number {
    if (avg <= 0) return plotHeight;
    return plotHeight - ((avg - domainMin) / domainSpan) * plotHeight;
  }

  /*
   * La línea conecta SOLO los meses con datos reales (Jan-Ago) -- nunca
   * un mes sin datos, para no dibujar una caída visual falsa desde un
   * valor real (zoom fino) hasta el "aparcado abajo" de un mes futuro,
   * que son cosas de naturaleza distinta (dato real vs. centinela de
   * "sin datos"). El índice original (`i`) se conserva para la posición
   * X real de cada mes, aunque se salteen los que no tienen dato.
   */
  const realPoints = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.avgAmount > 0);
  const linePoints = realPoints.map(({ r, i }) => `${x(i)},${y(r.avgAmount)}`).join(' ');
  const avgY = y(overallAvg);

  return (
    <div className="trend-chart">
      {/*
        FIX (puntos desalineados contra "Jan"-"Dec" reportado con captura
        real): las etiquetas del eje vivían en un `<div
        className="trend-chart__axis">` aparte, layouteado por FLEXBOX
        (`.trend-chart__tick { flex: 1 1 0 }`) -- un sistema de
        coordenadas totalmente independiente del `<svg width={640}>` de
        arriba. Aunque `x(i)` ya usaba el índice real de 0 a 11 (agosto =
        7, verificado), esa posición SOLO tiene sentido DENTRO del ancho
        fijo de 640px del SVG -- no hay ninguna garantía de que 640px
        coincida con el ancho real que el navegador le da a la fila flex
        de abajo, así que los puntos y las etiquetas terminaban en dos
        escalas horizontales distintas por construcción, sin importar
        qué tan bien calculado estuviera `x(i)`. Fix real: las etiquetas
        de mes se mueven DENTRO del mismo `<svg>`, como `<text>`
        posicionados con la misma función `x(i)` que ya usan los puntos
        -- mismo criterio que ya usa `ParetoChart` (Parte 11), que nunca
        tuvo este problema por eso mismo.
      */}
      <div style={{ overflowX: 'auto' }}>
        <svg
          width={width}
          height={topReserve + plotHeight + bottomReserve}
          viewBox={`0 0 ${width} ${topReserve + plotHeight + bottomReserve}`}
        >
          <g transform={`translate(0 ${topReserve})`}>
            {/* Promedio general del año (ponderado, solo meses con datos) -- color neutro, no coral (reservado para el mes resaltado) ni azul de la línea. */}
            {overallAvg > 0 && (
              <>
                <line x1={0} y1={avgY} x2={width} y2={avgY} stroke="var(--slate-400)" strokeDasharray="4 3" strokeWidth={1} />
                <text x={width} y={avgY - 4} textAnchor="end" fontSize="10" fill="var(--slate-500)">
                  {`Avg: ${fmtAmountShort(overallAvg)}`}
                </text>
              </>
            )}
            <polyline points={linePoints} fill="none" stroke="var(--navy)" strokeWidth={2} />
            {rows.map((r, i) => {
              const isHighlighted = highlightMonths.has(r.month);
              return (
                <g key={r.month}>
                  <circle
                    className="avgticket-dot"
                    cx={x(i)}
                    cy={y(r.avgAmount)}
                    r={isHighlighted ? 4.5 : 3}
                    fill={isHighlighted ? 'var(--coral)' : 'var(--navy)'}
                    style={onPointClick && r.avgAmount > 0 ? { cursor: 'pointer' } : undefined}
                    onClick={onPointClick && r.avgAmount > 0 ? () => onPointClick(r.month) : undefined}
                  >
                    <title>{`${shortMonth(r.month)} ${r.month.slice(0, 4)}: ${fmtAmount(r.avgAmount)}${r.avgAmount === 0 ? ' (no data yet)' : ''}`}</title>
                  </circle>
                  {r.avgAmount > 0 && (
                    <text x={x(i)} y={y(r.avgAmount) - 8} textAnchor="middle" fontSize="9" fill="var(--slate-500)">
                      {fmtAmountShort(r.avgAmount)}
                    </text>
                  )}
                  <text
                    x={x(i)}
                    y={plotHeight + 14}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight={isHighlighted ? 700 : 400}
                    fill={isHighlighted ? 'var(--navy)' : 'var(--slate-500)'}
                  >
                    {shortMonth(r.month)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * Placeholders de fila vacía -- MISMO texto que `NO_PROGRAM_LABEL`/
 * `NO_TYPE_LABEL` en `lib/pipeline/analytics.ts` (no exportados ahí, y ese
 * archivo está fuera del alcance de esta etapa). Duplicado a propósito
 * solo para poder re-derivar, en el click, qué loans cayeron en cada fila
 * del ranking -- si el texto del placeholder cambia algún día en
 * `analytics.ts`, este archivo hay que actualizarlo a mano también.
 *
 * Etapa PROPERTY-STATE-1: `NO_PROPERTY_STATE_LABEL` NO se duplica acá --
 * `lib/pipeline/analytics.ts` SÍ está en el alcance de esta etapa (a
 * diferencia de cuando se armaron estas dos), así que se exporta desde ahí
 * y se importa directo, evitando el mismo riesgo de desincronización que
 * este comentario advierte para los otros dos.
 */
const DRILLDOWN_NO_PROGRAM_LABEL = 'Sin programa';
const DRILLDOWN_NO_TYPE_LABEL = 'Sin tipo';

/**
 * ¿Este loan resuelve, vía `org.employee_alias`, al mismo `employeeKey` que
 * ya agrupó esa fila del scorecard? Nunca compara nombres crudos con
 * `===` -- misma regla dura que `buildPersonScorecard`
 * (lib/pipeline/scorecards.ts), reaplicada acá en el momento del click en
 * vez de modificar esa función para que devuelva el detalle.
 *
 * `getRawName` -- Etapa F7.20: parametrizado porque Loan Officer y Business
 * Developer ya NO resuelven el mismo campo crudo (`loanOfficer` vs
 * `opportunityOwner`, ver `buildBusinessDeveloperScorecard`) -- si este
 * drill-down siguiera hardcodeado a `loan.loanOfficer`, el click en una fila
 * de Business Developer abriría los loans de la persona equivocada.
 */
function loanResolvesToEmployeeKey(
  loan: ResolvedLoan,
  getRawName: (loan: ResolvedLoan) => string,
  aliasIndex: OrgRoster['aliasIndex'],
  employeeKeyStr: string
): boolean {
  const nameRaw = getRawName(loan).trim();
  if (!nameRaw) return false;
  const { employeeKey } = aliasIndex.lookup('salesforce', nameRaw);
  return employeeKey !== null && String(employeeKey) === employeeKeyStr;
}

/**
 * Etapa AJUSTES-ANALYTICS-1, punto 6a -- Monthly Trends (Closings/Amount/Avg
 * Ticket by Month) no tenía drill-down. Mismo criterio EXACTO que
 * `buildMonthlyTotals`/`buildMonthlyTypeBreakdown` (lib/pipeline/trends.ts):
 * `status === 'funded'` + `disbursementDate` en ese mes -- si este filtro se
 * desincronizara de esas 2 funciones, el modal mostraría una lista que no
 * coincide con el número que el chart ya mostró para ese mes.
 */
function loansForMonth(loans: ResolvedLoan[], month: string): ResolvedLoan[] {
  return loans.filter((l) => l.status === 'funded' && l.disbursementDate.slice(0, 7) === month);
}

/** Mismo criterio que `loansForMonth`, más el tipo de préstamo -- para el drill-down por segmento de Loan Type Distribution by Month. `DRILLDOWN_NO_TYPE_LABEL` ('Sin tipo') es el mismo placeholder que ya usa `buildMonthlyTypeBreakdown`. */
function loansForMonthAndType(loans: ResolvedLoan[], month: string, typeLabel: string): ResolvedLoan[] {
  return loansForMonth(loans, month).filter((l) => (l.loanType.trim() || DRILLDOWN_NO_TYPE_LABEL) === typeLabel);
}

/**
 * Etapa AJUSTES-ANALYTICS-1, punto 6a -- extrae la lógica de filtrado que
 * cada `ScorecardTable.onRowClick` (Branch/Loan Officer/Business Developer)
 * ya tenía repetida inline, porque el drill-down nuevo de `ParetoChart`
 * necesita exactamente la misma regla, aplicada a otra fuente de loans
 * (`fundedInRange` o `ytdFunded`, según el modo elegido en el chart) --
 * mismo criterio en un solo lugar, en vez de una 4ta copia divergente.
 */
function loansForScorecardCut(
  loans: ResolvedLoan[],
  cut: 'branch' | 'loanOfficer' | 'businessDeveloper',
  key: string,
  aliasIndex: OrgRoster['aliasIndex']
): ResolvedLoan[] {
  if (cut === 'branch') return loans.filter((l) => l.branch === key);
  if (cut === 'loanOfficer') {
    return loans.filter((l) => loanResolvesToEmployeeKey(l, (loan) => loan.loanOfficer, aliasIndex, key));
  }
  return loans.filter(
    (l) => l.opportunityOwnerTitle === 'Business Developer' && loanResolvesToEmployeeKey(l, (loan) => loan.opportunityOwner, aliasIndex, key)
  );
}

/**
 * Paleta fija por NOMBRE de estrategia -- a diferencia de `TYPE_COLORS`
 * (Loan Type, Parte 3), acá `Strategy` es un enum cerrado de 5 valores
 * (`lib/pipeline/strategy.ts`), así que se puede mapear cada nombre a un
 * color fijo en vez de ciclar por orden de aparición -- no depende de qué
 * estrategia aparece primero en los datos del período, siempre el mismo
 * color para la misma estrategia. No existía ninguna paleta previa para
 * estas 5 categorías en ningún otro lado de Forecast (la vista "By
 * strategy" de PivotTable.tsx no colorea por estrategia, solo texto plano
 * + un pill neutro de filtro) -- se define acá, con tokens existentes.
 */
const STRATEGY_COLORS: Record<Strategy, string> = {
  'Own production': 'var(--navy)',
  B2B: 'var(--emerald-700)',
  Affinity: 'var(--sky)',
  Recruitment: 'var(--amber-500)',
  NPPM: 'var(--rose-700)',
};

/**
 * Dona SVG a mano -- cada segmento es un `<path>` de arco (`M`/`A`),
 * ángulo calculado directo por trigonometría (`sin`/`cos`), no
 * `stroke-dasharray`/`stroke-dashoffset`: ese enfoque (usado en la
 * primera versión de este componente) depende de una convención de
 * dirección/punto de inicio de `<circle>` que resultó ambigua en la
 * práctica -- el orden visual no coincidía con el de la leyenda. Con
 * ángulo explícito (0 = 12 en punto, crece en sentido horario -- fórmula
 * verificable a mano: `x = cx + r·sin(θ), y = cy − r·cos(θ)`) no hay
 * ambigüedad posible. Sigue siendo SVG a mano, sin librería de charts.
 * Centro con el total en texto grande. Segmentos y filas de leyenda son
 * clickeables si se pasa `onSegmentClick` (drill-down, opcional).
 */
function StrategyDonutChart({
  rows,
  onSegmentClick,
}: {
  rows: StrategyMixRow[];
  onSegmentClick?: (row: StrategyMixRow) => void;
}) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  /** Punto sobre el círculo para el ángulo dado (radianes, 0 = 12 en punto, crece horario). */
  function pointAt(angle: number): { x: number; y: number } {
    return { x: cx + radius * Math.sin(angle), y: cy - radius * Math.cos(angle) };
  }

  const nonZeroRows = rows.filter((r) => r.count > 0);
  const segments = nonZeroRows.map((r, i) => {
    const countBefore = nonZeroRows.slice(0, i).reduce((sum, x) => sum + x.count, 0);
    const startAngle = (countBefore / total) * 2 * Math.PI;
    const endAngle = ((countBefore + r.count) / total) * 2 * Math.PI;
    return { row: r, startAngle, endAngle };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Strategy mix">
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--slate-200)" strokeWidth={strokeWidth} />
        ) : segments.length === 1 ? (
          // Una sola estrategia con el 100% del período: un arco no puede cerrar 360°, se dibuja como anillo completo.
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={STRATEGY_COLORS[segments[0].row.strategy]}
            strokeWidth={strokeWidth}
            style={onSegmentClick ? { cursor: 'pointer' } : undefined}
            onClick={onSegmentClick ? () => onSegmentClick(segments[0].row) : undefined}
          >
            <title>{`${segments[0].row.strategy}: ${fmtInt(segments[0].row.count)} (${fmtPercent(segments[0].row.percent)})`}</title>
          </circle>
        ) : (
          segments.map(({ row, startAngle, endAngle }) => {
            const start = pointAt(startAngle);
            const end = pointAt(endAngle);
            const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
            return (
              <path
                key={row.strategy}
                d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`}
                fill="none"
                stroke={STRATEGY_COLORS[row.strategy]}
                strokeWidth={strokeWidth}
                style={onSegmentClick ? { cursor: 'pointer' } : undefined}
                onClick={onSegmentClick ? () => onSegmentClick(row) : undefined}
              >
                <title>{`${row.strategy}: ${fmtInt(row.count)} (${fmtPercent(row.percent)})`}</title>
              </path>
            );
          })
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="28" fontWeight={700} fill="var(--navy)">
          {fmtInt(total)}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" fill="var(--slate-500)">
          {total === 1 ? 'loan' : 'loans'}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '200px' }}>
        {rows.map((row) => (
          <div
            key={row.strategy}
            onClick={onSegmentClick && row.count > 0 ? () => onSegmentClick(row) : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              color: row.count > 0 ? 'var(--slate-800)' : 'var(--slate-400)',
              cursor: onSegmentClick && row.count > 0 ? 'pointer' : undefined,
            }}
          >
            <i
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: STRATEGY_COLORS[row.strategy],
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>{row.strategy}</span>
            <span style={{ fontWeight: 600 }}>{fmtInt(row.count)}</span>
            {/*
              % con menos peso visual que el conteo -- más chico y atenuado
              (opacity, no un color fijo) para que no compita con el número
              real y siga viéndose más tenue todavía si la fila entera ya
              está atenuada por count === 0 (arriba).
            */}
            <span style={{ fontSize: '11px', opacity: 0.65 }}>{fmtPercent(row.percent)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Solo las primeras N categorías llevan nombre en el eje X y número
 * sobre la barra -- de ahí en más, sin etiqueta (el detalle sigue
 * disponible por tooltip en cualquier barra). Ajuste posterior: la
 * versión anterior mostraba una etiqueta cada 4 más allá de las
 * primeras 8 -- se quitó esa parte a pedido explícito, deja el eje
 * limpio en vez de una etiqueta suelta cada tanto.
 *
 * Etapa AJUSTES-ANALYTICS-1, punto 7: el corte fijo en 8 aplicaba SIEMPRE,
 * sin importar el total -- con 13 categorías reales (caso reportado,
 * Selected period), las últimas 5 quedaban sin ningún nombre visible aunque
 * 13 entra perfectamente en el eje sin amontonarse. `PARETO_SHOW_ALL_MAX`
 * es el techo bajo el cual mostrar TODAS los nombres en vez de recortar --
 * el recorte a `PARETO_ALWAYS_LABELED` sigue existiendo, pero solo entra en
 * juego con muchas categorías de verdad (YTD con 30+ Loan Officers reales).
 */
const PARETO_ALWAYS_LABELED = 8;
const PARETO_SHOW_ALL_MAX = 15;

function paretoShouldLabel(i: number, total: number): boolean {
  if (total <= PARETO_SHOW_ALL_MAX) return true;
  return i < PARETO_ALWAYS_LABELED;
}

/**
 * Tooltip enriquecido -- no existe ningún componente de hover-card/popover
 * en el resto de la app (revisado: `title` nativo con `\n` es el único
 * patrón real, ej. `formatCtcClosingTooltip` en PivotTable.tsx, o el
 * `detail` de `DiagnosticsNote`) -- se sigue ese mismo criterio acá, con
 * más contenido: nombre completo, conteo + % individual, % acumulado, y
 * posición en el ranking.
 */
function paretoTooltip(r: ParetoRow, rank: number, totalCategories: number): string {
  return [
    r.label,
    `${fmtInt(r.count)} loans (${fmtPercent(r.percent)} of total)`,
    `${fmtPercent(r.cumulativePercent)} cumulative`,
    `#${rank} of ${totalCategories}`,
  ].join('\n');
}

/**
 * Pareto por Branch/Loan Officer -- Etapa F7, Parte 11. Primera vez en el
 * proyecto combinando dos tipos de marca en un mismo SVG a mano: barras
 * (conteo, eje izquierdo/altura) + línea de % acumulado (eje 0-100%,
 * superpuesto a la misma altura del plot -- mismo criterio que un combo
 * chart estándar, sin librería). Toggle de modo (período seleccionado /
 * YTD) y de corte (Branch / Loan Officer) son estado LOCAL de este
 * componente -- `data` ya trae las 4 combinaciones precomputadas por el
 * padre, así que cambiar cualquiera de los dos toggles es una re-render
 * puramente local, sin recalcular nada ni tocar el resto de la pestaña.
 *
 * Con muchas categorías (Loan Officer en YTD puede traer 30+ nombres
 * reales), mostrar TODAS las etiquetas las vuelve ilegibles y ocultarlas
 * TODAS obliga a adivinar -- las primeras `PARETO_ALWAYS_LABELED` llevan
 * etiqueta + número sobre la barra (`paretoShouldLabel`); de ahí en más,
 * sin etiqueta de nombre en el eje (ajuste explícito: no "una cada 4",
 * eje limpio en vez de una etiqueta suelta cada tanto). Ninguna
 * categoría se omite del chart en sí -- todas tienen su barra y su
 * punto, con el detalle completo siempre disponible por tooltip.
 */
/** Etapa BI-REDESIGN-2, punto 3: se agrega Business Developer como 3er corte -- mismas 2 dimensiones (period/ytd) que ya tenían branch/loanOfficer, sin cálculo nuevo (ver `buildParetoRows` en TabAnalytics, llamado con `businessDeveloperScorecard.rows`). */
interface ParetoDataByCut {
  branch: ParetoRow[];
  loanOfficer: ParetoRow[];
  businessDeveloper: ParetoRow[];
}

function ParetoChart({
  data,
  onBarClick,
}: {
  data: { period: ParetoDataByCut; ytd: ParetoDataByCut };
  /**
   * Etapa AJUSTES-ANALYTICS-1, punto 6a: drill-down de las barras -- antes
   * este chart no tenía ninguno, a diferencia de los rankings/scorecards
   * de arriba. `cut`/`mode` van en la firma porque son estado LOCAL de
   * este componente (ver `useState` abajo) -- el padre no los conoce, así
   * que no puede decidir qué filtro aplicar sin que se los pasemos junto
   * con la fila clickeada.
   */
  onBarClick?: (row: ParetoRow, cut: 'branch' | 'loanOfficer' | 'businessDeveloper', mode: 'period' | 'ytd') => void;
}) {
  const [mode, setMode] = useState<'period' | 'ytd'>('period');
  const [cut, setCut] = useState<'branch' | 'loanOfficer' | 'businessDeveloper'>('branch');
  const rows = data[mode][cut];

  const plotHeight = 160;
  const topReserve = 16;
  const barWidth = 26;
  const gap = 10;
  /*
   * FIX (captura real): con `leftPad` chico, la etiqueta rotada -45° de
   * la PRIMERA barra (`textAnchor="end"`, ancla en `xCenter(0)`) se
   * extiende hacia la izquierda del ancla y termina cortada contra el
   * borde del `<svg>` (x=0) -- nombres largos ("Nathan Martinez", "Jose
   * L Moreyra Barco") empeoran el corte. 75px deja margen real (~17px de
   * sobra contra el nombre más largo esperado, "Jose L Moreyra Barco",
   * ~71px de extensión horizontal rotado) sin recortarse.
   */
  const leftPad = 75;
  const labelSpace = 70;
  const plotWidth = Math.max(rows.length * (barWidth + gap) + leftPad, 200);
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  function xCenter(i: number): number {
    return leftPad + i * (barWidth + gap) + barWidth / 2;
  }
  function yForCount(count: number): number {
    return plotHeight - (count / maxCount) * plotHeight;
  }
  function yForPercent(pct: number): number {
    return plotHeight - (pct / 100) * plotHeight;
  }

  const linePoints = rows.map((r, i) => `${xCenter(i)},${yForPercent(r.cumulativePercent)}`).join(' ');
  const eightyY = yForPercent(80);
  /** Primera categoría cuyo % acumulado ya llega a 80% -- el "cruce" real, no un punto adivinado visualmente. */
  const crossIndex = rows.findIndex((r) => r.cumulativePercent >= 80);
  const cutNoun = cut === 'branch' ? 'branch' : cut === 'loanOfficer' ? 'loan officer' : 'business developer';

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div className="seg">
          <button type="button" className={mode === 'period' ? 'on' : ''} onClick={() => setMode('period')}>
            Selected period
          </button>
          <button type="button" className={mode === 'ytd' ? 'on' : ''} onClick={() => setMode('ytd')}>
            Year to date
          </button>
        </div>
        <div className="seg">
          <button type="button" className={cut === 'branch' ? 'on' : ''} onClick={() => setCut('branch')}>
            Branch
          </button>
          <button type="button" className={cut === 'loanOfficer' ? 'on' : ''} onClick={() => setCut('loanOfficer')}>
            Loan Officer
          </button>
          <button type="button" className={cut === 'businessDeveloper' ? 'on' : ''} onClick={() => setCut('businessDeveloper')}>
            Business Developer
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="foot-note">No funded loans in this range.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg
            width={plotWidth}
            height={topReserve + plotHeight + labelSpace + 12}
            viewBox={`0 0 ${plotWidth} ${topReserve + plotHeight + labelSpace + 12}`}
          >
            <g transform={`translate(0 ${topReserve})`}>
              <line x1={0} y1={eightyY} x2={plotWidth} y2={eightyY} stroke="var(--slate-300)" strokeDasharray="4 3" strokeWidth={1} />
              <text x={plotWidth} y={eightyY - 4} textAnchor="end" fontSize="10" fill="var(--slate-500)">
                80%
              </text>
              {rows.map((r, i) => (
                <rect
                  key={r.label}
                  className="pareto-bar"
                  x={xCenter(i) - barWidth / 2}
                  y={yForCount(r.count)}
                  width={barWidth}
                  height={plotHeight - yForCount(r.count)}
                  fill="var(--navy)"
                  style={onBarClick ? { cursor: 'pointer' } : undefined}
                  onClick={onBarClick ? () => onBarClick(r, cut, mode) : undefined}
                >
                  <title>{paretoTooltip(r, i + 1, rows.length)}</title>
                </rect>
              ))}
              {/* Número sobre la barra -- mismo patrón que Closings by Month -- solo donde hay espacio real (primeras N, ver paretoShouldLabel). */}
              {rows.map(
                (r, i) =>
                  paretoShouldLabel(i, rows.length) && (
                    <text
                      key={r.label + '-val'}
                      x={xCenter(i)}
                      y={yForCount(r.count) - 4}
                      textAnchor="middle"
                      fontSize="9"
                      fill="var(--slate-500)"
                    >
                      {fmtInt(r.count)}
                    </text>
                  )
              )}
              {rows.map(
                (r, i) =>
                  paretoShouldLabel(i, rows.length) && (
                    <text
                      key={r.label + '-lbl'}
                      x={xCenter(i)}
                      y={plotHeight + 14}
                      textAnchor="end"
                      fontSize="9"
                      fill="var(--slate-500)"
                      transform={`rotate(-45 ${xCenter(i)} ${plotHeight + 14})`}
                    >
                      {r.label}
                    </text>
                  )
              )}
              {/*
                Curva acumulada: `--sky` (no `--rose-700`/rojo -- ese
                color ya significa "atención/advertencia" en el resto de
                la app, ej. AlertTriangleIcon de los scorecards). `--sky`
                distingue la línea de las barras (`--navy`) sin salir de
                la paleta azul de marca. Línea de referencia del 80% ya
                estaba en `--slate-300` (neutro) -- sin cambios ahí.
              */}
              <polyline points={linePoints} fill="none" stroke="var(--sky)" strokeWidth={2} />
              {rows.map((r, i) => (
                <circle
                  key={r.label + '-pt'}
                  className="pareto-dot"
                  cx={xCenter(i)}
                  cy={yForPercent(r.cumulativePercent)}
                  r={3}
                  fill="var(--sky)"
                >
                  <title>{paretoTooltip(r, i + 1, rows.length)}</title>
                </circle>
              ))}
              {/*
                Marca del cruce real de 80%: `--navy` (mismo tono que las
                barras, más oscuro que `--sky` de la línea -- un tono
                distinto DENTRO de la misma paleta azul, no un color
                nuevo) con contorno claro para que resalte sobre los
                puntos normales, más etiqueta corta.
              */}
              {crossIndex >= 0 && (
                <g>
                  <circle
                    cx={xCenter(crossIndex)}
                    cy={yForPercent(rows[crossIndex].cumulativePercent)}
                    r={5.5}
                    fill="var(--navy)"
                    stroke="var(--canvas)"
                    strokeWidth={2}
                  >
                    <title>{paretoTooltip(rows[crossIndex], crossIndex + 1, rows.length)}</title>
                  </circle>
                  <text
                    x={xCenter(crossIndex)}
                    y={yForPercent(rows[crossIndex].cumulativePercent) - 10}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight={700}
                    fill="var(--navy)"
                  >
                    {`${crossIndex + 1} ${cutNoun}${crossIndex + 1 === 1 ? '' : 's'} → 80%`}
                  </text>
                </g>
              )}
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}

/**
 * ============================================================================
 * CAPA 1 — HERO KPI HEADER, Etapa BI-REDESIGN-1, corregida en BI-REDESIGN-2
 * ============================================================================
 *
 * Rediseño de Isa: reorganiza la pestaña en 4 capas narrativas, sin tocar
 * ninguna regla de cálculo existente ni agregar filtros globales nuevos
 * (decidido explícitamente fuera de esta etapa). Esta sección es la única
 * pieza de cálculo genuinamente nueva -- el resto de la etapa reordena
 * charts/tablas ya construidos.
 *
 * ⚠ BUG REAL DE BI-REDESIGN-1, corregido acá: el delta comparaba el período
 * actual (que en un mes/trimestre EN CURSO sólo tiene datos hasta hoy --
 * ningún loan puede tener disbursementDate en el futuro) contra el período
 * anterior COMPLETO (los 31/30/28 días enteros) -- agosto-hasta-el-26
 * contra julio completo, peras contra manzanas, que mostraba una caída
 * artificial mientras el mes seguía en curso, sin importar el ritmo real.
 * YTD ya comparaba bien desde BI-REDESIGN-1 (mismo corte día/mes, un año
 * antes) -- ese criterio se generaliza acá a Month/Quarter.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' -> componentes numéricos, sin pasar por `new Date()` local. */
function parseISODate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** Días entre dos fechas ISO, AMBOS extremos inclusive -- UTC explícito, mismo criterio del resto del proyecto. */
function daysBetweenInclusive(startISO: string, endISO: string): number {
  const s = parseISODate(startISO);
  const e = parseISODate(endISO);
  const startMs = Date.UTC(s.y, s.m - 1, s.d);
  const endMs = Date.UTC(e.y, e.m - 1, e.d);
  return Math.round((endMs - startMs) / 86400000) + 1;
}

/** `startISO` + N días calendario (UTC), ej. `addDaysISO('2026-07-01', 25)` -> '2026-07-26' (el día 26 del mes, offset 0-based). */
function addDaysISO(startISO: string, daysToAdd: number): string {
  const s = parseISODate(startISO);
  const d = new Date(Date.UTC(s.y, s.m - 1, s.d) + daysToAdd * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

interface PeriodProgress {
  /** Días transcurridos del período HASTA HOY (inclusive) -- si el período ya cerró (pasado), es el total. */
  elapsed: number;
  /** Días totales del período completo (mes/trimestre/año calendario). */
  total: number;
  /** `true` sólo si "hoy" cae DENTRO del período elegido -- un mes/trimestre/año ya pasado nunca está "en curso", aunque el usuario lo tenga seleccionado. */
  inProgress: boolean;
}

/**
 * Cuánto del período elegido ya transcurrió, EXACTO por modo -- es la pieza
 * que faltaba en BI-REDESIGN-1 y que hace posible tanto el capping del
 * período anterior (más abajo) como la proyección de ritmo.
 *
 * Deliberadamente NO se deriva de `periodDateRange(selection)` para YTD:
 * esa función ya recorta `endDate` a "hoy" cuando el año es el actual, así
 * que comparar `today >= range.endDate` para decidir "¿está en curso?"
 * daría SIEMPRE `false` para YTD (el rango ya termina hoy por
 * construcción) -- exactamente el bug que este archivo ya evitó una vez
 * para el rango comparable, reaparecido si se intentara derivar "en
 * curso" del mismo lugar. Por eso el criterio de "en curso" es el año/
 * mes/trimestre calendario de HOY comparado contra el de la selección,
 * nunca la fecha de corte del rango ya recortado.
 */
function currentPeriodProgress(selection: PeriodSelection, today: { year: number; month: number; day: number }): PeriodProgress {
  const todayISO = `${today.year}-${pad2(today.month)}-${pad2(today.day)}`;
  if (selection.mode === 'ytd') {
    const total = daysBetweenInclusive(`${selection.year}-01-01`, `${selection.year}-12-31`);
    const inProgress = selection.year === today.year;
    const elapsed = inProgress ? daysBetweenInclusive(`${selection.year}-01-01`, todayISO) : total;
    return { elapsed, total, inProgress };
  }
  const full = periodDateRange(selection);
  const total = daysBetweenInclusive(full.startDate, full.endDate);
  const inProgress =
    selection.mode === 'month'
      ? selection.year === today.year && selection.month === today.month
      : selection.year === today.year && quarterOfMonth(today.month) === selection.quarter;
  const elapsed = inProgress ? daysBetweenInclusive(full.startDate, todayISO) : total;
  return { elapsed, total, inProgress };
}

interface PreviousComparison {
  /** Rango "día a día" -- capado al mismo N° de días transcurridos del período actual. Para el delta principal. */
  cappedRange: DateRange;
  cappedLabel: string;
  /** Rango del período anterior COMPLETO, sin capar -- sólo para la proyección de ritmo (punto 1 del brief BI-REDESIGN-2). */
  fullRange: DateRange;
  fullLabel: string;
}

/**
 * EL "PERÍODO ANTERIOR COMPARABLE" -- exacto, por modo. `progress` (de
 * `currentPeriodProgress`) decide si hace falta capar: un período ya
 * CERRADO (el usuario navegó a un mes/trimestre/año pasado) no tiene
 * distorsión que corregir -- se compara completo contra completo, como
 * hacía BI-REDESIGN-1 para todos los casos (el bug sólo existía para el
 * período EN CURSO).
 *
 *   - Month/Quarter EN CURSO: el período anterior se capa a los primeros
 *     N días (mismo N que lleva transcurrido el actual) -- "día 26 de
 *     agosto" compara contra "día 26 de julio", nunca contra julio
 *     completo.
 *   - YTD: sigue el mismo criterio que ya tenía desde BI-REDESIGN-1 (mismo
 *     corte día/mes, un año antes) -- ya era día-a-día correcto, sin
 *     cambios acá; `periodDateRange()` no sirve para el año anterior
 *     porque sólo recorta "a la fecha" en el año EN CURSO.
 */
function previousPeriodComparison(selection: PeriodSelection, progress: PeriodProgress): PreviousComparison {
  if (selection.mode === 'month') {
    const prevMonth = selection.month === 1 ? 12 : selection.month - 1;
    const prevYear = selection.month === 1 ? selection.year - 1 : selection.year;
    const prevSelection: PeriodSelection = { mode: 'month', year: prevYear, month: prevMonth };
    return buildComparison(periodDateRange(prevSelection), periodLabel(prevSelection), progress);
  }
  if (selection.mode === 'quarter') {
    const prevQuarter = (selection.quarter === 1 ? 4 : selection.quarter - 1) as 1 | 2 | 3 | 4;
    const prevYear = selection.quarter === 1 ? selection.year - 1 : selection.year;
    const prevSelection: PeriodSelection = { mode: 'quarter', year: prevYear, quarter: prevQuarter };
    return buildComparison(periodDateRange(prevSelection), periodLabel(prevSelection), progress);
  }
  // YTD -- ya día-a-día por construcción desde BI-REDESIGN-1, sin cambios.
  const today = utcToday();
  const prevYear = selection.year - 1;
  const cappedRange: DateRange = { startDate: `${prevYear}-01-01`, endDate: `${prevYear}-${pad2(today.month)}-${pad2(today.day)}` };
  const monthName = periodLabel({ mode: 'month', year: prevYear, month: today.month }).split(' ')[0];
  const cappedLabel = `Jan 1 – ${monthName} ${pad2(today.day)}, ${prevYear}`;
  const fullRange: DateRange = { startDate: `${prevYear}-01-01`, endDate: `${prevYear}-12-31` };
  return { cappedRange, cappedLabel, fullRange, fullLabel: `${prevYear} (full year)` };
}

function buildComparison(fullRange: DateRange, fullLabel: string, progress: PeriodProgress): PreviousComparison {
  if (!progress.inProgress) {
    // Período actual ya cerrado -- completo contra completo, sin capar (nada que corregir).
    return { cappedRange: fullRange, cappedLabel: fullLabel, fullRange, fullLabel };
  }
  const fullDays = daysBetweenInclusive(fullRange.startDate, fullRange.endDate);
  const cappedDays = Math.min(progress.elapsed, fullDays);
  const cappedEnd = addDaysISO(fullRange.startDate, cappedDays - 1);
  return {
    cappedRange: { startDate: fullRange.startDate, endDate: cappedEnd },
    cappedLabel: `first ${cappedDays} day${cappedDays === 1 ? '' : 's'} of ${fullLabel}`,
    fullRange,
    fullLabel,
  };
}

interface DeltaResult {
  pct: number;
  direction: 'up' | 'down' | 'flat';
}

/**
 * `null` = sin base de comparación válida -- el período anterior no tiene
 * NINGÚN funded loan (podría ser porque cae antes del historial capturado,
 * o porque ese mes/trimestre/YTD real tuvo cero cierres). Pedido explícito
 * de Isa: nunca inventar un delta ni mostrar un falso 0% en ese caso -- el
 * consumidor (`DeltaBadge`) muestra "No prior period" en su lugar.
 */
function computeDelta(current: number, previous: number, previousHasData: boolean): DeltaResult | null {
  if (!previousHasData) return null;
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { pct, direction };
}

/**
 * Mismo componente visual que ya usa `components/report/SummaryCards.tsx`
 * (badge suave + flecha, verde/rojo/gris) -- no un patrón nuevo. El color
 * sigue el criterio ya establecido ahí: verde = mejora, rojo = empeora,
 * nunca al revés (el rojo no está "reservado" para negocio malo en
 * abstracto, sigue el mismo mapeo dirección→color que el resto de la app).
 */
function DeltaBadge({ delta, previousLabel }: { delta: DeltaResult | null; previousLabel: string }) {
  if (delta === null) {
    return (
      <span className="kpi-hero__sub" title={`No funded loans in the comparable prior period (${previousLabel}).`}>
        No prior period
      </span>
    );
  }
  const cls = delta.direction === 'up' ? 'badge--up' : delta.direction === 'down' ? 'badge--down' : 'badge--flat';
  const Icon = delta.direction === 'up' ? ArrowUpIcon : delta.direction === 'down' ? ArrowDownIcon : MinusIcon;
  const sign = delta.pct > 0 ? '+' : '';
  return (
    <span className={'badge ' + cls} title={`vs ${previousLabel}`}>
      <Icon size={9} />
      {sign}
      {delta.pct.toFixed(1)}%
    </span>
  );
}

/**
 * Etapa BI-REDESIGN-2, punto 1 (proyección de ritmo) -- por debajo de qué
 * cantidad de días transcurridos una proyección lineal (ritmo actual ×
 * días totales del período) es demasiado ruidosa para mostrar como si
 * fuera información real. Pedido explícito del brief: "al menos 3 días".
 * Con 1-2 días, un solo loan grande/chico distorsiona el proyectado
 * mucho más de lo que un ritmo real justificaría.
 */
const MIN_DAYS_FOR_PROJECTION = 3;

interface PaceProjection {
  projectedValue: number;
  aheadOfPrevious: boolean;
  /** `false` = mismo valor exacto (caso límite, "in line with" en vez de above/below). */
  isDifferent: boolean;
}

/**
 * `null` = no se muestra proyección -- período ya cerrado (nada que
 * proyectar, ya pasó), menos de `MIN_DAYS_FOR_PROJECTION` transcurridos
 * (ritmo no confiable todavía), o sin período anterior COMPLETO con datos
 * contra el cual comparar (mismo criterio de honestidad que `computeDelta`
 * -- nunca "por encima/por debajo de $0").
 */
function computePaceProjection(
  currentValue: number,
  progress: PeriodProgress,
  previousFullValue: number,
  previousFullHasData: boolean
): PaceProjection | null {
  if (!progress.inProgress) return null;
  if (progress.elapsed < MIN_DAYS_FOR_PROJECTION) return null;
  if (!previousFullHasData) return null;
  const projectedValue = (currentValue / progress.elapsed) * progress.total;
  return {
    projectedValue,
    aheadOfPrevious: projectedValue > previousFullValue,
    isDifferent: projectedValue !== previousFullValue,
  };
}

/**
 * Segunda línea de contexto bajo el delta, sólo en Volume/Count (pedido
 * del brief: "el mes terminaría por encima o por debajo del período
 * anterior COMPLETO" -- Average Ticket es un promedio/ratio, no una
 * cantidad que se acumule con el tiempo, así que "proyectar" no tiene el
 * mismo significado matemático ahí -- se deja sin proyección a propósito,
 * ver `HeroKpiCards`).
 */
function PaceNote({
  pace,
  previousFullValue,
  previousFullLabel,
  formatValue,
}: {
  pace: PaceProjection | null;
  previousFullValue: number;
  previousFullLabel: string;
  formatValue: (n: number) => string;
}) {
  if (pace === null) return null;
  const word = !pace.isDifferent ? 'in line with' : pace.aheadOfPrevious ? 'above' : 'below';
  return (
    <div className="kpi-hero__sub">
      On pace to close at {formatValue(pace.projectedValue)}, {word} {previousFullLabel}&apos;s {formatValue(previousFullValue)}
    </div>
  );
}

/**
 * Las 4 tarjetas -- mismas clases del banner ejecutivo de Forecast
 * (`.hero-banner`/`.mcard`/`.kpi-hero__value`, `app/pipeline/SummaryCards.tsx`
 * es la referencia), ningún sistema de tarjetas nuevo. Las primeras 3 llevan
 * delta contra el período anterior comparable (día-a-día, ver el comentario
 * largo de `previousPeriodComparison`); la 4ta (estrategia líder) es
 * puramente informativa -- Isa no pidió delta ahí, y una estrategia "top"
 * cambiando de mes a mes no tiene el mismo tipo de lectura año-contra-año
 * que un monto/conteo. Volume y Count, además, llevan la proyección de
 * ritmo (`PaceNote`) cuando el período está en curso y hay suficientes
 * días para que sea razonable.
 */
function HeroKpiCards({
  currentVolume,
  currentCount,
  currentAvgTicket,
  previousVolume,
  previousCount,
  previousAvgTicket,
  previousLabel,
  progress,
  previousFullVolume,
  previousFullCount,
  previousFullHasData,
  previousFullLabel,
  topStrategy,
}: {
  currentVolume: number;
  currentCount: number;
  currentAvgTicket: number;
  previousVolume: number;
  previousCount: number;
  previousAvgTicket: number;
  previousLabel: string;
  progress: PeriodProgress;
  previousFullVolume: number;
  previousFullCount: number;
  previousFullHasData: boolean;
  previousFullLabel: string;
  /** `null` = sin dato de estrategia confiable en el período (snapshot sin los crudos, o 0 funded) -- ver el gate en TabAnalytics. */
  topStrategy: StrategyMixRow | null;
}) {
  const previousHasData = previousCount > 0;
  const volumeDelta = computeDelta(currentVolume, previousVolume, previousHasData);
  const countDelta = computeDelta(currentCount, previousCount, previousHasData);
  const avgTicketDelta = computeDelta(currentAvgTicket, previousAvgTicket, previousHasData);
  const volumePace = computePaceProjection(currentVolume, progress, previousFullVolume, previousFullHasData);
  const countPace = computePaceProjection(currentCount, progress, previousFullCount, previousFullHasData);

  return (
    <div className="hero-banner">
      {/*
        Etapa PULIDO-1: `mcard--sky` -- variante YA EXISTENTE (components.css,
        fondo/borde 'Light Sky' tenue), no un token nuevo. Es la misma clase
        que ya usa la tarjeta "Total Forecast" del banner ejecutivo de
        Forecast (app/pipeline/SummaryCards.tsx) para su tarjeta headline --
        mismo criterio semántico acá: Total Closed Volume es el número
        principal de Analytics, se destaca sin gritar (fondo tenue, no un
        color sólido). El valor sigue en navy (`.kpi-hero__value` base, sin
        variante `--sky`) -- mismo patrón que esa tarjeta de referencia, que
        tampoco recolorea el número sobre el fondo sky.
      */}
      <div className="mcard mcard--sky mcard--accent-left">
        <div className="m-name">Total Closed Volume</div>
        <div className="kpi-hero__value kpi-hero__value--lg">${fmtAmount(currentVolume)}</div>
        <div style={{ marginTop: '8px' }}>
          <DeltaBadge delta={volumeDelta} previousLabel={previousLabel} />
        </div>
        <PaceNote
          pace={volumePace}
          previousFullValue={previousFullVolume}
          previousFullLabel={previousFullLabel}
          formatValue={(n) => '$' + fmtAmount(n)}
        />
      </div>

      <div className="mcard">
        <div className="m-name">Closed Loans</div>
        <div className="kpi-hero__value kpi-hero__value--lg">{fmtInt(currentCount)}</div>
        <div style={{ marginTop: '8px' }}>
          <DeltaBadge delta={countDelta} previousLabel={previousLabel} />
        </div>
        {/*
          Etapa FIX-1: `pace.projectedValue` es (count / elapsed) * total --
          una división, nunca un entero real (ej. 32.192...). `fmtInt` no
          redondea (`toLocaleString` muestra los decimales tal cual, no
          trunca) -- un conteo de préstamos SIEMPRE es entero, así que se
          redondea acá, en el formateador de ESTA proyección puntual, sin
          tocar `fmtInt` en general (sigue sirviendo tal cual para valores
          que ya son enteros de por sí, ej. `currentCount`/`previousFullCount`
          más abajo, que no necesitan este redondeo).
        */}
        <PaceNote
          pace={countPace}
          previousFullValue={previousFullCount}
          previousFullLabel={previousFullLabel}
          formatValue={(n) => fmtInt(Math.round(n))}
        />
      </div>

      <div className="mcard">
        <div className="m-name">Average Ticket</div>
        <div className="kpi-hero__value kpi-hero__value--lg">${fmtAmount(currentAvgTicket)}</div>
        <div style={{ marginTop: '8px' }}>
          <DeltaBadge delta={avgTicketDelta} previousLabel={previousLabel} />
        </div>
      </div>

      <div className="mcard">
        <div className="m-name">Top Strategy</div>
        {topStrategy ? (
          <>
            <div className="kpi-hero__value kpi-hero__value--lg" style={{ fontSize: '22px' }}>
              {topStrategy.strategy}
            </div>
            <div className="kpi-hero__sub">{fmtPercent(topStrategy.percent)} of closed loans this period</div>
          </>
        ) : (
          <div className="kpi-hero__sub">No strategy data for this period</div>
        )}
      </div>
    </div>
  );
}

/**
 * Tab 4 — Analytics (Etapa F7, Parte 1): selector de período + rankings de
 * Loan Program y Loan Type. Solo lectura sobre `pipeline_resolved_loans`
 * (status='funded', filtrado por `disbursementDate` -- nunca `estClosingDate`,
 * regla explícita del brief). No toca ninguna regla de cálculo existente:
 * pull-through, Healthy, Adverse y las estrategias comerciales quedan
 * idénticos -- esta pestaña es un corte nuevo e independiente sobre los
 * mismos datos ya cargados.
 *
 * Etapa BI-REDESIGN-1: reorganizada en 4 capas narrativas (rediseño de
 * Isa) -- Hero KPI Header, Monthly Trends, Product Mix & Geography,
 * Commercial Scorecards & Pareto. Ver el comentario de cada capa en el
 * JSX de abajo para el detalle de qué se movió y por qué. Ningún cálculo
 * existente se tocó: todo lo que ya eran `const` en este componente sigue
 * exactamente igual, esta etapa sólo agrega el cálculo del Hero KPI (ver
 * arriba) y reordena el JSX.
 */
export default function TabAnalytics({ resolvedLoans }: TabAnalyticsProps) {
  const [period, setPeriod] = useState<PeriodSelection>(() => getDefaultPeriodSelection());
  const orgRoster = useOrgRoster();

  /**
   * Etapa AJUSTES-ANALYTICS-1, punto 5 -- filtro global de Branch, mismo
   * criterio ('ALL' o un branch code) que ya usa el selector de Forecast
   * (Topbar.tsx/page.tsx), pero LOCAL a esta pestaña: `app/analytics/page.tsx`
   * no filtraba por branch (decisión explícita de ANALYTICS-TAB-1, "si
   * hiciera falta un filtro de branch acá más adelante, es una etapa
   * aparte" -- esta es esa etapa), y el alcance de esta tarea es
   * TabAnalytics.tsx, no esa página wrapper.
   *
   * `availableBranches` se calcula sobre `resolvedLoans` SIN filtrar -- el
   * <select> debe listar siempre todos los branches del snapshot,
   * independientemente de cuál esté elegido ahora mismo (mismo criterio que
   * `availableBranches` en page.tsx, que tampoco se recalcula sobre el
   * subconjunto ya filtrado).
   *
   * `branchFilteredLoans` es el ÚNICO punto de filtrado: todo lo que antes
   * leía `resolvedLoans` directo (fundedInRange, previousFunded,
   * previousFullFunded, ytdFunded, earliestDate, monthlyTotals,
   * monthlyTypeBreakdown) pasa a leer esto -- así el filtro alcanza a las 4
   * capas completas (Hero KPI, Monthly Trends, Product Mix, Scorecards/
   * Pareto) por construcción, sin tener que acordarse de aplicarlo en cada
   * cálculo por separado.
   */
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const availableBranches = [...new Set(resolvedLoans.map((l) => l.branch))].filter(Boolean).sort();
  const branchFilteredLoans = selectedBranch === 'ALL' ? resolvedLoans : resolvedLoans.filter((l) => l.branch === selectedBranch);

  /** Etapa F7, Parte 5: drill-down de rankings/scorecards hacia el mismo LoanDetailModal que ya usa PivotTable. `null` = cerrado. */
  const [drillDown, setDrillDown] = useState<{
    context: string;
    metric: string;
    loans: LoanDetailModalLoan[];
    hiddenColumns: LoanDetailModalColumn[];
  } | null>(null);

  /**
   * La animación de entrada de los charts de tendencias (más abajo en esta
   * misma pestaña) debe correr cuando el usuario los ve por primera vez al
   * hacer scroll, no al montar el componente -- si no, ya terminó antes de
   * que la sección entre en pantalla. `IntersectionObserver` nativo (sin
   * librería); el callback se auto-desconecta en la primera intersección
   * (`obs.disconnect()`), así que dispara una sola vez por carga de página,
   * nunca de nuevo por scroll repetido -- y el cleanup del efecto cubre el
   * caso de que el usuario cambie de pestaña antes de llegar a verlos.
   */
  const trendsSectionRef = useRef<HTMLDivElement>(null);
  const [trendsVisible, setTrendsVisible] = useState(false);
  useEffect(() => {
    const el = trendsSectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries, obs) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setTrendsVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const range = periodDateRange(period);
  const earliestDate = earliestFundedDisbursementDate(branchFilteredLoans);
  /*
   * "Nunca un total incompleto disfrazado de total completo": si el período
   * pedido empieza antes de la disbursementDate más antigua que existe en el
   * snapshot, lo que se muestra no es "todo el período", es solo la parte que
   * el historial realmente cubre -- se avisa explícito en vez de mostrar un
   * número que parece completo y no lo es.
   */
  const exceedsHistory = earliestDate !== null && range.startDate < earliestDate;

  const fundedInRange = fundedLoansInRange(branchFilteredLoans, range);
  const programRanking = buildLoanProgramRanking(fundedInRange);
  const typeRanking = buildLoanTypeRanking(fundedInRange);
  const propertyStateRanking = buildPropertyStateRanking(fundedInRange);

  const branchScorecard = buildBranchScorecard(fundedInRange, orgRoster.knownBranchCodes);
  const loanOfficerScorecard = buildLoanOfficerScorecard(
    fundedInRange,
    orgRoster.aliasIndex,
    orgRoster.excludedIndex,
    orgRoster.employeeNameByKey
  );
  const businessDeveloperScorecard = buildBusinessDeveloperScorecard(
    fundedInRange,
    orgRoster.aliasIndex,
    orgRoster.excludedIndex,
    orgRoster.employeeNameByKey
  );
  /**
   * Etapa F7.20: distingue "este snapshot no capturó opportunity_owner"
   * (columna nueva -- todo snapshot restaurado de antes de esta etapa
   * queda con el campo en '' para el 100% de sus loans) de "0 Business
   * Developers reales este período" (resultado legítimo, distinto). Un
   * `blankCount` parcial (algunos sí, otros no) NO dispara este mensaje --
   * ahí corresponde el ⚠ normal de "con no name recorded" ya construido,
   * no este caso especial.
   */
  const bdOwnerDataMissing =
    businessDeveloperScorecard.diagnostics.totalInput > 0 &&
    businessDeveloperScorecard.diagnostics.blankCount === businessDeveloperScorecard.diagnostics.totalInput;

  /**
   * Etapa F7, Parte 10: mezcla de estrategia comercial -- NO depende de
   * `org` (classifyStrategy solo lee campos crudos de `fundedInRange`), a
   * diferencia de Branch/Loan Officer/Business Developer de arriba. Por
   * eso se renderiza fuera del bloque `{!orgRoster.loading && !orgRoster.error && (...)}`.
   */
  const strategyMix = buildStrategyMix(fundedInRange);

  /**
   * Etapa F7.23 -- pedido explícito de Isa: un snapshot anterior al 23 de
   * agosto (sin los cinco crudos de estrategia) hace que `classifyStrategy`
   * caiga en `'Own production'` para el 100% de los loans (es el default,
   * ver `classifyStrategy`/`hasStrategyData` en lib/pipeline/strategy.ts) --
   * el donut mostraría una porción falsa de "Own production" al 100%, que
   * se lee como un dato real de negocio y no lo es. `hasStrategyData()` ya
   * existía (construido en la Etapa F6 para este caso exacto) pero nunca se
   * había conectado a esta vista. Mismo criterio que `bdOwnerDataMissing`
   * arriba: `totalInput > 0` para no disparar el aviso con un período sin
   * ningún loan (0 loans es "sin datos en el período", un caso ya cubierto
   * por otro lado, no este).
   */
  const strategyDataMissing = fundedInRange.length > 0 && !hasStrategyData(fundedInRange);

  /**
   * Etapa PROPERTY-STATE-1: mismo criterio exacto que strategyDataMissing de
   * arriba, aplicado a property_state en vez de los crudos de estrategia --
   * ver hasPropertyStateData() en lib/pipeline/analytics.ts.
   */
  const propertyStateDataMissing = fundedInRange.length > 0 && !hasPropertyStateData(fundedInRange);

  /**
   * Etapa BI-REDESIGN-1 -- Capa 1 (Hero KPI Header). Corregida en
   * BI-REDESIGN-2: `currentPeriodProgress()` calcula cuánto del período
   * elegido ya transcurrió (exacto por modo, ver el comentario largo junto
   * a esa función), y `previousPeriodComparison()` usa eso para capar el
   * período anterior al mismo N° de días -- el delta ya no compara
   * "agosto hasta hoy" contra "julio completo". `fullRange`/`fullFunded`
   * (el período anterior SIN capar) se guardan aparte, sólo para la
   * proyección de ritmo -- reusa `fundedLoansInRange()`, la misma función
   * ya usada arriba para `fundedInRange`, sin cálculo de agrupación nuevo.
   */
  const today = utcToday();
  const progress = currentPeriodProgress(period, today);
  const {
    cappedRange: previousRange,
    cappedLabel: previousPeriodLabel,
    fullRange: previousFullRange,
    fullLabel: previousFullLabel,
  } = previousPeriodComparison(period, progress);
  const previousFunded = fundedLoansInRange(branchFilteredLoans, previousRange);
  const previousFullFunded = fundedLoansInRange(branchFilteredLoans, previousFullRange);
  const currentVolume = fundedInRange.reduce((sum, l) => sum + l.amount, 0);
  const currentCount = fundedInRange.length;
  const currentAvgTicket = currentCount > 0 ? currentVolume / currentCount : 0;
  const previousVolume = previousFunded.reduce((sum, l) => sum + l.amount, 0);
  const previousCount = previousFunded.length;
  const previousAvgTicket = previousCount > 0 ? previousVolume / previousCount : 0;
  const previousFullVolume = previousFullFunded.reduce((sum, l) => sum + l.amount, 0);
  const previousFullCount = previousFullFunded.length;
  const previousFullHasData = previousFullCount > 0;
  /**
   * Estrategia líder del período -- mismo gate que `strategyDataMissing` de
   * arriba (evita mostrar "Own production" al 100% cuando en realidad es el
   * default de un snapshot sin los crudos de estrategia) MÁS el caso de
   * período sin ningún funded loan (`strategyMix` da 0/0% en las 5 filas,
   * y "la estrategia líder de cero préstamos" no es información real).
   */
  const topStrategy =
    !strategyDataMissing && currentCount > 0
      ? strategyMix.reduce((max, row) => (row.count > max.count ? row : max), strategyMix[0])
      : null;

  /**
   * Etapa F7, Parte 11: Pareto por Branch/Loan Officer -- el toggle interno
   * del chart (Selected period / Year to date) es LOCAL a `ParetoChart`
   * (useState propio, ver más abajo), así que las combinaciones
   * (branch/LO/BD × período/YTD) se precomputan ACÁ, una sola vez por render
   * de `TabAnalytics`, y el toggle solo elige cuál mostrar -- cambiarlo
   * nunca dispara un nuevo fetch de `org` ni afecta al selector de período
   * principal ni a ningún otro de los 8 gráficos de la pestaña.
   *
   * YTD se calcula aparte de `fundedInRange`/`period` -- mismo patrón que
   * ya usa `period.ts` para el modo YTD del selector principal
   * (`getDefaultYtdSelection` + `periodDateRange`), pero SIN tocar el
   * estado `period` (el selector de arriba no cambia). `buildBranchScorecard`/
   * `buildLoanOfficerScorecard`/`buildBusinessDeveloperScorecard` son las
   * mismas funciones ya usadas para Scorecards -- ninguna agrupación nueva,
   * solo se llaman con `ytdFunded` en vez de `fundedInRange`.
   *
   * Etapa BI-REDESIGN-2, punto 3: `businessDeveloper` se agrega al mismo
   * patrón exacto de `branch`/`loanOfficer` -- `buildParetoRows()`
   * (lib/pipeline/paretoMix.ts) es genérica sobre `ScorecardRow[]`, no
   * necesitó ningún cambio para aceptar `businessDeveloperScorecard.rows`.
   */
  const ytdRange = periodDateRange(getDefaultYtdSelection());
  const ytdFunded = fundedLoansInRange(branchFilteredLoans, ytdRange);
  const ytdBranchScorecard = buildBranchScorecard(ytdFunded, orgRoster.knownBranchCodes);
  const ytdLoanOfficerScorecard = buildLoanOfficerScorecard(
    ytdFunded,
    orgRoster.aliasIndex,
    orgRoster.excludedIndex,
    orgRoster.employeeNameByKey
  );
  const ytdBusinessDeveloperScorecard = buildBusinessDeveloperScorecard(
    ytdFunded,
    orgRoster.aliasIndex,
    orgRoster.excludedIndex,
    orgRoster.employeeNameByKey
  );
  const paretoData = {
    period: {
      branch: buildParetoRows(branchScorecard.rows),
      loanOfficer: buildParetoRows(loanOfficerScorecard.rows),
      businessDeveloper: buildParetoRows(businessDeveloperScorecard.rows),
    },
    ytd: {
      branch: buildParetoRows(ytdBranchScorecard.rows),
      loanOfficer: buildParetoRows(ytdLoanOfficerScorecard.rows),
      businessDeveloper: buildParetoRows(ytdBusinessDeveloperScorecard.rows),
    },
  };

  /*
   * Etapa F7, Parte 3: las tendencias son SIEMPRE del año en curso (UTC),
   * independiente del año que tenga seleccionado el período de arriba --
   * `branchFilteredLoans` acá es el array completo YA filtrado por branch
   * (sin filtrar por `fundedLoansInRange`, que solo cubre el período
   * elegido) porque la serie necesita los 12 meses del año, no solo el
   * período seleccionado. Etapa AJUSTES-ANALYTICS-1, punto 5: antes decía
   * `resolvedLoans` acá -- sin este cambio, Monthly Trends habría quedado
   * sordo al filtro de Branch mientras el resto de la pestaña sí lo
   * respetaba.
   */
  const trendsYear = currentYear();
  const monthlyTotals = buildMonthlyTotals(branchFilteredLoans, trendsYear);
  const monthlyTypeBreakdown = buildMonthlyTypeBreakdown(branchFilteredLoans, trendsYear);
  const highlightMonths = new Set(periodMonths(period).filter((m) => m.startsWith(String(trendsYear) + '-')));
  const trendsTotalCount = monthlyTotals.reduce((sum, t) => sum + t.count, 0);

  /**
   * Etapa F7, Parte 15: ticket promedio mensual -- `avgTicketByMonth`
   * reusa `monthlyTotals` (arriba) directo, sin recalcular `count`/
   * `amount`. El promedio general de referencia es PONDERADO (suma de
   * `amount` de los meses con datos / suma de su `count`) -- no el
   * promedio simple de los 8 promedios mensuales, que le daría el mismo
   * peso a un mes de 24 loans que a uno de 57.
   */
  const avgTicketData = avgTicketByMonth(monthlyTotals);
  const monthsWithData = monthlyTotals.filter((t) => t.count > 0);
  const overallAvgTicketCount = monthsWithData.reduce((sum, t) => sum + t.count, 0);
  const overallAvgTicketAmount = monthsWithData.reduce((sum, t) => sum + t.amount, 0);
  const overallAvgTicket = overallAvgTicketCount > 0 ? overallAvgTicketAmount / overallAvgTicketCount : 0;

  return (
    // Etapa PULIDO-1 FIX: antes un Fragment (`<>`) -- pasa a `<div
    // className="analytics-tab">` para poder acotar el fix de sombra
    // (forecast-visual.css, `.analytics-tab .tbl-card`/`.mcard`) SOLO a esta
    // pestaña, sin tocar `.tbl-card`/`.mcard` en el resto de la app (Forecast
    // Projected/Business Plan/Commercial Activity siguen con --shadow-xs por
    // defecto). Sin efecto de layout -- mismo comportamiento de bloque que
    // ya tenían los hijos directos de acá, no se agrega ningún estilo propio
    // al div en sí.
    <div className="analytics-tab">
      <div className="control-bar" style={{ marginBottom: '16px' }}>
        <PeriodSelector value={period} onChange={setPeriod} />
        {/*
          Etapa AJUSTES-ANALYTICS-1, punto 5 -- mismo criterio visual que el
          selector de Branch de Forecast (Topbar.tsx: label-chip "Branch" +
          <select className="field">), pero con estado LOCAL a esta pestaña
          (ver `selectedBranch` arriba) -- Analytics no comparte estado con
          /pipeline, cada ruta de nivel superior de esta app ya es
          independiente (mismo criterio ya documentado en
          app/analytics/page.tsx).
        */}
        <div className="control-group">
          <span className="label-chip">Branch</span>
          <select className="field" value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}>
            <option value="ALL">All branches</option>
            {availableBranches.map((b) => (
              <option key={b} value={b}>
                Branch {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      {exceedsHistory && (
        <p className="pill warn" style={{ marginBottom: '16px', display: 'inline-flex' }}>
          Data only goes back to {earliestDate}. {periodLabel(period)} ({range.startDate} to {range.endDate}) extends
          earlier than that — totals below cover only {earliestDate} to {range.endDate}, not the full period
          requested.
        </p>
      )}

      {/*
        ==========================================================================
        CAPA 1 — HERO KPI HEADER (Etapa BI-REDESIGN-1, rediseño de Isa)
        ==========================================================================
        Arriba de todo -- antes de cualquier tabla/chart. `HeroKpiCards` hace
        el cálculo (ver el comentario largo junto a esa función, más arriba en
        este archivo); acá sólo se le pasan los valores ya calculados.
      */}
      <HeroKpiCards
        currentVolume={currentVolume}
        currentCount={currentCount}
        currentAvgTicket={currentAvgTicket}
        previousVolume={previousVolume}
        previousCount={previousCount}
        previousAvgTicket={previousAvgTicket}
        previousLabel={previousPeriodLabel}
        progress={progress}
        previousFullVolume={previousFullVolume}
        previousFullCount={previousFullCount}
        previousFullHasData={previousFullHasData}
        previousFullLabel={previousFullLabel}
        topStrategy={topStrategy}
      />

      {/*
        ==========================================================================
        CAPA 2 — MONTHLY TRENDS (reorganizada, misma lógica/charts de siempre)
        ==========================================================================
        Grid de 2 columnas pedido por Isa: Closings + Amount combinados a la
        izquierda (más ancho, los dos charts apilados dentro de esa misma
        columna), Avg Ticket a la derecha (más angosto). Loan Type
        Distribution by Month YA NO vive acá -- Etapa BI-REDESIGN-2, punto 2,
        lo reubicó dentro del grid de Capa 3 (Product Mix & Geography), ver
        el comentario de esa capa más abajo.
      */}
      <h3 style={{ margin: '24px 0 12px' }}>Monthly Trends — {trendsYear}</h3>
      <DiagnosticsNote
        count={1}
        summary={`All 12 months of ${trendsYear} — months with no data yet show 0 explicitly, never omitted. The month(s) matching the period selected above are highlighted in coral.`}
        detail="Read-only, no dependency on org -- entirely from pipeline_resolved_loans."
      />

      <div ref={trendsSectionRef} className={'trend-charts' + (trendsVisible ? ' trend-charts--enter' : '')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: '20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="tbl-card" style={{ padding: '16px' }}>
              <div className="tbl-card__head">
                {/* Etapa AJUSTES-ANALYTICS-1, punto 1: "YTD" explícito -- el número es el acumulado de los {trendsYear} meses visibles en el chart (incluido 0 en los que faltan), no de un solo mes. */}
                <span className="tbl-card__title">Closings by Month ({fmtInt(trendsTotalCount)} YTD)</span>
              </div>
              <SimpleMonthlyChart
                totals={monthlyTotals}
                highlightMonths={highlightMonths}
                getValue={(t) => t.count}
                formatValue={fmtInt}
                onBarClick={(month) =>
                  setDrillDown({
                    metric: 'Closings by Month',
                    context: month,
                    loans: loansForMonth(branchFilteredLoans, month).map(closedLoanToModalLoan),
                    hiddenColumns: ['milestone', 'status'],
                  })
                }
              />
            </div>
            <div className="tbl-card" style={{ padding: '16px' }}>
              <div className="tbl-card__head">
                <span className="tbl-card__title">
                  {/* Solo el título -- las etiquetas dentro de las barras (fmtAmountShort) siguen sin "$", sin cambios. Etapa AJUSTES-ANALYTICS-1, punto 1: mismo "YTD" explícito que Closings. */}
                  Amount Closed by Month (${fmtAmount(monthlyTotals.reduce((sum, t) => sum + t.amount, 0))} YTD)
                </span>
              </div>
              <SimpleMonthlyChart
                totals={monthlyTotals}
                highlightMonths={highlightMonths}
                getValue={(t) => t.amount}
                formatValue={fmtAmount}
                formatLabel={fmtAmountShort}
                onBarClick={(month) =>
                  setDrillDown({
                    metric: 'Amount Closed by Month',
                    context: month,
                    loans: loansForMonth(branchFilteredLoans, month).map(closedLoanToModalLoan),
                    hiddenColumns: ['milestone', 'status'],
                  })
                }
              />
            </div>
          </div>

          <div className="tbl-card" style={{ padding: '16px' }}>
            <div className="tbl-card__head">
              <span className="tbl-card__title">
                Avg Ticket by Month {overallAvgTicket > 0 && `(avg: $${fmtAmount(overallAvgTicket)})`}
              </span>
            </div>
            {/* Etapa F7.21: único chart de Monthly Trends sin nota descriptiva -- los otros 4 (Rankings/Scorecards/Monthly Trends/Strategy Mix) ya la tenían. */}
            <DiagnosticsNote
              count={1}
              summary="Average loan amount per closing, by month (total amount ÷ closings -- not a margin or division earnings figure)."
              detail="avgTicketByMonth() (lib/pipeline/trends.ts) divides the same monthlyTotals used by the Closings/Amount charts above (amount/count per month, 0 when count is 0) -- derived here, not a separate field from the export."
            />
            <AvgTicketChart
              rows={avgTicketData}
              highlightMonths={highlightMonths}
              overallAvg={overallAvgTicket}
              onPointClick={(month) =>
                setDrillDown({
                  metric: 'Avg Ticket by Month',
                  context: month,
                  loans: loansForMonth(branchFilteredLoans, month).map(closedLoanToModalLoan),
                  hiddenColumns: ['milestone', 'status'],
                })
              }
            />
          </div>
        </div>
      </div>

      {/*
        ==========================================================================
        CAPA 3 — PRODUCT MIX & GEOGRAPHY (reorganizada, mismos rankings de siempre)
        ==========================================================================
        Etapa AJUSTES-ANALYTICS-1, punto 3: grid de **3 columnas parejas**,
        una sola fila -- Loan Program, Loan Type y Subject Property State
        lado a lado (antes: 2 columnas, con Loan Program+Loan Type apilados
        en la primera). Loan Type Distribution by Month sigue APARTE, a
        ancho completo (`gridColumn: '1 / -1'`, sigue abarcando las 3
        columnas del grid nuevo) -- eso no cambia, seguía leyéndose bien a
        ese ancho desde el fix de BI-REDESIGN-2 (punto sobre el grid de 2
        columnas, comentario ya reemplazado por este). Subject Property
        State: se evaluó la barra horizontal en vez de tabla plana (nota
        del brief), pero con las 793 filas reales de este snapshot ya
        clasificadas en ~40 estados/territorios, una tabla con barra DETRÁS
        del label (mismo mecanismo transversal de abajo, `rankBarStyle`)
        cumple el pedido sin construir un componente de barras nuevo -- ver
        `RankingTable` más arriba.
      */}
      <h3 style={{ margin: '24px 0 12px' }}>Product Mix &amp; Geography</h3>
      {/* count={1}: nota siempre visible (no es un diagnóstico condicional) -- se reusa DiagnosticsNote solo por su mecanismo de resumen breve + detalle en tooltip, mismo patrón que PersonDiagnostics. Mismo texto de siempre -- sólo se movió acá, junto a los rankings que describe (antes vivía arriba de todo, separada de su contenido). */}
      <DiagnosticsNote
        count={1}
        summary="Funded loans (Disbursement Date), grouped by Loan Program, Loan Type, and Subject Property State, for the selected period."
        detail="Read-only — doesn't affect pull-through, Healthy, Adverse, or strategy calculations elsewhere in Forecast."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '20px' }}>
        <RankingTable
          title="Loan Program"
          columnLabel="Program"
          rows={programRanking}
          totalCount={fundedInRange.length}
          onRowClick={(row) =>
            setDrillDown({
              metric: 'Loan Program',
              context: row.label,
              loans: fundedInRange
                .filter((l) => (l.loanProgram.trim() || DRILLDOWN_NO_PROGRAM_LABEL) === row.label)
                .map(closedLoanToModalLoan),
              hiddenColumns: ['loanProgram', 'milestone', 'status'],
            })
          }
        />
        <RankingTable
          title="Loan Type"
          columnLabel="Type"
          rows={typeRanking}
          totalCount={fundedInRange.length}
          onRowClick={(row) =>
            setDrillDown({
              metric: 'Loan Type',
              context: row.label,
              loans: fundedInRange
                .filter((l) => (l.loanType.trim() || DRILLDOWN_NO_TYPE_LABEL) === row.label)
                .map(closedLoanToModalLoan),
              hiddenColumns: ['loanType', 'milestone', 'status'],
            })
          }
        />

        {propertyStateDataMissing ? (
          <div className="tbl-card" style={{ padding: '16px' }}>
            {/*
              Etapa PROPERTY-STATE-1: mismo criterio que Strategy Mix (F7.23) --
              un ranking 100% "Sin estado" se leería como un resultado real de
              negocio, y acá es un default silencioso por falta de datos (el
              snapshot todavía no capturó property_state, o se subió antes de
              esta etapa). El número es el conteo REAL de este snapshot activo,
              calculado en vivo sobre fundedInRange -- nunca un número fijo del
              archivo de referencia usado en el diagnóstico previo (ese archivo
              NO era el snapshot activo).
            */}
            <p className="foot-note" style={{ margin: 0 }}>
              No property state data in this snapshot — all {fmtInt(fundedInRange.length)} funded loans in this
              period have no Subject Property State recorded. Re-upload required to populate this view.
            </p>
          </div>
        ) : (
          <RankingTable
            title="Subject Property State"
            columnLabel="State"
            rows={propertyStateRanking}
            totalCount={fundedInRange.length}
            onRowClick={(row) =>
              setDrillDown({
                metric: 'Subject Property State',
                context: row.label,
                loans: fundedInRange
                  .filter((l) => (l.propertyState.trim() || NO_PROPERTY_STATE_LABEL) === row.label)
                  .map(closedLoanToModalLoan),
                hiddenColumns: ['propertyState', 'milestone', 'status'],
              })
            }
          />
        )}

        <div className="tbl-card" style={{ padding: '16px', gridColumn: '1 / -1' }}>
          <div className="tbl-card__head">
            <span className="tbl-card__title">Loan Type Distribution by Month</span>
          </div>
          <TypeBreakdownChart
            breakdown={monthlyTypeBreakdown}
            highlightMonths={highlightMonths}
            onSegmentClick={(month, typeLabel) =>
              setDrillDown({
                metric: 'Loan Type Distribution by Month',
                context: `${typeLabel} — ${month}`,
                loans: loansForMonthAndType(branchFilteredLoans, month, typeLabel).map(closedLoanToModalLoan),
                hiddenColumns: ['loanType', 'milestone', 'status'],
              })
            }
          />
        </div>
      </div>

      {/*
        ==========================================================================
        CAPA 4 — COMMERCIAL SCORECARDS & PARETO (reorganizada, mismo contenido)
        ==========================================================================
        Scorecards (Branch/Loan Officer/Business Developer) sin cambios --
        son la mitad "Commercial Scorecards" del nombre de esta capa. Debajo,
        Strategy Mix + Pareto se agrupan visualmente en una sola sub-sección
        ("Productivity & Concentration", pedido explícito del brief) en vez
        de quedar como 2 secciones sueltas -- mismo grid de 2 columnas que
        ya usa Capa 3, ningún componente nuevo.
      */}
      <h3 style={{ margin: '24px 0 12px' }}>Commercial Scorecards &amp; Pareto</h3>
      <DiagnosticsNote
        count={1}
        summary="Branch, Loan Officer, and Business Developer are matched against the company roster, so name variants are combined."
        detail="Resolved against org.dim_branch/org.employee_alias (schema org, read-only, same session as the rest of the app) — names are never compared with string equality, only via the alias table."
      />

      {orgRoster.loading && <p className="foot-note">Loading org roster…</p>}
      {orgRoster.error && <p className="pill warn" style={{ display: 'inline-flex' }}>Could not load org roster: {orgRoster.error}</p>}

      {!orgRoster.loading && !orgRoster.error && (
        <>
          <div style={{ marginBottom: '20px' }}>
            <ScorecardTable
              title="Branch"
              columnLabel="Branch"
              rows={branchScorecard.rows}
              totalCount={fundedInRange.length}
              onRowClick={(row) =>
                setDrillDown({
                  metric: 'Branch',
                  context: row.label,
                  loans: loansForScorecardCut(fundedInRange, 'branch', row.key, orgRoster.aliasIndex).map(closedLoanToModalLoan),
                  hiddenColumns: ['milestone', 'status'],
                })
              }
              diagnostic={{
                count: branchScorecard.unresolvedBranches.length,
                summary: `${fmtInt(branchScorecard.unresolvedBranches.length)} branch code${
                  branchScorecard.unresolvedBranches.length === 1 ? '' : 's'
                } not recognized (still counted below)`,
                detail: `Not found in org.dim_branch: ${branchScorecard.unresolvedBranches.join(', ')}`,
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <ScorecardTable
              title="Loan Officer"
              columnLabel="Loan Officer"
              rows={loanOfficerScorecard.rows}
              totalCount={loanOfficerScorecard.diagnostics.resolvedCount}
              onRowClick={(row) =>
                setDrillDown({
                  metric: 'Loan Officer',
                  context: row.label,
                  loans: loansForScorecardCut(fundedInRange, 'loanOfficer', row.key, orgRoster.aliasIndex).map(closedLoanToModalLoan),
                  hiddenColumns: ['loanOfficer', 'milestone', 'status'],
                })
              }
              diagnostic={personDiagnosticsNote(loanOfficerScorecard)}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            {bdOwnerDataMissing ? (
              <div className="tbl-card" style={{ padding: '16px' }}>
                <div className="tbl-card__head">
                  <span className="tbl-card__title">Business Developer</span>
                </div>
                {/*
                  Etapa F7.20: mensaje explícito en vez de un scorecard vacío
                  -- un scorecard vacío se leería como "0 Business Developers
                  reales", que es un resultado distinto y falso acá. Mismo
                  criterio que el ⚠ de branches sin resolver (Parte 9):
                  decir explícito qué falta, no dejar que la ausencia hable
                  por sí sola.
                */}
                <p className="foot-note" style={{ margin: 0 }}>
                  No owner data in this snapshot — re-upload required to populate this view.
                </p>
              </div>
            ) : (
              <ScorecardTable
                title="Business Developer"
                columnLabel="Business Developer"
                rows={businessDeveloperScorecard.rows}
                totalCount={businessDeveloperScorecard.diagnostics.resolvedCount}
                onRowClick={(row) =>
                  setDrillDown({
                    metric: 'Business Developer',
                    context: row.label,
                    loans: loansForScorecardCut(fundedInRange, 'businessDeveloper', row.key, orgRoster.aliasIndex).map(closedLoanToModalLoan),
                    hiddenColumns: ['loanOfficer', 'milestone', 'status'],
                  })
                }
                diagnostic={personDiagnosticsNote(businessDeveloperScorecard)}
              />
            )}
          </div>
        </>
      )}

      {/*
        A partir de acá: gráficos adicionales que NO pedía el brief F7
        original (Rankings/Scorecards/Monthly Trends/drill-down al modal
        arriba sí lo pedían, en ese orden) -- Strategy Mix (Parte 10) es el
        primero; los que se agreguen después (Parte 11, 12...) van
        debajo de este, en el mismo bloque, nunca intercalados entre las
        secciones de arriba.
      */}
      <h4 style={{ margin: '8px 0 12px', fontSize: '15px', color: 'var(--navy)' }}>Productivity &amp; Concentration</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px' }}>
        <div>
          <DiagnosticsNote
            count={1}
            summary="Every funded loan in the selected period, split by commercial strategy."
            detail="classifyStrategy() (lib/pipeline/strategy.ts) applied directly to fundedInRange, same rule already used elsewhere in Forecast (Projected Forecast by strategy, PivotTable.tsx) -- no org dependency."
          />
          {strategyDataMissing ? (
            <div className="tbl-card" style={{ padding: '16px' }}>
              {/*
                Etapa F7.23: mismo criterio que Business Developer (F7.20) --
                un donut 100% "Own production" se leería como un resultado real
                de negocio, y acá es un default silencioso por falta de datos.
              */}
              <p className="foot-note" style={{ margin: 0 }}>
                No strategy data in this snapshot — re-upload required to populate this view.
              </p>
            </div>
          ) : (
            <div className="tbl-card" style={{ padding: '16px' }}>
              <div className="tbl-card__head">
                <span className="tbl-card__title">Strategy Mix</span>
              </div>
              <StrategyDonutChart
                rows={strategyMix}
                onSegmentClick={(row) =>
                  setDrillDown({
                    metric: 'Strategy Mix',
                    context: row.strategy,
                    loans: fundedInRange.filter((l) => classifyStrategy(l) === row.strategy).map(closedLoanToModalLoan),
                    hiddenColumns: ['milestone', 'status'],
                  })
                }
              />
            </div>
          )}
        </div>

        <div>
          <DiagnosticsNote
            count={1}
            summary="Cumulative concentration of funded loans by branch or loan officer -- bars from the same scorecards above, line shows running % of total."
            detail="Reuses branchScorecard.rows/loanOfficerScorecard.rows (already sorted desc by closedCount, buildBranchScorecard/buildLoanOfficerScorecard, lib/pipeline/scorecards.ts) -- no new grouping. Year to date mode computes its own range via getDefaultYtdSelection()/periodDateRange() (lib/pipeline/period.ts), independent of the period selector above."
          />
          {orgRoster.loading && <p className="foot-note">Loading org roster…</p>}
          {orgRoster.error && (
            <p className="pill warn" style={{ display: 'inline-flex' }}>
              Could not load org roster: {orgRoster.error}
            </p>
          )}
          {!orgRoster.loading && !orgRoster.error && (
            <div className="tbl-card" style={{ padding: '16px' }}>
              <div className="tbl-card__head">
                <span className="tbl-card__title">Pareto — Branch / Loan Officer</span>
              </div>
              <ParetoChart
                data={paretoData}
                onBarClick={(row, cut, mode) => {
                  const cutLabel = cut === 'branch' ? 'Branch' : cut === 'loanOfficer' ? 'Loan Officer' : 'Business Developer';
                  const modeLabel = mode === 'period' ? periodLabel(period) : 'Year to date';
                  const sourceLoans = mode === 'period' ? fundedInRange : ytdFunded;
                  setDrillDown({
                    metric: `Pareto — ${cutLabel} (${modeLabel})`,
                    context: row.label,
                    loans: loansForScorecardCut(sourceLoans, cut, row.key, orgRoster.aliasIndex).map(closedLoanToModalLoan),
                    hiddenColumns: cut === 'branch' ? ['milestone', 'status'] : ['loanOfficer', 'milestone', 'status'],
                  });
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/*
        Etapa F7, Parte 5: mismo modal que ya usa PivotTable -- una lista de
        loans y un título, sin nada específico de esa pantalla.

        Etapa AJUSTES-ANALYTICS-1, punto 6b: TODOS los drill-downs de esta
        pestaña son préstamos ya cerrados (fundedInRange/ytdFunded, nunca
        pipeline abierto) -- Notes no aplica a ninguno acá (a diferencia de
        Projected Forecast/Milestone, que sí la necesitan y no pasan por
        este componente con `hiddenColumns` -- ver el comentario de
        `LoanDetailModalColumn` en LoanDetailModal.tsx), así que se agrega
        'notes' UNA sola vez acá en vez de repetirlo en cada uno de los
        `setDrillDown()` de este archivo. Mismo criterio para
        showStrategyColumn/showBranchColumn: fijo en `true`, no por-llamada
        -- todas las vistas de Analytics se benefician de las mismas 2
        columnas nuevas por igual. PivotTable.tsx (el otro consumidor de
        `closedLoanToModalLoan`, para su propio drill-down de "Closed") NO
        se toca -- sigue sin pasar estos 3 props, así que sigue mostrando
        Notes y sin Strategy/Branch, exactamente como antes.
      */}
      <LoanDetailModal
        isOpen={drillDown !== null}
        onClose={() => setDrillDown(null)}
        context={drillDown?.context ?? ''}
        metric={drillDown?.metric ?? ''}
        loans={drillDown?.loans ?? []}
        hiddenColumns={drillDown ? [...drillDown.hiddenColumns, 'notes'] : undefined}
        showStrategyColumn
        showBranchColumn
      />
    </div>
  );
}
