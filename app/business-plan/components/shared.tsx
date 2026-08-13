'use client';

import { AlertTriangleIcon } from '@/components/ui/icons';
import { TRIAGE_CLASS, TRIAGE_LABEL } from '@/lib/business-plan/triage';
import type { BusinessPlanData, TriageState } from '@/lib/business-plan/types';
import { formatYearMonth } from '@/lib/business-plan/months';

/**
 * Piezas visuales compartidas por las 3 pantallas del módulo.
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 */

/**
 * Badge de estado de triage.
 *
 * Etapa BP4: `not_evaluable` se dibuja como un guion, no como un pill que dice
 * "Not evaluable". Hoy TODOS los Loan Officers están en ese estado, así que
 * repetir la etiqueta 38 veces no informaba nada -- sólo llenaba la columna.
 * El aviso de que el motor está pendiente va UNA vez, arriba de la pantalla.
 *
 * No es un caso especial que haya que deshacer después: en cuanto el motor
 * empiece a devolver estados reales, esas filas dejan de caer en esta rama y
 * el pill aparece solo.
 */
export function TriageBadge({ state }: { state: TriageState }) {
  if (state === 'not_evaluable') return <span className="bp-muted">—</span>;
  return <span className={TRIAGE_CLASS[state]}>{TRIAGE_LABEL[state]}</span>;
}

/**
 * Aviso de que el motor de triage no está definido.
 *
 * UNO por pantalla y de una línea. La versión anterior ocupaba tres renglones
 * y además repetía la misma frase dos veces, porque concatenaba un texto
 * propio con `TRIAGE_PENDING_NOTICE`, que ya empezaba igual.
 *
 * Se queda porque sin él la columna de guiones no se entiende. Todo lo demás
 * -- qué reglas faltan, qué contradicciones hay -- vive en
 * `lib/business-plan/triage.ts`, que es donde le sirve a quien lo va a
 * implementar, no en la pantalla del usuario.
 */
export function TriagePendingNotice() {
  return (
    <div className="bp-pending" role="status">
      <AlertTriangleIcon size={14} />
      <span>Triage pending definition — status is not computed yet.</span>
    </div>
  );
}

/**
 * Tarjeta de KPI, en el mismo lenguaje que el banner de Forecast.
 *
 * Etapa BP2b: `.kpi-hero__value` es la misma clase que usa el banner de
 * Forecast (components.css). El módulo tenía un par propio con otros tamaños y
 * colores; se eliminó. El único tono que components.css no traía es el de
 * riesgo, agregado como `--risk` en bp-visual.css.
 *
 * Etapa BP4: se quitó el subtítulo. Decía cosas como "Division branches only" o
 * "Pending triage engine", que no agregaban nada al número y su etiqueta.
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
        <a href={backHref} className="bp-crumbs__current">
          {backLabel}
        </a>
      </p>
    </div>
  );
}

/**
 * Pie de datos de la corrida.
 *
 * Etapa BP4: dejó de ser prosa. Antes explicaba en frases cómo resolvía los
 * nombres el módulo, que es documentación y no un dato -- eso vive en
 * `lib/business-plan/loadData.ts`. Lo que queda son hechos de ESTA corrida,
 * que cambian con los datos y no se pueden deducir mirando la pantalla:
 *
 *   - la ventana de meses del promedio, que es un SUPUESTO (ver months.ts) y
 *     sin ella el "Avg Closings 3M" no se puede interpretar;
 *   - cuántas filas se leyeron y cuántas se descartaron;
 *   - qué excepciones de atribución están vigentes;
 *   - y sólo si los hay, los nombres sin clasificar y la falta de benchmarks.
 *
 * Los dos últimos son condicionales: hoy no hay ningún nombre sin resolver, así
 * que esa línea no se renderiza.
 */
export function Diagnostics({ data }: { data: BusinessPlanData }) {
  const d = data.diagnostics;
  return (
    <div className="bp-diagnostics">
      <div>
        Closing average: <code>{d.monthsUsedForAverage.map(formatYearMonth).join(' · ')}</code>
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
      {!d.benchmarkTableAvailable && (
        <div>
          <code>org.employee_benchmark</code> not loaded
        </div>
      )}
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

/** Número con 1 decimal, o el guion largo cuando no hay dato. */
export function fmtDecimal(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}
