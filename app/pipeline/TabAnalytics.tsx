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
  type RankingRow,
} from '@/lib/pipeline/analytics';
import { NO_PROGRAM_LABEL, NO_PROPERTY_STATE_LABEL, NO_TYPE_LABEL } from '@/lib/pipeline/labels';
import {
  buildBranchScorecard,
  buildBusinessDeveloperScorecard,
  buildLoanOfficerScorecard,
  UNKNOWN_PERSON_KEY,
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
import { US_MAP_VIEWBOX, US_STATE_PATHS } from '@/lib/pipeline/usStatesSvgPaths';
import { getForecastDb, isSupabaseConfigured } from '@/lib/supabase/client';
import PeriodSelector from './PeriodSelector';
import { useOrgRoster, type OrgRoster } from './useOrgRoster';
import LoanDetailModal, { type LoanDetailModalColumn, type LoanDetailModalLoan } from './LoanDetailModal';
import { closedLoanToModalLoan } from './PivotTable';
import {
  AlertTriangleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon,
  StarIcon,
  AwardIcon,
  TrendingUpIcon,
  GridIcon,
  BuildingIcon,
  FunnelIcon,
  type IconProps,
} from '@/components/ui/icons';

export interface TabAnalyticsProps {
  /** Mismo array que ya reciben PivotTable/AdverseTable -- pipeline_resolved_loans del snapshot activo, sin filtrar por canal ni por fecha todavía. */
  resolvedLoans: ResolvedLoan[];
}

/**
 * ============================================================================
 * NAV DE SECCIÓN — Etapa SECTION-NAV-1
 * ============================================================================
 *
 * 4 secciones reales de esta pestaña, en el mismo orden en que aparecen en
 * pantalla. `id` coincide EXACTO con el `id` que se le agrega al `<h3>`/`<h4>`
 * de cada sección más abajo -- es el único acoplamiento entre este array y el
 * resto del archivo, a propósito (agregar una sección nueva es agregar una
 * entrada acá + un `id` en su título, nada más).
 *
 * Íconos -- los 4 ya existían en components/ui/icons.tsx, ninguno nuevo:
 *   - TrendingUpIcon: ya usado en el nav global para "Forecast & Pipeline"
 *     (ServiceHubHeader.tsx) -- se reusa acá para "Trends" porque es el
 *     ícono correcto para el concepto, no solo el que estaba libre. Un
 *     ícono reusado en dos partes de la UI que nunca se ven una al lado de
 *     la otra (el nav global vs. esta barra, adentro de la propia página de
 *     Analytics) no genera la misma confusión que reusarlo dentro del MISMO
 *     menú.
 *   - GridIcon (antes solo para la matriz Branch x Milestone de Forecast):
 *     "Mix" son 3 rankings + un mapa en grid, layout-grid es un buen ajuste.
 *   - BuildingIcon ("vista ejecutiva por branch"): Commercial Scorecards es
 *     Branch/Loan Officer/Business Developer -- desempeño organizacional.
 *   - FunnelIcon: YA EXISTÍA en el set (no hizo falta crear ninguno nuevo,
 *     a diferencia de lo que anticipaba el brief) -- ajuste literal para
 *     "Concentration" (Pareto).
 *
 * Deliberadamente NO se reusan PieChartIcon/TargetIcon/UsersIcon/BarChartIcon:
 * esos 4 ya identifican, en el MISMO nav global (ServiceHubHeader.tsx), a
 * Analytics/Business Plan/Admin/Commercial Activity respectivamente -- reusar
 * el ícono de la propia pestaña Analytics (PieChartIcon) PARA UNA SECCIÓN
 * DENTRO de Analytics sería referirse a sí misma, y los otros 3 pertenecen a
 * un tab distinto por completo.
 */
interface AnalyticsSectionNavItem {
  id: string;
  label: string;
  Icon: (props: IconProps) => ReturnType<typeof TrendingUpIcon>;
}

const ANALYTICS_SECTIONS: AnalyticsSectionNavItem[] = [
  { id: 'analytics-section-trends', label: 'Trends', Icon: TrendingUpIcon },
  { id: 'analytics-section-mix', label: 'Mix', Icon: GridIcon },
  { id: 'analytics-section-scorecards', label: 'Scorecards', Icon: BuildingIcon },
  { id: 'analytics-section-concentration', label: 'Concentration', Icon: FunnelIcon },
];

/**
 * Scrollspy real -- mismo mecanismo (`IntersectionObserver` nativo, sin
 * librería) ya usado en esta pestaña para las animaciones de entrada
 * (`trendsSectionRef`/`trendsVisible`, más abajo en este archivo), aplicado
 * acá a las 4 secciones en vez de a una sola.
 *
 * `rootMargin: '-100px 0px -70% 0px'` crea una banda angosta cerca del
 * borde superior del viewport (empieza 100px abajo del top -- deja lugar al
 * header global sticky de 60px + esta misma barra sticky de ~46px -- y
 * termina al 30% de la altura de pantalla) -- la sección cuyo título cruza
 * esa banda mientras se hace scroll es la que se marca activa. Es el mismo
 * truco de "banda de detección" que usan los nav laterales de docs típicos
 * (Tailwind, MDN), no algo específico de este proyecto.
 *
 * Un solo componente, top-level (no una función anidada dentro de
 * `TabAnalytics`): si viviera adentro, React la trataría como un tipo de
 * componente nuevo en cada render del padre y la remontaría todo el tiempo,
 * perdiendo su estado (`activeId`) y reconectando el observer sin necesidad.
 */
function AnalyticsSectionNav() {
  const [activeId, setActiveId] = useState<string>(ANALYTICS_SECTIONS[0].id);

  useEffect(() => {
    const elements = ANALYTICS_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (!elements.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        });
      },
      { rootMargin: '-100px 0px -70% 0px', threshold: 0 }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="analytics-section-nav" aria-label="Analytics sections">
      {ANALYTICS_SECTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={'analytics-section-nav__item' + (activeId === id ? ' analytics-section-nav__item--active' : '')}
          // Etapa SECTION-NAV-1: `scrollIntoView` liso alinearía el título justo
          // contra el borde de arriba del viewport, TAPADO por el header global
          // sticky + esta misma barra -- se resuelve con `scroll-margin-top` en
          // el CSS del título (ver forecast-visual.css), no acá: es la forma
          // moderna de decirle al navegador "dejá este colchón arriba", sin
          // calcular offsets a mano ni pelear con el timing del scroll suave.
          onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <Icon size={19} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
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
 * `<td>` con gradiente en vez de un elemento nuevo. `max <= 0` (tabla
 * vacía) devuelve `{}` -- sin barra, no una división por cero silenciosa.
 *
 * Etapa FIX (hover no se veía en filas con barra) -- causa real, NO era
 * z-index/orden de capas (acá no hay ningún elemento posicionado detrás
 * ni pseudo-elemento -- el "detrás del número" es, literal, el
 * `background` de la propia `<td>`, un solo elemento). La causa real es
 * de ESPECIFICIDAD de CSS: este objeto se aplica como `style={...}`
 * inline, y antes devolvía `background: <gradiente>` -- el shorthand
 * `background` resetea TODOS sus sub-valores no mencionados a su inicial,
 * incluido `background-color: transparent`, y ese reset viaja con
 * precedencia de estilo inline (gana SIEMPRE sobre cualquier regla de
 * hoja de estilos, sin importar su especificidad de selector). Por eso
 * `tr.metric:hover td { background: rgba(166,222,255,.2) }`
 * (components.css) nunca llegaba a pintarse en estas celdas -- no es que
 * quedara tapado visualmente, es que el propio `background-color` del
 * hover perdía la cascada antes de intentar pintarse.
 *
 * Fix: se devuelve `backgroundImage` (un longhand, NO el shorthand
 * `background`) -- así `background-color` queda SIN declarar inline, y
 * la hoja de estilos (hover, zebra-striping de filas impares) vuelve a
 * poder fijarlo con normalidad; `background-image` (esta barra) se sigue
 * pintando ENCIMA de ese color, como una capa más -- ninguna de las dos
 * "tapa" a la otra, son capas independientes del mismo elemento.
 *
 * Segundo ajuste, mismo fix: el color de relleno pasa de `var(--accent-
 * soft)` (hex sólido y opaco, #eef6fd) a `rgba(166, 222, 255, 0.35)` --
 * mismo triplete RGB que ya usa el hover (166,222,255 = 'Light Sky',
 * mismo valor que --sky, hardcodeado igual en la regla de hover de
 * components.css), sólo con más alpha para seguir leyéndose clara en
 * reposo. Con un color sólido y opaco, la porción "llena" de la
 * barra habría seguido tapando el hover ahí debajo aunque
 * `background-color` cascadeara bien -- con alpha, el hover se nota
 * incluso sobre la parte llena (el azul se profundiza al pasar el mouse,
 * en vez de quedarse igual). Cero hex nuevo: mismo triplete que ya vive
 * en components.css, no un color inventado.
 */
function rankBarStyle(value: number, max: number): CSSProperties {
  if (max <= 0) return {};
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return { backgroundImage: `linear-gradient(to right, rgba(166, 222, 255, 0.35) ${pct}%, transparent ${pct}%)` };
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
   * programa"/"sin tipo", nunca se descarta uno), así que la suma de sus
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
        {/* Etapa FIX: se quita el conteo entre paréntesis del título -- confundía (ej. "Loan Program (30)" se leía como si 30 fuera un dato de programa, no el total de filas). El total sigue disponible en la fila "Total" del pie de la tabla, sin duplicarlo acá arriba. */}
        <span className="tbl-card__title">{title}</span>
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
        {/*
          Etapa FIX: se quita el conteo entre paréntesis del título -- mismo
          criterio que RankingTable. El total sigue disponible en la fila
          "Total" del pie de la tabla.

          Etapa FIX-SCORECARD-TITLES: "{title} Performance" en vez de
          "{title}" a secas -- antes repetía literal el encabezado de la
          primera columna (ej. tarjeta "Branch" con columna "Branch" debajo),
          una duplicación confusa. El `columnLabel` de la columna NO cambia
          -- ahí "Branch"/"Loan Officer"/"Business Developer" sigue siendo
          correcto, es la tarjeta la que necesitaba un nombre propio.
        */}
        <span className="tbl-card__title">{title} Performance</span>
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
          {/*
            Etapa FIX-SCORECARD-WIDTH: la columna de nombre (34%) y las 2 de
            monto (20% cada una) dejaban espacio sobrante con contenido corto
            (branch codes de 3 dígitos, montos de ~10 caracteres) -- se
            angostan las 3 (34→24, 20→16 cada una), y el ancho ganado (18%)
            se reparte hacia Closed (14→20, tiene la barra de proporción
            además del número) y % of Total (12→24, para no quedar
            apretado). `table-layout: fixed` (components.css, sin tocar) hace
            que estos % se respeten tal cual, con ellipsis + title en el
            contenido que no entre -- mismo mecanismo ya usado en toda la
            app, no uno nuevo.
          */}
          <colgroup>
            <col style={{ width: '24%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '24%' }} />
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
 * Top 3 de `rows` por `totalAmount`, en una COPIA (nunca reordena `rows` en
 * su lugar -- ScorecardTable sigue leyendo el mismo array, ordenado por
 * `closedCount`). No se puede derivar de `rows.slice(0, 3)`: `toRows()`
 * (lib/pipeline/scorecards.ts) ya ordena por `closedCount`, no por monto --
 * quién más CERRÓ no es necesariamente el top 3 en MONTO (préstamos
 * grandes vs. muchos chicos).
 */
function top3ByVolume(rows: ScorecardRow[]): ScorecardRow[] {
  return [...rows].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 3);
}

/**
 * Etapa PODIUM-3 -- el número de cada tarjeta de podio cuenta de 0 a su
 * valor real, en vez de aparecer de golpe. Dispara UNA vez cuando `start`
 * pasa a `true` -- lo dispara `ScorecardPodiumPanel` con un único
 * `IntersectionObserver` para las 6 tarjetas del panel (mismo mecanismo ya
 * usado para Monthly Trends, `trendsSectionRef`/`trendsVisible` más abajo
 * en este archivo -- un observer por SECCIÓN, no uno por número).
 *
 * `prefers-reduced-motion`: salta directo al valor final, cero frames de
 * animación -- no "más corta", ausente del todo, mismo criterio que
 * `us-map-fade-in`/`trend-grow` (CSS) aplicado acá a una animación JS.
 */
function CountUpNumber({ target, start, format }: { target: number; start: boolean; format: (n: number) => string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!start) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target);
      return;
    }
    const durationMs = 700;
    const startTime = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, target]);
  return <>{format(display)}</>;
}

/**
 * Etapa PODIUM-5 -- una tarjeta clara por métrica (Most Closings / Top by
 * Volume), con los 3 puestos como filas adentro, cada una en un tono de
 * `--navy` distinto (100%/60%/22% de opacidad, ver el CSS) -- el degradado
 * de importancia real vive en las FILAS, no en la tarjeta (la Etapa
 * PODIUM-4 tenía la tarjeta entera en navy sólido, lo que hacía que un
 * puesto 1 "también navy sólido" fuera invisible contra su propio fondo).
 *
 * El puesto 1 no lleva barra -- ES la referencia del 100%, mostrarle una
 * barra propia sería redundante. Los puestos 2 y 3 llevan barra en
 * `--coral`, con el % SIEMPRE relativo al puesto 1 de la MISMA tarjeta
 * (`value / leaderValue`) -- nunca contra el total general.
 */
function MetricPodiumCard({
  title,
  entries,
  getValue,
  format,
  start,
  showStarOnLeader,
}: {
  title: string;
  /** Top 3 ya ordenado -- índice 0 es el puesto 1. */
  entries: ScorecardRow[];
  getValue: (row: ScorecardRow) => number;
  format: (n: number) => string;
  start: boolean;
  showStarOnLeader: boolean;
}) {
  if (!entries.length) return null;
  const leaderValue = getValue(entries[0]);
  /** Tamaño del ícono de medalla por puesto -- mismo ícono (`AwardIcon`, no hay corona/trofeo en el set de íconos del proyecto y no se agregó `lucide-react` como dependencia nueva sin pedirlo explícito), diferenciado por tamaño y color en vez de forma. */
  const badgeSize: Record<1 | 2 | 3, number> = { 1: 16, 2: 13, 3: 11 };

  return (
    <div className="podium-card">
      <div className="podium-card__title">{title}</div>
      <div className="podium-card__rows">
        {entries.map((row, i) => {
          const rank = (i + 1) as 1 | 2 | 3;
          const value = getValue(row);
          const percent = leaderValue > 0 ? (value / leaderValue) * 100 : 0;
          /**
           * FIX-SCORECARD-TIEBREAK: `toRows()` ya desempata por monto, pero
           * eso resuelve el ORDEN, no el hecho de que la métrica que este
           * podio dice medir sigue empatada -- "1° con 5 closed" no dice que
           * otros 2 branches también tienen 5. Se avisa cuando el valor
           * coincide con la fila anterior o con el líder (para el puesto 1
           * no aplica: no hay fila anterior, y compararlo contra sí mismo no
           * significa nada).
           */
          const isTied = i > 0 && (value === getValue(entries[i - 1]) || value === leaderValue);
          return (
            <div key={row.key} className={`podium-card__row podium-card__row--rank${rank}`}>
              <span className="podium-card__badge">
                <AwardIcon size={badgeSize[rank]} />
              </span>
              {isTied && <span className="podium-card__tied">(tied)</span>}
              <div className="podium-card__row-body">
                <div className="podium-card__name" title={row.label}>
                  {row.label}
                  {rank === 1 && showStarOnLeader && (
                    <span className="podium-card__star" title="Leads both podiums">
                      <StarIcon size={19} />
                    </span>
                  )}
                </div>
                <div className="podium-card__value">
                  <CountUpNumber target={value} start={start} format={format} />
                </div>
                {/* FIX-PODIUM-BAR-RANK1: el puesto 1 también lleva barra -- `percent` para ese puesto ya da 100 (value === leaderValue), así que no hace falta ningún caso especial, solo dejar de ocultarla. Completa la estructura (badge + nombre + valor + barra) igual en las 3 filas. */}
                <div className="podium-card__bar">
                  <div className="podium-card__bar-fill" style={{ width: `${percent}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Panel al lado de cada Commercial Scorecard: las 2 `MetricPodiumCard`
 * (Most Closings / Top by Volume) lado a lado. `null` si `rows` está
 * vacío -- mismo criterio que el resto de la capa, ningún podio con un
 * ganador inventado sobre cero datos. El early return va DESPUÉS de los
 * hooks (Rules of Hooks) -- se llaman siempre, el bail solo afecta qué se
 * renderiza.
 */
function ScorecardPodiumPanel({ rows }: { rows: ScorecardRow[] }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries, obs) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!rows.length) return null;

  const top3Closings = rows.slice(0, 3);
  const top3Volume = top3ByVolume(rows);
  /** Mismo `key` en el puesto 1 de las 2 métricas -- comparar 2°/3° entre listas distintas no tiene el mismo significado ("líder de ambos podios" solo aplica al puesto 1 de cada uno). */
  const sameWinner = top3Closings[0].key === top3Volume[0].key;

  return (
    <div ref={panelRef} className={'scorecard-podium-panel' + (visible ? ' scorecard-podium-panel--enter' : '')}>
      <MetricPodiumCard
        title="Most Closings"
        entries={top3Closings}
        getValue={(row) => row.closedCount}
        format={fmtInt}
        start={visible}
        showStarOnLeader={sameWinner}
      />
      <MetricPodiumCard
        title="Top by Volume"
        entries={top3Volume}
        getValue={(row) => row.totalAmount}
        format={(n) => '$' + fmtAmount(n)}
        start={visible}
        showStarOnLeader={sameWinner}
      />
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
    /*
     * Hotfix loan-officer-null: estos loans ya no se descartan de la tabla --
     * se agrupan en su propia fila visible ("Unknown Loan Officer"/"Unknown
     * Business Developer"). El ícono de advertencia se mantiene igual porque
     * la fila por sí sola no explica POR QUÉ falta el nombre (un problema de
     * datos en el origen que hay que corregir en Salesforce), solo que
     * existe -- el tooltip sigue siendo la única explicación de fondo.
     */
    detailParts.push(
      `${fmtInt(blankCount)} with no Loan Officer/Owner value recorded -- shown as their own row instead of being excluded.`
    );
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

/*
 * ⚠ Acá vivían dos copias a mano de los placeholders de fila vacía, con un
 * comentario que declaraba la duplicación y pedía mantenerlas sincronizadas.
 * Ahora las tres se importan de `lib/pipeline/labels.ts`, que es su única
 * definición -- ver la cabecera de ese archivo. El drill-down compara POR
 * TEXTO contra `row.label`, así que dos copias que se separan dejan la fila
 * visible y el detalle vacío, sin error y sin aviso.
 */

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
  // Hotfix loan-officer-null: la fila "Unknown Loan Officer"/"Unknown
  // Business Developer" (buildPersonScorecard, lib/pipeline/scorecards.ts)
  // agrupa justamente los loans con nombre vacío -- son estos los que debe
  // abrir su drill-down, no los que resuelven contra el alias index (que
  // nunca incluye un nombre vacío).
  if (employeeKeyStr === UNKNOWN_PERSON_KEY) return !nameRaw;
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

/** Mismo criterio que `loansForMonth`, más el tipo de préstamo -- para el drill-down por segmento de Loan Type Distribution by Month. `NO_TYPE_LABEL` (lib/pipeline/labels.ts) es el mismo placeholder que ya usa `buildMonthlyTypeBreakdown` -- tienen que ser el mismo texto o la fila queda visible con el detalle vacío (ver el comentario de labels.ts). */
function loansForMonthAndType(loans: ResolvedLoan[], month: string, typeLabel: string): ResolvedLoan[] {
  return loansForMonth(loans, month).filter((l) => (l.loanType.trim() || NO_TYPE_LABEL) === typeLabel);
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
 * Etapa FIX-STRATEGY-COLORS, revertida parcialmente -- la versión anterior
 * de este fix ciclaba solo los 3 colores oficiales de marca
 * (`navy`/`coral`/`sky`, `tokens.css`), repitiendo 2 pares (Own production/
 * Recruitment ambas navy; B2B/NPPM ambas coral) para evitar cualquier color
 * semántico de estado. Confirmado por diagnóstico previo: `tokens.css` no
 * tiene NINGUNA variante clara/oscura de esos 3 (ni `--navy-*`, ni
 * `--coral-*`, ni `--sky-*`) -- solo 3 tonos de marca en total, cero techo
 * más alto sin inventar un hex nuevo.
 *
 * Se vuelve a 5 colores distintos, uno por estrategia -- los 3 de marca para
 * las 3 estrategias MÁS frecuentes (mismo orden de `STRATEGY_ORDER`, que ya
 * es de mayor a menor volumen, ver su comentario en lib/pipeline/strategy.ts),
 * y 2 tonos SEMÁNTICOS ya existentes -- pero deliberadamente los más SUTILES
 * de sus escalas, no los más saturados/brillantes ya reservados para
 * indicadores de estado real en otras partes de la app:
 *
 *   - `--emerald-700` (#047857, verde oscuro apagado) para Recruitment --
 *     mismo tono ya usado en la app (ClosedValue y similares), pero acá sin
 *     significado de "positivo": es solo la 4ta categoría del donut.
 *   - `--amber-700` (#b45309, ocre/marrón apagado) para NPPM, NO
 *     `--amber-500` (#f59e0b, dorado vibrante) -- ese es el tono que sí usa
 *     el chip "Transferred" de Forecast con significado de advertencia real;
 *     `--amber-700` es la variante deliberadamente menos saturada de la
 *     misma escala, para que compita menos con navy/coral/sky.
 *
 * Deliberadamente se evita toda la familia `--rose-*` (`--rose-700`
 * #be123c): es roja, igual que `--coral` (#ff4040) -- confundiría la
 * estrategia de ese color con el resaltado de mes seleccionado que ya usa
 * `--coral` en Monthly Trends (`.trend-chart__col--highlight .trend-chart__bar`,
 * forecast-visual.css), y encima es el color reservado para "negativo/riesgo"
 * en el resto de la app.
 */
const STRATEGY_COLORS: Record<Strategy, string> = {
  'Own production': 'var(--navy)',
  B2B: 'var(--coral)',
  Affinity: 'var(--sky)',
  Recruitment: 'var(--emerald-700)',
  NPPM: 'var(--amber-700)',
};

function colorForStrategy(strategy: Strategy): string {
  return STRATEGY_COLORS[strategy];
}

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
            stroke={colorForStrategy(segments[0].row.strategy)}
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
                stroke={colorForStrategy(row.strategy)}
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
                background: colorForStrategy(row.strategy),
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
 * Etapa FIX-PARETO-LABELS -- reemplaza el corte de AJUSTES-ANALYTICS-1
 * punto 7: ese fix ya había notado que ocultar etiquetas por completo más
 * allá de un número fijo (8, o incluso "sólo si el total pasa de 15")
 * seguía dejando categorías reales sin nombre visible en ningún lado del
 * eje (YTD con 37+ Loan Officers, caso reportado). Se quita el ocultamiento
 * por completo: TODAS las barras llevan nombre y número, siempre.
 *
 * Lo que evitaba el ocultamiento -- que dos etiquetas rotadas se
 * superpongan -- pasa a resolverse por RECORTE (`truncateParetoLabel`,
 * abajo) en vez de por omisión: con la rotación -45° ya existente,
 * `barWidth + gap` (36px) es la distancia FIJA entre anclas de texto
 * consecutivas, sin importar cuántas categorías haya (`plotWidth` crece
 * con el total, el espacio POR barra no se achica) -- así que el largo
 * máximo seguro de una etiqueta es una constante, no algo que dependa de
 * `total`.
 */
const PARETO_LABEL_MAX_CHARS = 10;

/**
 * Recorte estimado por caracteres, no por medición real de texto -- no hay
 * `getBBox`/`canvas.measureText` disponible en este render (ningún otro
 * chart de la app mide texto tampoco). A 9px de fuente sans-serif, ~5.5px
 * por caracter; rotado -45°, la proyección horizontal es ×cos(45°) ≈ 3.9px
 * por caracter. Con 36px de presupuesto por barra y margen de seguridad,
 * ~10 caracteres es el techo antes de arriesgar que la etiqueta de una
 * barra invada el espacio de la anterior. El nombre completo sigue
 * disponible en el tooltip (`<title>`) de la barra, el punto, y la propia
 * etiqueta -- el recorte es solo del texto visible en el eje.
 */
function truncateParetoLabel(label: string): string {
  if (label.length <= PARETO_LABEL_MAX_CHARS) return label;
  return label.slice(0, PARETO_LABEL_MAX_CHARS - 1) + '…';
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
 * reales), TODAS llevan número sobre la barra y nombre en el eje (Etapa
 * FIX-PARETO-LABELS) -- los nombres largos se recortan con "…"
 * (`truncateParetoLabel`) para que la rotación -45° no las haga
 * solaparse entre sí, en vez de ocultar categorías enteras. Ninguna
 * categoría se omite del chart -- todas tienen su barra, su número, su
 * nombre (recortado o no) y su punto, con el nombre completo siempre
 * disponible por tooltip.
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
              {/* Número sobre la barra -- mismo patrón que Closings by Month -- ahora en TODAS las barras (Etapa FIX-PARETO-LABELS). */}
              {rows.map((r, i) => (
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
              ))}
              {/* Nombre rotado -45° -- TODAS las barras (Etapa FIX-PARETO-LABELS), recortado si es largo (truncateParetoLabel) para que no se solape con la etiqueta vecina; <title> propio para el nombre completo si el mouse pasa justo sobre el texto y no sobre la barra/punto. */}
              {rows.map((r, i) => (
                <text
                  key={r.label + '-lbl'}
                  x={xCenter(i)}
                  y={plotHeight + 14}
                  textAnchor="end"
                  fontSize="9"
                  fill="var(--slate-500)"
                  transform={`rotate(-45 ${xCenter(i)} ${plotHeight + 14})`}
                >
                  {truncateParetoLabel(r.label)}
                  <title>{r.label}</title>
                </text>
              ))}
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
 * MAPA DE EE.UU. — Property State
 * ============================================================================
 *
 * Etapa MAP-PREVIEW-1: nació como una prueba visual aparte, sin tocar la
 * tabla "Subject Property State" que existía entonces. Etapa
 * FIX-REMOVE-PROPERTY-STATE-TABLE: esa tabla se retiró (este componente ya
 * cubre la misma información -- State/Count/Amount + Total + drill-down),
 * y este mapa pasó a ser la única pieza de "Geography" de Product Mix &
 * Geography, dentro de esa sección (ya no al final de la pestaña).
 *
 * Misma fuente de datos (`propertyStateRanking`, ya filtrada por
 * período/branch por construcción, igual que toda la pestaña) -- ningún
 * cálculo nuevo.
 *
 * Geometría real de los 50 estados + DC (`lib/pipeline/usStatesSvgPaths.ts`,
 * adaptado del mapa en blanco de Wikipedia/Wikimedia Commons, dominio
 * público -- ver el comentario de ese archivo). Un solo `<svg>` con un
 * `<path>` por estado, coloreado según los datos reales del período activo:
 *
 *   - Sin datos ese período: `--slate-200` PLANO, sin opacidad -- gris casi
 *     invisible, igual en TODOS los estados sin datos (grupo 1).
 *   - Con datos: interpolación RGB real entre `--sky` (166,222,255) y
 *     `--navy` (0,26,64) -- los mismos 2 valores numéricos que YA existen en
 *     `tokens.css`, no hex nuevo, solo leídos y mezclados en vez de usados
 *     sueltos. Etapa anterior de este mismo mapa usaba opacidad sobre un
 *     solo color (`--navy` @ 25-100%) -- confirmado en pantalla que eso NO
 *     daba contraste real contra el gris (ambos quedaban en un gris/azul
 *     parecido a baja opacidad). Interpolar 2 colores en vez de graduar la
 *     opacidad de 1 solo garantiza que el estado con MENOS volumen siga
 *     siendo un azul reconocible (`--sky`), nunca un gris disfrazado.
 *   - Escala RELATIVA al min/max de ESTE período (`blendSkyToNavy`, abajo):
 *     con Selected period (rango real 1-7) y con YTD (rango real 1-87) el
 *     mismo estado puede pintarse distinto, a propósito -- la intensidad
 *     siempre se lee contra el resto de los datos QUE SE ESTÁN MOSTRANDO.
 *     Se recalcula solo -- `rows` cambia cuando cambia el período/branch
 *     (mismo prop que ya recibe `RankingTable`), sin estado ni efecto propio.
 */
const US_MAP_SKY_RGB: [number, number, number] = [166, 222, 255];
const US_MAP_NAVY_RGB: [number, number, number] = [0, 26, 64];
/**
 * Etapa FIX-MAP-2: el máximo real (`t=1`, --navy puro, RGB casi 0,0,0 en la
 * práctica) se veía casi negro -- reportado en pantalla. Se tapa el camino
 * en 78% en vez de 100%: el estado de MÁS volumen llega a un azul marino
 * oscuro todavía reconocible como azul, nunca al extremo casi negro de
 * `--navy` puro. El mínimo (`t=0`, `--sky` puro) no cambia.
 */
const US_MAP_MAX_BLEND = 0.78;

function blendSkyToNavy(count: number, minCount: number, maxCount: number): string {
  const tRaw = maxCount === minCount ? 1 : (count - minCount) / (maxCount - minCount);
  const t = tRaw * US_MAP_MAX_BLEND;
  const [r1, g1, b1] = US_MAP_SKY_RGB;
  const [r2, g2, b2] = US_MAP_NAVY_RGB;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * FIX-MAP-LEGEND-TOOLTIP: código -> nombre completo del estado, para el
 * `title` nativo de la leyenda. Reusa `US_STATE_PATHS` (lib/pipeline/
 * usStatesSvgPaths.ts, ya importado para dibujar el mapa) -- ese archivo
 * YA tiene los 51 pares código/nombre reales (confirmado: "CO" ->
 * "Colorado", etc.), así que no hace falta un diccionario nuevo duplicado.
 * `Map` construido UNA sola vez a nivel de módulo (no adentro de
 * `PropertyStateMap`, que se re-renderiza en cada cambio de período/branch)
 * -- `US_STATE_PATHS` es una constante estática, nunca cambia en runtime.
 */
const US_STATE_NAME_BY_CODE = new Map(US_STATE_PATHS.map((s) => [s.code, s.name]));

function PropertyStateMap({
  rows,
  onStateClick,
}: {
  rows: RankingRow[];
  /** `undefined` en un estado sin datos -- ese caso nunca es clickeable, sin importar si el caller pasa la prop. */
  onStateClick?: (row: RankingRow) => void;
}) {
  const byCode = new Map(rows.filter((r) => r.label !== NO_PROPERTY_STATE_LABEL && r.count > 0).map((r) => [r.label, r]));
  const counts = [...byCode.values()].map((r) => r.count);
  const minCount = counts.length ? Math.min(...counts) : 0;
  const maxCount = counts.length ? Math.max(...counts) : 0;
  /** Etapa FIX-MAP-2: orden desc por count (mismo criterio que ya usaba la tabla "Subject Property State" antes de retirarse, Etapa FIX-REMOVE-PROPERTY-STATE-TABLE) -- la leyenda es un resumen, no una fuente de verdad con su propio criterio de orden. */
  const legendRows = [...byCode.values()].sort((a, b) => b.count - a.count);
  /** Etapa FIX-MAP-4: suma de los estados LISTADOS en la leyenda (no de `rows` completo) -- es un total de "lo que se ve acá", no una segunda fuente de verdad con su propio universo. */
  const legendTotalCount = legendRows.reduce((sum, r) => sum + r.count, 0);
  const legendTotalAmount = legendRows.reduce((sum, r) => sum + r.amount, 0);

  return (
    // Etapa FIX-MAP-3: mapa + leyenda lado a lado, columnas de flexbox --
    // reemplaza el `position: relative`/leyenda superpuesta de FIX-MAP-2
    // (tapaba estados del mapa que quedaban debajo). `flex-basis` en % en
    // vez de `width` fijo: las 2 columnas siguen siendo proporcionales si
    // la tarjeta se angosta (viewport chico), sin desbordar.
    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
      <div style={{ flex: '0 1 68%', minWidth: 0 }}>
        <svg
          viewBox={US_MAP_VIEWBOX}
          role="img"
          aria-label="Funded loans by property state"
          className="us-map-svg"
          style={{ width: '100%', height: 'auto' }}
        >
          {US_STATE_PATHS.map((state) => {
            const row = byCode.get(state.code);
            const clickable = row !== undefined && Boolean(onStateClick);
            return (
              <path
                key={state.code}
                d={state.d}
                stroke="var(--canvas)"
                strokeWidth={0.75}
                fill={row ? blendSkyToNavy(row.count, minCount, maxCount) : 'var(--slate-200)'}
                className={'us-map-state' + (clickable ? ' us-map-state--clickable' : '')}
                onClick={clickable ? () => onStateClick!(row!) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
              >
                <title>
                  {row
                    ? `${state.name}: ${fmtInt(row.count)} loan${row.count === 1 ? '' : 's'}, $${fmtAmount(row.amount)}`
                    : `${state.name}: no funded loans in this period`}
                </title>
              </path>
            );
          })}
        </svg>
      </div>
      {/*
        Etapa FIX-MAP-3: columna propia (30-35% del ancho, ~32% acá), ya no
        superpuesta -- encabezados "State/Count/Amount" (mismo texto que la
        tabla grande de arriba, `columnLabel="State"` + "Count"/"Amount")
        para que se lea como un resumen de la MISMA tabla, no una leyenda
        con su propio vocabulario. Cada fila reusa el mismo `onStateClick`
        que ya recibe el `<path>` de ese estado -- ningún handler nuevo, el
        mismo drill-down sin importar si se hizo click en el mapa o en la
        fila. Solo los estados CON datos reales (`legendRows`).
      */}
      {legendRows.length > 0 && (
        <div style={{ flex: '0 1 32%', minWidth: 0 }} className="us-map-legend">
          <div className="us-map-legend__row us-map-legend__row--header">
            <span className="us-map-legend__swatch" style={{ background: 'transparent' }} />
            <span className="us-map-legend__label">State</span>
            <span className="us-map-legend__count">Count</span>
            <span className="us-map-legend__amount">Amount</span>
          </div>
          {legendRows.map((row) => {
            const clickable = Boolean(onStateClick);
            return (
              <div
                key={row.label}
                className={'us-map-legend__row' + (clickable ? ' us-map-legend__row--clickable' : '')}
                onClick={clickable ? () => onStateClick!(row) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
              >
                <span
                  className="us-map-legend__swatch"
                  style={{ background: blendSkyToNavy(row.count, minCount, maxCount) }}
                />
                {/* FIX-MAP-LEGEND-TOOLTIP: `row.label` es el código de 2 letras -- `title` nativo con el nombre completo, mismo mecanismo de tooltip ya usado en otras columnas truncadas de la app (ej. `title={row.label}` en `ScorecardTable`, más arriba en este archivo). `?? row.label` es un respaldo defensivo, nunca debería faltar: los códigos que puede traer `row.label` acá son exactamente los 51 de `US_STATE_PATHS` (es el mismo `state.code` que ya usa el mapa para pintar), nunca uno fuera de esa lista. */}
                <span className="us-map-legend__label" title={US_STATE_NAME_BY_CODE.get(row.label) ?? row.label}>
                  {row.label}
                </span>
                {/* Etapa FIX-MAP-LEGEND-BAR: misma barra de proporción detrás del label que ya usan Loan Program/Loan Type (rankBarStyle, RankingTable más arriba) -- acá contra `maxCount` (el máximo real entre los estados CON datos, ya calculado arriba para el color del mapa), no contra el total general. */}
                <span className="us-map-legend__count" style={rankBarStyle(row.count, maxCount)}>
                  {fmtInt(row.count)}
                </span>
                {/* Etapa FIX-MAP-4: monto completo (fmtAmount), no fmtAmountShort -- se pidió el numero real, no una version redondeada a "M"/"K". */}
                <span className="us-map-legend__amount">${fmtAmount(row.amount)}</span>
              </div>
            );
          })}
          <div className="us-map-legend__row us-map-legend__row--total">
            <span className="us-map-legend__swatch" style={{ background: 'transparent' }} />
            <span className="us-map-legend__label">Total</span>
            <span className="us-map-legend__count">{fmtInt(legendTotalCount)}</span>
            <span className="us-map-legend__amount">${fmtAmount(legendTotalAmount)}</span>
          </div>
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
   * `branchFilteredLoans` es el ÚNICO punto de filtrado: todo lo que antes
   * leía `resolvedLoans` directo (fundedInRange, previousFunded,
   * previousFullFunded, ytdFunded, earliestDate, monthlyTotals,
   * monthlyTypeBreakdown) pasa a leer esto -- así el filtro alcanza a las 4
   * capas completas (Hero KPI, Monthly Trends, Product Mix, Scorecards/
   * Pareto) por construcción, sin tener que acordarse de aplicarlo en cada
   * cálculo por separado.
   */
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const branchFilteredLoans = selectedBranch === 'ALL' ? resolvedLoans : resolvedLoans.filter((l) => l.branch === selectedBranch);

  /**
   * Etapa FIX (selector de Branch limitado a los branches que estudia
   * Forecast) -- `resolvedLoans` trae CUALQUIER branch con historial en
   * `pipeline_resolved_loans` (confirmado con datos reales: 23 branches
   * distintos hoy, incluye códigos fuera de división, ej. '913'). El
   * roster real de branches que Forecast estudia es
   * `pipeline_forecast.branches` (columna `code`) -- la MISMA tabla que ya
   * consulta `app/pipeline/page.tsx` (`knownBranches`, usada en
   * `PivotTable.tsx` para no mostrar filas fantasma de branches sin
   * actividad real). Se replica acá el mismo patrón de acceso EXACTO
   * (`getForecastDb()` -- mismo cliente con sesión, mismo schema, mismo
   * `.from('branches').select('code')`, cargado una sola vez al montar) en
   * vez de inventar un mecanismo nuevo -- mismo criterio arquitectónico
   * que ya sigue `useOrgRoster()` (hook propio de esta pestaña, sin pasar
   * por `app/analytics/page.tsx`): `TabAnalytics.tsx` ya es
   * "prácticamente standalone" (ver la nota de ANALYTICS-TAB-1 en ese
   * archivo), así que no hace falta tocar la página wrapper para agregar
   * una fuente de datos más.
   *
   * `forecastBranchCodes` vacío (todavía no cargó, o falló) deja
   * `availableBranches` vacío -- mismo criterio conservador que ya usa
   * `knownBranches` en PivotTable.tsx ("si falla, se deja su estado
   * vacío, [el consumidor] ya maneja el caso sin romper la página"): un
   * selector con solo "All branches" mientras carga es preferible a
   * mostrar de nuevo, aunque sea un instante, branches fuera de división.
   */
  const [forecastBranchCodes, setForecastBranchCodes] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    getForecastDb()
      .from('branches')
      .select('code')
      .then(({ data, error }) => {
        if (error || !data) return;
        setForecastBranchCodes(new Set((data as { code: string }[]).map((row) => row.code)));
      });
  }, []);

  /**
   * Etapa FIX-SCORECARD-BRANCH-FILTER -- `buildBranchScorecard` arma una
   * fila por CADA branch presente en los loans que recibe, sin filtrar
   * (confirmado en su propio comentario, `lib/pipeline/scorecards.ts`:
   * "nunca para descartar un loan"). La tabla de Branch (y el corte
   * "Branch" de Pareto, que reusa `branchScorecard.rows`/
   * `ytdBranchScorecard.rows` sin recalcular nada) mostraba entonces
   * CUALQUIER branch con datos -- el mismo tipo de fuga que ya se corrigió
   * para el selector de arriba (`availableBranches`), pero sin filtrar acá.
   *
   * Se filtra ANTES de construir el scorecard, con la MISMA fuente
   * dinámica que ya usa el selector -- `forecastBranchCodes`, cargada en
   * tiempo real contra `pipeline_forecast.branches` (ver el `useEffect` de
   * arriba) -- nunca una lista escrita a mano. Si mañana se agrega o quita
   * un branch de esa tabla, esta tabla lo refleja solo con el próximo
   * fetch, sin tocar código. Mientras `forecastBranchCodes` no cargó
   * (todavía vacío), el filtro deja la tabla vacía en vez de mostrar
   * branches sin confirmar -- mismo criterio conservador que
   * `availableBranches`.
   */
  function filterToForecastBranches(loans: ResolvedLoan[]): ResolvedLoan[] {
    return loans.filter((l) => forecastBranchCodes.has(l.branch));
  }

  /**
   * `availableBranches` es la INTERSECCIÓN de "branches con préstamos en
   * este snapshot" y "branches que Forecast estudia" (`forecastBranchCodes`)
   * -- se calcula sobre `resolvedLoans` SIN filtrar por el branch ya
   * elegido, el <select> debe listar siempre todas las opciones válidas,
   * no solo la actual (mismo criterio que `availableBranches` en
   * page.tsx, que tampoco se recalcula sobre el subconjunto ya filtrado).
   */
  const availableBranches = [...new Set(resolvedLoans.map((l) => l.branch))]
    .filter(Boolean)
    .filter((b) => forecastBranchCodes.has(b))
    .sort();

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

  const branchScorecard = buildBranchScorecard(filterToForecastBranches(fundedInRange), orgRoster.knownBranchCodes);
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
  const ytdBranchScorecard = buildBranchScorecard(filterToForecastBranches(ytdFunded), orgRoster.knownBranchCodes);
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
        NAV DE SECCIÓN -- Etapa SECTION-NAV-1
        ==========================================================================
        Barra sticky con las 4 secciones de esta pestaña (table of contents),
        justo debajo del Hero KPI y arriba de Monthly Trends -- nunca antes
        del Hero KPI, para no competir con él por atención. Scrollspy real
        (`AnalyticsSectionNav`, definido arriba en este archivo) contra los 4
        `id` de sección que se agregan más abajo junto a cada título.
      */}
      <AnalyticsSectionNav />

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
      <h3 id="analytics-section-trends" style={{ margin: '24px 0 12px' }}>
        Monthly Trends — {trendsYear}
      </h3>
      <DiagnosticsNote
        count={1}
        summary={`All 12 months of ${trendsYear} — months with no data yet show 0 explicitly, never omitted. The month(s) matching the period selected above are highlighted in coral.`}
        detail="These totals don't depend on branch or officer name matching, so they're always available even if that roster fails to load elsewhere on this page."
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
              detail="Calculated from the same monthly totals shown in the Closings and Amount charts above -- shows 0 for any month with no closings, not an error."
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
        Etapa FIX-REMOVE-PROPERTY-STATE-TABLE: la tabla "Subject Property
        State" (RankingTable) se retira -- el mapa (`PropertyStateMap`, con
        su leyenda State/Count/Amount + fila Total + drill-down por clic)
        cubre exactamente la misma información, ahora también con la barra
        de proporción que tenía la tabla (ver el ajuste dentro de
        `PropertyStateMap`). Mostrar las dos era mantener dos fuentes
        visuales de un mismo dato -- el riesgo de que se desincronicen a
        futuro (una se actualiza, la otra no) sin ganar nada a cambio.
        Confirmado por grep que ninguna otra parte del archivo usa esa
        instancia específica de RankingTable -- `propertyStateRanking` (el
        dato) SIGUE existiendo, lo sigue leyendo el mapa más abajo.
        `propertyStateDataMissing` también sigue existiendo -- lo usa el
        gate del mapa, que ya tenía su propio mensaje (no dependía del de
        la tabla).
        El mapa, que antes vivía solo al final de la pestaña como "preview"
        aparte (sin tocar la tabla, etapa original), se MUEVE acá adentro
        -- es la pieza real de "Geography" del nombre de esta capa, tiene
        sentido que viva en su sección, no después de Commercial Scorecards
        y Productivity & Concentration.
        Grid: de 3 columnas parejas (Program/Type/State) a 2 (Program/Type
        únicamente) -- el mapa necesita mucho más ancho que un tercio de
        columna para que el mapa+leyenda (68%/32% interno) se lea bien, así
        que pasa a fila completa (`gridColumn: '1 / -1'`), igual que Loan
        Type Distribution by Month.
      */}
      <h3 id="analytics-section-mix" style={{ margin: '24px 0 12px' }}>
        Product Mix &amp; Geography
      </h3>
      {/* count={1}: nota siempre visible (no es un diagnóstico condicional) -- se reusa DiagnosticsNote solo por su mecanismo de resumen breve + detalle en tooltip, mismo patrón que PersonDiagnostics. Mismo texto de siempre -- sólo se movió acá, junto a los rankings que describe (antes vivía arriba de todo, separada de su contenido). */}
      <DiagnosticsNote
        count={1}
        summary="Funded loans (Disbursement Date), grouped by Loan Program, Loan Type, and Subject Property State, for the selected period."
        detail="This breakdown is independent of the pull-through, Healthy, and Adverse figures shown elsewhere in Forecast -- viewing it doesn't change any of those numbers."
      />

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
                .filter((l) => (l.loanProgram.trim() || NO_PROGRAM_LABEL) === row.label)
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
                .filter((l) => (l.loanType.trim() || NO_TYPE_LABEL) === row.label)
                .map(closedLoanToModalLoan),
              hiddenColumns: ['loanType', 'milestone', 'status'],
            })
          }
        />

        {propertyStateDataMissing ? (
          <div className="tbl-card" style={{ padding: '16px', gridColumn: '1 / -1' }}>
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
          <div className="tbl-card us-map-fade-in" style={{ padding: '16px', gridColumn: '1 / -1' }}>
            <div className="tbl-card__head">
              <span className="tbl-card__title">Subject Property State</span>
            </div>
            <PropertyStateMap
              rows={propertyStateRanking}
              onStateClick={(row) =>
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
          </div>
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
        CAPA 4 — COMMERCIAL SCORECARDS (reorganizada, mismo contenido)
        ==========================================================================
        Scorecards (Branch/Loan Officer/Business Developer) sin cambios --
        son la mitad "Commercial Scorecards" del nombre de esta capa. Debajo,
        Strategy Mix + Pareto se agrupan visualmente en una sola sub-sección
        ("Productivity & Concentration", pedido explícito del brief) en vez
        de quedar como 2 secciones sueltas -- mismo grid de 2 columnas que
        ya usa Capa 3, ningún componente nuevo.

        Etapa FIX: el título de la capa pasa de "Commercial Scorecards &
        Pareto" a "Commercial Scorecards" a secas -- el Pareto ya tiene su
        propio subtítulo debajo ("Productivity & Concentration"),
        mencionarlo también acá arriba era una duplicación confusa (dos
        nombres para la misma sección, uno más específico que el otro).
      */}
      <h3 id="analytics-section-scorecards" style={{ margin: '24px 0 12px' }}>
        Commercial Scorecards
      </h3>
      <DiagnosticsNote
        count={1}
        summary="Branch, Loan Officer, and Business Developer are matched against the company roster, so name variants are combined."
        detail="Name variants -- different spellings or nicknames across systems -- are matched through the company roster, not simple text comparison, so the same person is never split into two rows."
      />

      {orgRoster.loading && <p className="foot-note">Loading org roster…</p>}
      {orgRoster.error && <p className="pill warn" style={{ display: 'inline-flex' }}>Could not load org roster: {orgRoster.error}</p>}

      {!orgRoster.loading && !orgRoster.error && (
        // Etapa PODIUM-2: vuelve al layout apilado original (una sección
        // debajo de otra, no lado a lado) -- pero CADA sección es ahora su
        // propio grid de 2 columnas, tabla ancha (~75%) + panel de podios
        // angosto (~25%) a la derecha, en vez de tabla sola a lo ancho.
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.1fr) minmax(0, 1fr)', gap: '20px', marginBottom: '20px' }}>
            <ScorecardTable
              title="Branch"
              columnLabel="Branch"
              rows={branchScorecard.rows}
              totalCount={filterToForecastBranches(fundedInRange).length}
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
            <ScorecardPodiumPanel rows={branchScorecard.rows} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.1fr) minmax(0, 1fr)', gap: '20px', marginBottom: '20px' }}>
            <ScorecardTable
              title="Loan Officer"
              columnLabel="Loan Officer"
              rows={loanOfficerScorecard.rows}
              // Hotfix loan-officer-null: `rows` ahora incluye la fila "Unknown
              // Loan Officer" además de las resueltas -- el total de
              // reconciliación tiene que crecer con ella o el chequeo de
              // ScorecardTable (rowsTotalCount !== totalCount) avisaría un
              // falso descuadre en dev.
              totalCount={loanOfficerScorecard.diagnostics.resolvedCount + loanOfficerScorecard.diagnostics.blankCount}
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
            <ScorecardPodiumPanel rows={loanOfficerScorecard.rows} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.1fr) minmax(0, 1fr)', gap: '20px', marginBottom: '24px' }}>
            {bdOwnerDataMissing ? (
              <div className="tbl-card" style={{ padding: '16px' }}>
                <div className="tbl-card__head">
                  {/* Etapa FIX-SCORECARD-TITLES: mismo nombre que la variante con datos (ScorecardTable) -- es la misma tarjeta, solo su estado vacío. */}
                  <span className="tbl-card__title">Business Developer Performance</span>
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
              <>
                <ScorecardTable
                  title="Business Developer"
                  columnLabel="Business Developer"
                  rows={businessDeveloperScorecard.rows}
                  // Hotfix loan-officer-null: mismo motivo que en Loan Officer arriba.
                  totalCount={businessDeveloperScorecard.diagnostics.resolvedCount + businessDeveloperScorecard.diagnostics.blankCount}
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
                <ScorecardPodiumPanel rows={businessDeveloperScorecard.rows} />
              </>
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
      <h4 id="analytics-section-concentration" style={{ margin: '8px 0 12px', fontSize: '15px', color: 'var(--navy)' }}>
        Productivity &amp; Concentration
      </h4>
      {/*
        Etapa FIX-CARD-HEIGHT: Strategy Mix y Pareto quedaban de altura
        distinta -- el grid de 2 columnas SÍ estira sus 2 celdas a la misma
        altura (`align-items: stretch` es el default de CSS Grid, ya vigente
        acá sin declararlo), pero eso solo estira los `<div>` de columna en
        sí, no a `.tbl-card` (components.css) adentro de cada uno -- esa
        clase no tiene ninguna regla de altura, así que cada tarjeta seguía
        creciendo solo hasta el alto de SU PROPIO contenido (Pareto, con
        toggle + SVG de eje rotado, es intrínsecamente más alto que el
        donut+leyenda compacto de Strategy Mix), dejando espacio vacío sin
        usar debajo de la más corta en vez de que la tarjeta lo ocupara.

        Fix: cada columna pasa a ser un flex container en columna
        (`display: flex, flexDirection: column`) -- el `DiagnosticsNote` de
        arriba mide su alto natural, y la tarjeta de abajo lleva `flex: 1`
        para consumir el resto exacto del alto ya estirado por el grid. NO
        se usa `height: 100%` en la tarjeta: eso mediría contra el 100% del
        contenedor ENTERO (incluido el espacio que ya ocupa el
        DiagnosticsNote arriba), desbordando por abajo -- `flex: 1` reparte
        solo el sobrante real, sin importar qué tan alto sea ese texto de
        arriba en cada columna.
      */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/*
            Etapa FIX-NOTE-ALIGN: el resumen de Strategy Mix ("Every funded
            loan...") entra en 1 línea; el de Pareto ("Cumulative
            concentration...", bien más largo) envuelve a 2 -- sin este
            wrapper, la tarjeta de abajo arrancaba más arriba en la columna
            de Strategy Mix que en la de Pareto, porque cada `DiagnosticsNote`
            solo reserva el alto de SU PROPIO texto. `minHeight` fijo
            (~2 líneas de `.foot-note`, 11.5px/line-height 1.55, + su margen)
            reserva el mismo espacio en las dos columnas sin importar cuántas
            líneas use el resumen real -- valor aproximado, no medido pixel a
            pixel; si algún resumen cambia de largo, puede necesitar ajuste.
          */}
          <div style={{ minHeight: '62px' }}>
            <DiagnosticsNote
              count={1}
              summary="Every funded loan in the selected period, split by commercial strategy."
              detail="Uses the same strategy classification already shown in Forecast's Projected Forecast breakdown -- no dependency on branch or employee name matching."
            />
          </div>
          {strategyDataMissing ? (
            <div className="tbl-card" style={{ padding: '16px', flex: 1 }}>
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
            <div className="tbl-card" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="tbl-card__head">
                <span className="tbl-card__title">Strategy Mix</span>
              </div>
              {/*
                Etapa FIX-CARD-HEIGHT (parte 2): tras darle flex: 1 a la
                tarjeta, el donut+leyenda (más bajo que Pareto) quedaba
                pegado arriba, con el sobrante de altura como espacio vacío
                debajo. Este wrapper toma ese sobrante (`flex: 1`, dentro de
                la tarjeta ya en columna) y centra su contenido en el eje
                vertical (`alignItems: center` -- el wrapper es fila, no
                columna, así que el eje cruzado ES el vertical) -- mismo
                ancho de siempre, solo cambia dónde queda dentro de la
                tarjeta.
              */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
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
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Etapa FIX-NOTE-ALIGN: mismo `minHeight` que la columna de Strategy Mix -- ver el comentario ahí. */}
          <div style={{ minHeight: '62px' }}>
            <DiagnosticsNote
              count={1}
              summary="Cumulative concentration of funded loans by branch or loan officer -- bars from the same scorecards above, line shows running % of total."
              detail="Year to date totals cover January 1 through today, independent of the period selector above."
            />
          </div>
          {orgRoster.loading && <p className="foot-note">Loading org roster…</p>}
          {orgRoster.error && (
            <p className="pill warn" style={{ display: 'inline-flex' }}>
              Could not load org roster: {orgRoster.error}
            </p>
          )}
          {!orgRoster.loading && !orgRoster.error && (
            <div className="tbl-card" style={{ padding: '16px', flex: 1 }}>
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
