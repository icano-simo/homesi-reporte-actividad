'use client';

import { VERDICT_CLASS, VERDICT_LABEL, requiredUnits } from '@/lib/business-plan/qualifiers';
import { formatRate } from '@/lib/business-plan/rates';
import type { BusinessPlanData, Verdict } from '@/lib/business-plan/types';
import { formatYearMonth } from '@/lib/business-plan/months';

/**
 * Piezas visuales compartidas por las pantallas del módulo.
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 */

/** Badge del veredicto. Sin benchmark no hay veredicto: va un guion. */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === 'not_evaluable') return <span className="bp-muted">—</span>;
  return <span className={VERDICT_CLASS[verdict]}>{VERDICT_LABEL[verdict]}</span>;
}

/**
 * Tarjeta de KPI, en el mismo lenguaje que el banner de Forecast.
 *
 * `.kpi-hero__value` es la misma clase que usa Forecast (components.css). El
 * único tono que ese archivo no traía es el de riesgo, agregado en
 * bp-visual.css. Sin subtítulo: el número y su etiqueta alcanzan.
 */
export function KpiCard({ label, value, tone }: { label: string; value: string | number; tone?: 'risk' | 'ok' }) {
  const toneClass = tone === 'risk' ? ' kpi-hero__value--risk' : tone === 'ok' ? ' kpi-hero__value--emerald' : '';
  return (
    <div className="mcard">
      <div className="m-name">{label}</div>
      <div className={'kpi-hero__value' + toneClass}>{value}</div>
    </div>
  );
}

/** Estados de carga y error, iguales en todas las pantallas. */
export function LoadingState() {
  return (
    <div className="empty">
      <h2>Loading roster…</h2>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="empty">
      <h2>Could not load the module</h2>
      <p>{message}</p>
    </div>
  );
}

export function NotFoundState({ what, backHref, backLabel }: { what: string; backHref: string; backLabel: string }) {
  return (
    <div className="empty">
      <h2>{what}</h2>
      <p>
        <a href={backHref} className="bp-crumbs__current">
          {backLabel}
        </a>
      </p>
    </div>
  );
}

/**
 * ============================================================================
 * NOTA DE CÁLCULO — al pie, fuera del área operativa
 * ============================================================================
 *
 * Etapa BP5. Es la ÚNICA excepción a la limpieza de textos de BP4, y lo es
 * porque va después de que termina la pantalla: quien sólo quiere leer los
 * números nunca llega hasta acá, y quien se pregunta de dónde salió un número
 * lo encuentra sin tener que preguntar.
 *
 * Tres o cuatro líneas. No es un manual.
 */
export function CalcNote({ data }: { data: BusinessPlanData }) {
  const d = data.diagnostics;
  /* Las tasas REALMENTE aplicadas, no los defaults del código: desde BP6 salen
     de `business_plan.settings` y alguien puede haberlas editado en Settings. */
  const r = d.rates;
  const win = d.windowMonths.map(formatYearMonth);
  return (
    <div className="bp-calc-note">
      <p>
        <strong>GAP</strong> = average of {win.slice(0, -1).join(', ')} and {win[win.length - 1]} projected, minus the
        benchmark. The projection counts closings to date plus the loans due to close this month: those in CTC and
        Closing whole, and the remaining healthy ones weighted by the pull-through of their milestone.
      </p>
      <p>
        <strong>Qualifier 2</strong> requires <code>ceil(benchmark ÷ conversion rate)</code> units of each metric — with
        a benchmark of 2 that is {requiredUnits(2, r.q2.fileCreations)} file creations,{' '}
        {requiredUnits(2, r.q2.creditReports)} credit reports and {requiredUnits(2, r.q2.applications)} applications. It
        fails when two or more fall short.
      </p>
      <p>
        Rates: Started {formatRate(r.milestone.Started)} · Processing {formatRate(r.milestone.Processing)} ·
        Underwriting {formatRate(r.milestone.Underwriting)} · Closing {formatRate(r.milestone.Closing)}. Editable in
        Settings.
      </p>
    </div>
  );
}

/**
 * Pie de datos de la corrida.
 *
 * Hechos de ESTA corrida, no explicaciones: la ventana de meses, cuántas filas
 * se leyeron, qué excepciones de atribución rigen, y sólo si los hay, los
 * nombres sin clasificar y las tablas que faltan.
 */
export function Diagnostics({ data }: { data: BusinessPlanData }) {
  const d = data.diagnostics;
  const missing = [
    !d.benchmarkTableAvailable && 'org.employee_benchmark',
    !d.settingsTableAvailable && 'business_plan.settings',
    !d.interventionTableAvailable && 'business_plan.intervention',
  ].filter(Boolean) as string[];

  return (
    <div className="bp-diagnostics">
      <div>
        Window: <code>{d.windowMonths.map(formatYearMonth).join(' · ')}</code> (last one projected) · closed-month
        reference <code>{d.closedMonths.map(formatYearMonth).join(' · ')}</code>
      </div>
      <div>
        Rows read: <code>{d.activityRowsRead.toLocaleString('en-US')}</code> activity ·{' '}
        <code>{d.pipelineRowsRead.toLocaleString('en-US')}</code> forecast ·{' '}
        <code>{d.excludedNamesSeen.toLocaleString('en-US')}</code> excluded ·{' '}
        <code>{d.rowsWithoutOfficer.toLocaleString('en-US')}</code> with no officer
      </div>
      {d.attributionOverrides.length > 0 && (
        <div>
          Attribution forced:{' '}
          {d.attributionOverrides.map((o, i) => (
            <span key={o.fullName}>
              {i > 0 ? ' · ' : ''}
              {o.fullName} → <code>{o.forcedBranchCode}</code>
            </span>
          ))}
        </div>
      )}
      {d.unmappedNames.length > 0 && (
        <div className="bp-diagnostics__warn">
          Unclassified source names ({d.unmappedNames.length}):{' '}
          {d.unmappedNames.slice(0, 5).map((u) => `${u.source}:"${u.nameRaw}" (${u.rows})`).join(', ')}
          {d.unmappedNames.length > 5 ? ` … +${d.unmappedNames.length - 5} more` : ''}
        </div>
      )}
      {missing.length > 0 && <div className="bp-diagnostics__warn">Not available yet: {missing.join(' · ')}</div>}
    </div>
  );
}

/** Iniciales para el avatar. "Adriana Espinoza (Szczech)" -> "AE". */
export function initialsOf(fullName: string): string {
  const words = fullName
    .replace(/\(.*?\)/g, ' ') // los apellidos entre paréntesis no cuentan
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * REDONDEO — etapa BP7
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Es SÓLO presentación. El motor guarda siempre el valor exacto y los
 * veredictos se calculan con él: redondear antes de comparar cambiaría
 * resultados, no la lectura.
 *
 * Cada tipo de número se redondea distinto porque significan cosas distintas:
 *
 *   préstamos y proyecciones  entero   un préstamo es discreto; "6,4 préstamos"
 *                                      no quiere decir nada
 *   promedios                 1 dec.   3,45 -> 3,5. Nunca dos decimales
 *   GAP                       1 dec.   ⚠ ver abajo
 *
 * ⚠ EL GAP NO SE REDONDEA A ENTERO, Y NO ES UNA CUESTIÓN DE GUSTO. Un GAP de
 * −0,5 redondeado a entero da 0, y 0 es "On Target": alguien por debajo del
 * benchmark pasaría a aprobado. Redondear el GAP cambia veredictos.
 *
 * Donde se muestra un número redondeado, el exacto queda en el `title` -- para
 * que nadie tenga que adivinar por qué 1 + 0 + 5 da 6.
 */

/** Préstamos y proyecciones: entero. */
export function fmtLoans(n: number): string {
  return String(Math.round(n));
}

/** Promedios: un decimal. */
export function fmtAvg(n: number): string {
  return n.toFixed(1);
}

/**
 * Promedios de actividad: un decimal, pero sin el `.0` inútil. 29,7 se muestra
 * como 29.7 y 27,0 como 27.
 */
export function fmtActivityAvg(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Valor exacto para el `title` de un número redondeado. */
export function exactTitle(n: number): string {
  return 'Exact: ' + Math.round(n * 1000) / 1000;
}

/** Número con 1 decimal, o el guion largo cuando no hay dato. */
export function fmtDecimal(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

/**
 * El GAP siempre con UN decimal. Redondearlo a entero inventaría precisión que
 * el dato no tiene: es un promedio de tres meses, fraccionario por
 * construcción, y un GAP de exactamente −1 casi nunca ocurre.
 */
export function fmtGap(gap: number | null): string {
  if (gap === null) return '—';
  return (gap > 0 ? '+' : '') + gap.toFixed(1);
}

/**
 * ============================================================================
 * CONTENEDOR DE VEREDICTO — lo primero que hay que leer
 * ============================================================================
 *
 * Etapa BP7. Antes el veredicto era una pill chica arriba a la derecha,
 * desconectada de todo: para saber si había que actuar sobre alguien había que
 * buscarla. Ahora es una caja con el borde del color del estado, el veredicto
 * en grande y la CONSECUENCIA escrita, que es lo que la persona necesita.
 *
 * En "no evaluable" no se dibuja la caja: no hay veredicto que destacar.
 */
export function VerdictPanel({ verdict }: { verdict: Verdict }) {
  if (verdict === 'not_evaluable') {
    return (
      <div className="bp-verdict-panel bp-verdict-panel--none">
        <div className="bp-verdict-panel__label">No benchmark</div>
      </div>
    );
  }
  const consequence =
    verdict === 'on_risk'
      ? 'Core Business Plan is mandatory'
      : verdict === 'watch'
        ? 'Business Plan suggested'
        : 'No action required';
  return (
    <div className={'bp-verdict-panel bp-verdict-panel--' + verdict}>
      <div className="bp-verdict-panel__label">{VERDICT_LABEL[verdict]}</div>
      <div className="bp-verdict-panel__consequence">{consequence}</div>
    </div>
  );
}

/**
 * Marca de benchmark provisional.
 *
 * Los 36 benchmarks sembrados salen del promedio de cierres de la propia
 * persona, que es circular: se la evalúa contra lo que ya hacía. No son
 * objetivos de gestión y no se pueden mostrar como si lo fueran, así que
 * llevan una marca discreta y el motivo en el `title`.
 */
export const PROVISIONAL_SET_BY = 'provisional-seed';

export function ProvisionalTag({ setBy, note }: { setBy: string | null; note?: string | null }) {
  if (setBy !== PROVISIONAL_SET_BY) return null;
  return (
    <span className="bp-provisional" title={note ?? 'Provisional benchmark — replace with the MMI.'}>
      provisional
    </span>
  );
}

/** Etiqueta de cargo, separada del nombre y en gris sutil. */
export function RoleChip({ isBranchManager, isProducing }: { isBranchManager: boolean; isProducing: boolean }) {
  if (!isBranchManager) return null;
  return <span className="bp-chip">{isProducing ? 'Producing BM' : 'BM'}</span>;
}
