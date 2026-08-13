'use client';

import { useMemo, use } from 'react';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { TRIAGE_LABEL } from '@/lib/business-plan/triage';
import Breadcrumbs from '../../components/Breadcrumbs';
import {
  Diagnostics,
  ErrorState,
  LoadingState,
  NotFoundState,
  TriageBadge,
  TriagePendingNotice,
  fmtDecimal,
  initialsOf,
} from '../../components/shared';
/* Etapa BP2: `bp-visual.css` ahora se importa una sola vez desde
   `app/business-plan/layout.tsx`. */

/**
 * ============================================================================
 * PANTALLA 3 — DETALLE DEL LOAN OFFICER
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO. Tercer nivel de la navegación.
 *
 * Las dos secciones de qualifiers y la barra de decisión están MAQUETADAS pero
 * sin cálculo, marcadas en pantalla y en el código. El motor de triage no está
 * definido -- ver lib/business-plan/triage.ts para la lista de contradicciones
 * abiertas.
 */

export default function LoanOfficerDetailPage({ params }: { params: Promise<{ employeeKey: string }> }) {
  const { employeeKey: rawKey } = use(params);
  const employeeKey = Number(rawKey);
  const { data, isLoading, error } = useBusinessPlanData();

  const lo = useMemo(
    () => (Number.isFinite(employeeKey) ? data?.loanOfficers.find((x) => x.employeeKey === employeeKey) ?? null : null),
    [data, employeeKey]
  );

  /** Branch principal para el breadcrumb: el primero de sus asignaciones. */
  const primaryBranch = lo?.branchCodes[0] ?? null;
  const branchManagers = useMemo(() => {
    if (!data || !primaryBranch) return [];
    return data.branches.find((b) => b.branchCode === primaryBranch)?.branchManagers ?? [];
  }, [data, primaryBranch]);

  return (
    <div className="hub-container">
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          ...(primaryBranch
            ? [{ label: primaryBranch, href: '/business-plan/branch/' + encodeURIComponent(primaryBranch) }]
            : []),
          { label: lo?.fullName ?? 'Loan Officer' },
        ]}
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && !lo && (
        <NotFoundState what="That loan officer is not in the roster" backHref="/business-plan" backLabel="Back to Branch Portfolio" />
      )}

      {data && lo && (
        <>
          <div className="bp-profile">
            <div className="bp-profile__id">
              <div className="bp-avatar" aria-hidden="true">
                {initialsOf(lo.fullName)}
              </div>
              <div className="bp-profile__text">
                <h1 className="bp-profile__name">
                  {lo.fullName}
                  {lo.isBranchManager && <span className="bp-chip">{lo.isProducing ? 'Producing BM' : 'BM'}</span>}
                </h1>
                <p className="bp-profile__meta">
                  Branch {lo.branchCodes.join(', ')}
                  {branchManagers.length > 0 && <> · BM: {branchManagers.join(' + ')}</>}
                  {lo.tier && <> · Tier {lo.tier}</>}
                  {' · '}
                  {lo.monthlyBenchmark === null ? (
                    <span className="bp-missing">no benchmark</span>
                  ) : (
                    <>Benchmark {lo.monthlyBenchmark.toFixed(1)}/month</>
                  )}
                </p>
              </div>
            </div>

            {/* Contenedor de veredicto, arriba a la derecha. */}
            <div className="bp-verdict">
              <TriageBadge state={lo.triage} />
              <p className="bp-verdict__line">
                {lo.triage === 'not_evaluable'
                  ? lo.monthlyBenchmark === null
                    ? 'No benchmark on record, so there is nothing to compare production against.'
                    : 'Benchmark on record, but the triage thresholds are still undefined.'
                  : TRIAGE_LABEL[lo.triage]}
              </p>
            </div>
          </div>

          <TriagePendingNotice />

          <div className="bp-metric-grid">
            <Metric label="Avg Closings 3M" value={lo.activity.avgClosings3m.toFixed(1)} />
            <Metric label="Benchmark" value={lo.monthlyBenchmark === null ? 'no benchmark' : lo.monthlyBenchmark.toFixed(1)} muted={lo.monthlyBenchmark === null} />
            <Metric label="GAP" value={lo.gap === null ? '—' : fmtDecimal(lo.gap)} muted={lo.gap === null} />
            <Metric label="Credit Applications" value={lo.activity.creditApplications} />
            <Metric label="Pre-Approvals" value={lo.activity.preApprovals} />
            <Metric label="Files Created" value={lo.activity.filesCreated} />
            <Metric label="Open Pipeline" value={lo.pipeline.openLoans} />
            <Metric label="Funded (Forecast)" value={lo.pipeline.resolvedFunded} />
          </div>

          {/*
           * ── SECCIONES PENDIENTES ────────────────────────────────────────
           * Estructura sí, cálculo no. El brief lo pide explícitamente así, y
           * pide además que se vea en la UI que están pendientes -- no dejar
           * números de ejemplo que alguien pueda confundir con reales.
           */}
          <div className="bp-kpis bp-kpis--pair">
            <QualifierPlaceholder
              title="Activity qualifiers"
              lines={[
                'Credit Applications ≥ benchmark × (multiplier TBD)',
                'Pre-Approvals ≥ benchmark × (multiplier TBD)',
                'Files Created ≥ benchmark × (multiplier TBD)',
              ]}
              note="The three multipliers are not defined yet."
            />
            <QualifierPlaceholder
              title="Compensating qualifiers"
              lines={[
                'Apps ≥ 2 × Benchmark',
                '(Apps × 0.5) + Closed ≥ Benchmark',
              ]}
              note="These two are redundant as written — if the first holds, the second holds automatically. Pending confirmation of whether the rule was OR."
            />
          </div>

          <div className="bp-placeholder bp-placeholder--spaced">
            <span className="bp-placeholder__tag">Pending — decision bar</span>
            <p className="bp-placeholder__body">
              The final verdict strip (thresholds missed, recommended action) is laid out but not computed. The GAP is a
              fractional average, and the published rule only names <code>GAP = -1</code>; a GAP of −0.67 falls in no
              band. That range has to be defined before anything is shown here.
            </p>
          </div>

          <Diagnostics data={data} />
        </>
      )}
    </div>
  );
}

function Metric({ label, value, muted }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div className="bp-metric">
      <div className="bp-metric__label">{label}</div>
      <div className={'bp-metric__value' + (muted ? ' bp-metric__value--muted' : '')}>{value}</div>
    </div>
  );
}

function QualifierPlaceholder({ title, lines, note }: { title: string; lines: string[]; note: string }) {
  return (
    <div className="bp-placeholder">
      <span className="bp-placeholder__tag">Pending — not computed</span>
      <div className="bp-placeholder__title">{title}</div>
      <ul className="bp-placeholder__list">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="bp-placeholder__note">{note}</p>
    </div>
  );
}
