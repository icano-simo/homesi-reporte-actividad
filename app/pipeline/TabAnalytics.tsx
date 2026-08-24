'use client';

import { useEffect, useRef, useState } from 'react';
import type { ResolvedLoan } from '@/lib/pipeline/types';
import { buildLoanProgramRanking, buildLoanTypeRanking, earliestFundedDisbursementDate, fundedLoansInRange, type RankingRow } from '@/lib/pipeline/analytics';
import {
  buildBranchScorecard,
  buildBusinessDeveloperScorecard,
  buildLoanOfficerScorecard,
  type PersonScorecardResult,
  type ScorecardRow,
} from '@/lib/pipeline/scorecards';
import { getDefaultPeriodSelection, periodDateRange, periodLabel, periodMonths, type PeriodSelection } from '@/lib/pipeline/period';
import { buildMonthlyTotals, buildMonthlyTypeBreakdown, currentYear, type MonthlyTotal, type MonthlyTypeBreakdown } from '@/lib/pipeline/trends';
import PeriodSelector from './PeriodSelector';
import { useOrgRoster, type OrgRoster } from './useOrgRoster';
import LoanDetailModal, { type LoanDetailModalColumn, type LoanDetailModalLoan } from './LoanDetailModal';
import { closedLoanToModalLoan } from './PivotTable';
import { AlertTriangleIcon } from '@/components/ui/icons';

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
                <td className="val">{fmtInt(row.count)}</td>
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
                <td className="val">{fmtInt(row.closedCount)}</td>
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
function personDiagnosticsNote(result: PersonScorecardResult): { count: number; summary: string; detail: string } {
  const { totalInput, resolvedCount, blankCount, excludedCount, unmappedCount, unmappedNames } = result.diagnostics;
  const accounted = resolvedCount + blankCount + excludedCount + unmappedCount;
  if (process.env.NODE_ENV !== 'production' && accounted !== totalInput) {
    console.warn(`[TabAnalytics] reconciliación de persona no cuadra: resolved+blank+excluded+unmapped=${accounted}, totalInput=${totalInput}`);
  }
  const problemCount = blankCount + excludedCount + unmappedCount;
  const parts: string[] = [];
  if (unmappedCount > 0) parts.push(`${fmtInt(unmappedCount)} unrecognized name${unmappedCount === 1 ? '' : 's'}`);
  if (excludedCount > 0) parts.push(`${fmtInt(excludedCount)} known non-person ${excludedCount === 1 ? 'entry' : 'entries'}`);
  if (blankCount > 0) parts.push(`${fmtInt(blankCount)} with no name recorded`);
  const summary = `${fmtInt(problemCount)} of ${fmtInt(totalInput)} loan${totalInput === 1 ? '' : 's'} could not be matched to a person (${parts.join(', ')})`;
  const detail =
    `${fmtInt(resolvedCount)} resolved via org.employee_alias` +
    (excludedCount > 0 ? `; ${fmtInt(excludedCount)} excluded via org.source_name_excluded` : '') +
    (unmappedCount > 0
      ? `; ${fmtInt(unmappedCount)} not yet in org.employee_alias: ${unmappedNames.map((u) => `${u.nameRaw} (${u.rows})`).join(', ')}`
      : '') +
    (blankCount > 0 ? `; ${fmtInt(blankCount)} with no Loan Officer/Owner value recorded` : '');
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
 * Paleta fija de colores categóricos (tokens, cero hex nuevo) para la barra
 * apilada por Loan Type -- "Sin tipo" siempre en slate (mismo criterio que
 * el resto de la app para un placeholder, nunca un color "real"), el resto
 * cicla por orden de aparición (no hay un enum fijo de loan_type).
 */
const TYPE_COLORS = ['var(--navy)', 'var(--emerald-700)', 'var(--amber-500)', 'var(--rose-700)', 'var(--sky)'];
const NO_TYPE_COLOR = 'var(--slate-400)';
const NO_TYPE_LABEL = 'Sin tipo';

/** Texto de la etiqueta dentro de cada segmento -- claro sobre navy/emerald/rose (oscuros), oscuro sobre amber/sky (claros). Mismo orden que TYPE_COLORS. */
const TYPE_TEXT_COLORS = ['var(--canvas)', 'var(--canvas)', 'var(--navy)', 'var(--canvas)', 'var(--navy)'];
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
}: {
  totals: MonthlyTotal[];
  highlightMonths: Set<string>;
  getValue: (t: MonthlyTotal) => number;
  formatValue: (n: number) => string;
  /** Texto corto sobre la barra, si difiere del formato completo (que siempre va en el tooltip). */
  formatLabel?: (n: number) => string;
  height?: number;
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
                style={{ height: Math.max(1, (value / max) * height) + 'px' }}
                title={`${shortMonth(t.month)} ${t.month.slice(0, 4)}: ${formatValue(value)}${value === 0 ? ' (no data yet)' : ''}`}
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
}: {
  breakdown: MonthlyTypeBreakdown[];
  highlightMonths: Set<string>;
  height?: number;
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
                        style={{ height: segPx + 'px', background: colorForType(t.label, allLabels) }}
                        title={`${t.label}: ${fmtInt(t.count)}`}
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
 * Placeholders de fila vacía -- MISMO texto que `NO_PROGRAM_LABEL`/
 * `NO_TYPE_LABEL` en `lib/pipeline/analytics.ts` (no exportados ahí, y ese
 * archivo está fuera del alcance de esta etapa). Duplicado a propósito
 * solo para poder re-derivar, en el click, qué loans cayeron en cada fila
 * del ranking -- si el texto del placeholder cambia algún día en
 * `analytics.ts`, este archivo hay que actualizarlo a mano también.
 */
const DRILLDOWN_NO_PROGRAM_LABEL = 'Sin programa';
const DRILLDOWN_NO_TYPE_LABEL = 'Sin tipo';

/**
 * ¿Este loan resuelve, vía `org.employee_alias`, al mismo `employeeKey` que
 * ya agrupó esa fila del scorecard? Nunca compara nombres crudos con
 * `===` -- misma regla dura que `buildPersonScorecard`
 * (lib/pipeline/scorecards.ts), reaplicada acá en el momento del click en
 * vez de modificar esa función para que devuelva el detalle.
 */
function loanResolvesToEmployeeKey(loan: ResolvedLoan, aliasIndex: OrgRoster['aliasIndex'], employeeKeyStr: string): boolean {
  const nameRaw = loan.loanOfficer.trim();
  if (!nameRaw) return false;
  const { employeeKey } = aliasIndex.lookup('salesforce', nameRaw);
  return employeeKey !== null && String(employeeKey) === employeeKeyStr;
}

/**
 * Tab 4 — Analytics (Etapa F7, Parte 1): selector de período + rankings de
 * Loan Program y Loan Type. Solo lectura sobre `pipeline_resolved_loans`
 * (status='funded', filtrado por `disbursementDate` -- nunca `estClosingDate`,
 * regla explícita del brief). No toca ninguna regla de cálculo existente:
 * pull-through, Healthy, Adverse y las estrategias comerciales quedan
 * idénticos -- esta pestaña es un corte nuevo e independiente sobre los
 * mismos datos ya cargados.
 */
export default function TabAnalytics({ resolvedLoans }: TabAnalyticsProps) {
  const [period, setPeriod] = useState<PeriodSelection>(() => getDefaultPeriodSelection());
  const orgRoster = useOrgRoster();

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
  const earliestDate = earliestFundedDisbursementDate(resolvedLoans);
  /*
   * "Nunca un total incompleto disfrazado de total completo": si el período
   * pedido empieza antes de la disbursementDate más antigua que existe en el
   * snapshot, lo que se muestra no es "todo el período", es solo la parte que
   * el historial realmente cubre -- se avisa explícito en vez de mostrar un
   * número que parece completo y no lo es.
   */
  const exceedsHistory = earliestDate !== null && range.startDate < earliestDate;

  const fundedInRange = fundedLoansInRange(resolvedLoans, range);
  const programRanking = buildLoanProgramRanking(fundedInRange);
  const typeRanking = buildLoanTypeRanking(fundedInRange);

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

  /*
   * Etapa F7, Parte 3: las tendencias son SIEMPRE del año en curso (UTC),
   * independiente del año que tenga seleccionado el período de arriba --
   * `resolvedLoans` acá es el mismo array completo (sin filtrar por
   * `fundedLoansInRange`, que solo cubre el período elegido) porque la
   * serie necesita los 12 meses del año, no solo el período seleccionado.
   */
  const trendsYear = currentYear();
  const monthlyTotals = buildMonthlyTotals(resolvedLoans, trendsYear);
  const monthlyTypeBreakdown = buildMonthlyTypeBreakdown(resolvedLoans, trendsYear);
  const highlightMonths = new Set(periodMonths(period).filter((m) => m.startsWith(String(trendsYear) + '-')));
  const trendsTotalCount = monthlyTotals.reduce((sum, t) => sum + t.count, 0);

  return (
    <>
      {/* count={1}: nota siempre visible (no es un diagnóstico condicional) -- se reusa DiagnosticsNote solo por su mecanismo de resumen breve + detalle en tooltip, mismo patrón que PersonDiagnostics. */}
      <DiagnosticsNote
        count={1}
        summary="Funded loans (Disbursement Date), grouped by Loan Program and Loan Type, for the selected period."
        detail="Read-only — doesn't affect pull-through, Healthy, Adverse, or strategy calculations elsewhere in Forecast."
      />

      <div className="control-bar" style={{ marginBottom: '16px' }}>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {exceedsHistory && (
        <p className="pill warn" style={{ marginBottom: '16px', display: 'inline-flex' }}>
          Data only goes back to {earliestDate}. {periodLabel(period)} ({range.startDate} to {range.endDate}) extends
          earlier than that — totals below cover only {earliestDate} to {range.endDate}, not the full period
          requested.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px' }}>
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
      </div>

      <h3 style={{ margin: '24px 0 12px' }}>Scorecards</h3>
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
                  loans: fundedInRange.filter((l) => l.branch === row.key).map(closedLoanToModalLoan),
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
                  loans: fundedInRange
                    .filter((l) => loanResolvesToEmployeeKey(l, orgRoster.aliasIndex, row.key))
                    .map(closedLoanToModalLoan),
                  hiddenColumns: ['loanOfficer', 'milestone', 'status'],
                })
              }
              diagnostic={personDiagnosticsNote(loanOfficerScorecard)}
            />
          </div>

          <div>
            <ScorecardTable
              title="Business Developer"
              columnLabel="Business Developer"
              rows={businessDeveloperScorecard.rows}
              totalCount={businessDeveloperScorecard.diagnostics.resolvedCount}
              onRowClick={(row) =>
                setDrillDown({
                  metric: 'Business Developer',
                  context: row.label,
                  loans: fundedInRange
                    .filter(
                      (l) => l.opportunityOwnerTitle === 'Business Developer' && loanResolvesToEmployeeKey(l, orgRoster.aliasIndex, row.key)
                    )
                    .map(closedLoanToModalLoan),
                  hiddenColumns: ['loanOfficer', 'milestone', 'status'],
                })
              }
              diagnostic={personDiagnosticsNote(businessDeveloperScorecard)}
            />
          </div>
        </>
      )}

      <h3 style={{ margin: '24px 0 12px' }}>Monthly Trends — {trendsYear}</h3>
      <DiagnosticsNote
        count={1}
        summary={`All 12 months of ${trendsYear} — months with no data yet show 0 explicitly, never omitted. The month(s) matching the period selected above are highlighted in coral.`}
        detail="Read-only, no dependency on org -- entirely from pipeline_resolved_loans."
      />

      <div ref={trendsSectionRef} className={'trend-charts' + (trendsVisible ? ' trend-charts--enter' : '')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px', marginBottom: '20px' }}>
          <div className="tbl-card" style={{ padding: '16px' }}>
            <div className="tbl-card__head">
              <span className="tbl-card__title">Closings by Month ({fmtInt(trendsTotalCount)})</span>
            </div>
            <SimpleMonthlyChart totals={monthlyTotals} highlightMonths={highlightMonths} getValue={(t) => t.count} formatValue={fmtInt} />
          </div>
          <div className="tbl-card" style={{ padding: '16px' }}>
            <div className="tbl-card__head">
              <span className="tbl-card__title">
                Amount Closed by Month ({fmtAmount(monthlyTotals.reduce((sum, t) => sum + t.amount, 0))})
              </span>
            </div>
            <SimpleMonthlyChart
              totals={monthlyTotals}
              highlightMonths={highlightMonths}
              getValue={(t) => t.amount}
              formatValue={fmtAmount}
              formatLabel={fmtAmountShort}
            />
          </div>
        </div>

        <div className="tbl-card" style={{ padding: '16px' }}>
          <div className="tbl-card__head">
            <span className="tbl-card__title">Loan Type Distribution by Month</span>
          </div>
          <TypeBreakdownChart breakdown={monthlyTypeBreakdown} highlightMonths={highlightMonths} />
        </div>
      </div>

      {/* Etapa F7, Parte 5: mismo modal que ya usa PivotTable -- una lista de loans y un título, sin nada específico de esa pantalla. */}
      <LoanDetailModal
        isOpen={drillDown !== null}
        onClose={() => setDrillDown(null)}
        context={drillDown?.context ?? ''}
        metric={drillDown?.metric ?? ''}
        loans={drillDown?.loans ?? []}
        hiddenColumns={drillDown?.hiddenColumns}
      />
    </>
  );
}
