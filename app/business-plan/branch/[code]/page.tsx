'use client';

import { useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { TRIAGE_FILTERS, TRIAGE_LABEL } from '@/lib/business-plan/triage';
import type { TriageState } from '@/lib/business-plan/types';
import Breadcrumbs from '../../components/Breadcrumbs';
import {
  Diagnostics,
  ErrorState,
  KpiCard,
  LoadingState,
  NotFoundState,
  TriageBadge,
  TriageFilterPills,
  TriagePendingNotice,
  fmtDecimal,
} from '../../components/shared';
/* Etapa BP2: `bp-visual.css` ahora se importa una sola vez desde
   `app/business-plan/layout.tsx`. */

/**
 * ============================================================================
 * PANTALLA 2 — DIRECTORIO DE LOAN OFFICERS DE UN BRANCH
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO. Segundo nivel de la navegación.
 *
 * EL PARÁMETRO NO ES UN NÚMERO. `branch_code` incluye 'Affinity' y
 * 'Branch Out of Division' (con espacios), así que llega URL-encoded y hay que
 * decodificarlo antes de comparar. Tratarlo como entero rompería esos dos.
 */

function loHref(employeeKey: number): string {
  return '/business-plan/lo/' + employeeKey;
}

export default function BranchDirectoryPage({ params }: { params: Promise<{ code: string }> }) {
  // Next 16: `params` es una promesa y se desenvuelve con `use()`.
  const { code } = use(params);
  const branchCode = decodeURIComponent(code);

  const router = useRouter();
  const { data, isLoading, error } = useBusinessPlanData();

  const [search, setSearch] = useState('');
  const [triageFilter, setTriageFilter] = useState<TriageState | 'all'>('all');

  const branch = useMemo(() => data?.branches.find((b) => b.branchCode === branchCode) ?? null, [data, branchCode]);

  const visibleLos = useMemo(() => {
    if (!branch) return [];
    const needle = search.trim().toLowerCase();
    return branch.loanOfficers.filter((lo) => {
      if (triageFilter !== 'all' && lo.triage !== triageFilter) return false;
      if (needle && !lo.fullName.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [branch, search, triageFilter]);

  return (
    <div className="hub-container">
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          {
            label: branch?.branchManagers.length
              ? `${branchCode} (${branch.branchManagers.join(' + ')})`
              : branchCode,
          },
        ]}
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && !branch && (
        <NotFoundState what={`Branch "${branchCode}" is not a division branch`} backHref="/business-plan" backLabel="Back to Branch Portfolio" />
      )}

      {data && branch && (
        <>
          <div className="page-head">
            <div>
              <h1 className="page-head__title">Branch {branch.branchCode}</h1>
              <p className="page-head__subtitle">
                {/* Hoy ningún branch tiene más de un manager (el 716 quedó con
                    Pier Laino), pero el roster admite varios y la vista los junta. */}
                {branch.branchManagers.length
                  ? `Branch Manager: ${branch.branchManagers.join(' + ')}`
                  : 'No branch manager on the roster'}
              </p>
            </div>
          </div>

          <TriagePendingNotice />

          <div className="bp-kpis">
            <KpiCard label="Loan Officers" value={branch.totalLoanOfficers} sub="Assigned to this branch" />
            <KpiCard label="Loan Officers On Risk" value={branch.atRiskCount} sub="Pending triage engine" tone="risk" />
            <KpiCard label="Branch Managers" value={branch.branchManagers.length} sub={branch.branchManagers.join(' + ') || '—'} />
            {/* El estado del branch se muestra como su etiqueta, no como un conteo:
                antes repetía el número de Loan Officers, que no era un estado. */}
            <KpiCard label="Branch Status" value={TRIAGE_LABEL[branch.triage]} sub="Pending triage engine" />
          </div>

          <div className="control-bar">
            <div className="control-group">
              <span className="label-chip">Search</span>
              <input
                type="text"
                className="field"
                style={{ minWidth: '220px', cursor: 'text' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Loan officer name…"
                aria-label="Search loan officer in this branch"
              />
            </div>
            <div className="control-group">
              <TriageFilterPills value={triageFilter} onChange={setTriageFilter} options={TRIAGE_FILTERS} />
            </div>
          </div>

          {/*
           * ATRIBUCIÓN — LEER ANTES DE "CORREGIR" ESTOS NÚMEROS.
           *
           * Los LOs de esta tabla salen de `employee_branch` con rol LO, o sea
           * del branch ASIGNADO a la persona. Pero las métricas de cada fila son
           * el TOTAL DE LA PERSONA, no sólo lo que produjo en este branch.
           *
           * Es contraintuitivo y está decidido así por el negocio: un préstamo
           * se atribuye al branch del PRÉSTAMO, no al de la persona, y hay LOs
           * con producción repartida en varios branches (Nathan Martinez está
           * asignado al 716 y tiene préstamos en varios). Sumar sólo lo de este
           * branch daría un número que no coincide con el de su propia ficha.
           */}
          <div className="tbl-card">
            <div className="tbl-scroll">
              <table className="piv bp-table--los">
                {/* 26 + 12*5 + 14 = 100%. El nombre es lo único largo de la fila. */}
                <colgroup>
                  <col className="bp-col-name" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-status" />
                </colgroup>
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Loan Officer</th>
                    <th className="bp-center">Avg Closings 3M</th>
                    <th className="bp-center">Benchmark</th>
                    <th className="bp-center">GAP</th>
                    <th className="bp-center">Credit Apps</th>
                    <th className="bp-center">Pre-Approvals</th>
                    <th className="bp-center">Files Created</th>
                    <th className="bp-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLos.map((lo) => (
                    <tr
                      key={lo.employeeKey}
                      className="metric bp-row-link"
                      tabIndex={0}
                      role="link"
                      onClick={() => router.push(loHref(lo.employeeKey))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          router.push(loHref(lo.employeeKey));
                        }
                      }}
                    >
                      <td className="lbl">
                        {/* Siempre el nombre canónico del roster, nunca el crudo de la fuente. */}
                        {lo.fullName}
                        {lo.isBranchManager && <span className="bp-chip">{lo.isProducing ? 'Producing BM' : 'BM'}</span>}
                      </td>
                      <td className="val">{lo.activity.avgClosings3m.toFixed(1)}</td>
                      <td className="val">
                        {lo.monthlyBenchmark === null ? (
                          <span className="bp-muted">no benchmark</span>
                        ) : (
                          lo.monthlyBenchmark.toFixed(1)
                        )}
                      </td>
                      <td className="val">
                        {lo.gap === null ? <span className="bp-muted">—</span> : fmtDecimal(lo.gap)}
                      </td>
                      <td className={'val' + (lo.activity.creditApplications ? '' : ' zero')}>{lo.activity.creditApplications}</td>
                      <td className={'val' + (lo.activity.preApprovals ? '' : ' zero')}>{lo.activity.preApprovals}</td>
                      <td className={'val' + (lo.activity.filesCreated ? '' : ' zero')}>{lo.activity.filesCreated}</td>
                      <td className="bp-center">
                        <TriageBadge state={lo.triage} />
                      </td>
                    </tr>
                  ))}
                  {!visibleLos.length && (
                    <tr>
                      <td className="lbl bp-empty-cell" colSpan={8}>
                        No loan officer matches the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="foot-note">
            Metrics are the officer&apos;s <b>own totals</b>, not this branch&apos;s share: a loan is attributed to the
            branch of the loan, not to the branch the person is assigned to. Officers with no production still appear,
            with zeros.
          </p>

          <Diagnostics data={data} />
        </>
      )}
    </div>
  );
}
