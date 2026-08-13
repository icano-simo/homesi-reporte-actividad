'use client';

import { AlertTriangleIcon } from '@/components/ui/icons';
import { TRIAGE_CLASS, TRIAGE_LABEL, TRIAGE_PENDING_NOTICE } from '@/lib/business-plan/triage';
import type { BusinessPlanData, TriageState } from '@/lib/business-plan/types';
import { formatYearMonth } from '@/lib/business-plan/months';

/**
 * Piezas visuales compartidas por las 3 pantallas del módulo.
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 */

/** Badge de estado de triage. */
export function TriageBadge({ state }: { state: TriageState }) {
  return <span className={TRIAGE_CLASS[state]}>{TRIAGE_LABEL[state]}</span>;
}

/**
 * Aviso de que el motor de triage no está definido.
 *
 * Va en las 3 pantallas a propósito: mientras los estados sean todos "Not
 * evaluable", alguien que abra el módulo sin contexto va a pensar que está
 * roto. Decirlo es más barato que explicarlo después.
 */
export function TriagePendingNotice() {
  return (
    <div className="bp-pending" role="status">
      <AlertTriangleIcon size={16} />
      <span>
        <strong>Triage engine pending definition.</strong> {TRIAGE_PENDING_NOTICE} Every officer shows as{' '}
        <em>Not evaluable</em> until benchmarks are loaded and the thresholds are agreed.
      </span>
    </div>
  );
}

/** Tarjeta de KPI, en el mismo lenguaje que el banner de Forecast. */
export function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'risk' | 'ok';
}) {
  const toneClass = tone === 'risk' ? ' bp-kpi__value--risk' : tone === 'ok' ? ' bp-kpi__value--ok' : '';
  return (
    <div className="mcard">
      <div className="m-name">{label}</div>
      <div className={'bp-kpi__value' + toneClass}>{value}</div>
      {sub && <div className="bp-kpi__sub">{sub}</div>}
    </div>
  );
}

/** Pills de filtro por estado de triage. */
export function TriageFilterPills({
  value,
  onChange,
  options,
}: {
  value: TriageState | 'all';
  onChange: (v: TriageState | 'all') => void;
  options: { value: TriageState | 'all'; label: string }[];
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Estados de carga y error, iguales en las 3 pantallas. */
export function LoadingState() {
  return (
    <div className="empty">
      <h2>Loading roster…</h2>
      <p>Reading the org directory and the active Commercial Activity batch.</p>
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
        It may have been renamed or removed from the roster.{' '}
        <a href={backHref} style={{ color: 'var(--navy)', fontWeight: 700 }}>
          {backLabel}
        </a>
      </p>
    </div>
  );
}

/**
 * Pie con lo que se leyó y bajo qué criterio.
 *
 * No es decoración: la ventana de meses del promedio es un SUPUESTO (ver
 * lib/business-plan/months.ts) y los nombres sin mapear son trabajo pendiente
 * para quien mantiene `org.employee_alias`. Tenerlo a la vista es lo que
 * permite detectar que algo se desalineó sin ir a mirar la base.
 */
export function Diagnostics({ data }: { data: BusinessPlanData }) {
  const d = data.diagnostics;
  return (
    <div className="bp-diagnostics">
      <div>
        Closing average window: <code>{d.monthsUsedForAverage.map(formatYearMonth).join(' · ')}</code> — the three
        complete months before the current one (assumption pending confirmation).
      </div>
      <div>
        Read <code>{d.activityRowsRead.toLocaleString('en-US')}</code> Commercial Activity rows and{' '}
        <code>{d.pipelineRowsRead.toLocaleString('en-US')}</code> Forecast rows. Names resolved through{' '}
        <code>org.employee_alias</code>; <code>{d.excludedNamesSeen.toLocaleString('en-US')}</code> row(s) skipped as
        deliberately excluded and <code>{d.rowsWithoutOfficer.toLocaleString('en-US')}</code> with no loan officer on
        the record.
      </div>
      {d.unmappedNames.length > 0 && (
        <div style={{ color: 'var(--amber-800)' }}>
          {d.unmappedNames.length} source name(s) are neither mapped nor excluded — they need classifying in{' '}
          <code>org.employee_alias</code> or <code>org.source_name_excluded</code>:{' '}
          {d.unmappedNames.slice(0, 5).map((u) => `${u.source}:"${u.nameRaw}" (${u.rows})`).join(', ')}
          {d.unmappedNames.length > 5 ? ` … +${d.unmappedNames.length - 5} more` : ''}
        </div>
      )}
      {!d.benchmarkTableAvailable && (
        <div>
          <code>org.employee_benchmark</code> is not available yet — the migration in{' '}
          <code>docs/sql/</code> has not been applied, so every officer shows &quot;no benchmark&quot;.
        </div>
      )}
    </div>
  );
}

/** Iniciales para el avatar. "Ana Zegarra (Peña)" -> "AZ". */
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

/** Número con 1 decimal, o el guion largo cuando no hay dato. */
export function fmtDecimal(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}
