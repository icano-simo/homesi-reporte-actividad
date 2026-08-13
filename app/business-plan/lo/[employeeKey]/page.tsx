'use client';

import { useMemo, use } from 'react';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
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
    <>
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
                  {/*
                    Sin esta marca, alguien que sepa que las fuentes reportan
                    parte de su producción bajo otro branch leería el número de
                    arriba como un error de atribución.
                  */}
                  {lo.attributionOverride && (
                    <span className="bp-chip" title={lo.attributionOverride.reason ?? undefined}>
                      Attribution forced
                    </span>
                  )}
                  {branchManagers.length > 0 && <> · {branchManagers.join(' + ')}</>}
                  {lo.tier && <> · Tier {lo.tier}</>}
                </p>
              </div>
            </div>

            {/* Veredicto, arriba a la derecha. Sin la frase que lo explicaba:
                mientras no haya motor el badge ya se dibuja como un guion, y el
                aviso de una línea de abajo dice por qué. */}
            <div className="bp-verdict">
              <TriageBadge state={lo.triage} />
            </div>
          </div>

          <TriagePendingNotice />

          <div className="bp-metric-grid">
            <Metric label="Avg Closings 3M" value={lo.activity.avgClosings3m.toFixed(1)} />
            <Metric label="Benchmark" value={lo.monthlyBenchmark === null ? '—' : lo.monthlyBenchmark.toFixed(1)} muted={lo.monthlyBenchmark === null} />
            <Metric label="GAP" value={lo.gap === null ? '—' : fmtDecimal(lo.gap)} muted={lo.gap === null} />
            <Metric label="Credit Applications" value={lo.activity.creditApplications} />
            <Metric label="Pre-Approvals" value={lo.activity.preApprovals} />
            <Metric label="Files Created" value={lo.activity.filesCreated} />
            <Metric label="Open Pipeline" value={lo.pipeline.openLoans} />
            <Metric label="Funded (Forecast)" value={lo.pipeline.resolvedFunded} />
          </div>

          {/*
           * Etapa BP4: acá había TRES bloques "pendiente" -- dos de qualifiers y
           * uno de barra de decisión -- que sumaban unas quince líneas de texto
           * explicando reglas que todavía no existen. Con el aviso de una línea
           * de arriba, esta pantalla ya dice lo que tiene que decir.
           *
           * Nada de eso se perdió: las fórmulas propuestas y las cuatro
           * contradicciones abiertas están documentadas en
           * `lib/business-plan/triage.ts`, que es donde le sirven a quien las
           * vaya a implementar. No eran información para el usuario.
           */}
          <Diagnostics data={data} />
        </>
      )}
    </>
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
