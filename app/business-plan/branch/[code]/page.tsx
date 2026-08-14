'use client';

import { useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { branchStatusClass, branchStatusLabel } from '@/lib/business-plan/intervention';
import Breadcrumbs from '../../components/Breadcrumbs';
import {
  CalcNote,
  Diagnostics,
  ErrorState,
  KpiCard,
  LoadingState,
  NotFoundState,
  RoleChip,
  VerdictBadge,
  fmtGap,
} from '../../components/shared';

/**
 * ============================================================================
 * VISTA 2 — BRANCH ABIERTO
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO. Reescrita en BP5.
 *
 * EL PARÁMETRO NO ES UN NÚMERO. `branch_code` incluye 'Branch Out of Division'
 * (con espacios), así que llega URL-encoded y hay que decodificarlo antes de
 * comparar. Tratarlo como entero rompería esos casos.
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

  const branch = useMemo(() => data?.branches.find((b) => b.branchCode === branchCode) ?? null, [data, branchCode]);

  const visibleLos = useMemo(() => {
    if (!branch) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return branch.loanOfficers;
    return branch.loanOfficers.filter((lo) => lo.fullName.toLowerCase().includes(needle));
  }, [branch, search]);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio', href: '/business-plan' }, { label: branchCode }]} />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && !branch && (
        <NotFoundState
          what={`Branch "${branchCode}" is not a division branch`}
          backHref="/business-plan"
          backLabel="Back to Branch Portfolio"
        />
      )}

      {data && branch && (
        <>
          <div className="page-head">
            <div>
              <h1 className="page-head__title">Branch {branch.branchCode}</h1>
              <p className="page-head__subtitle">
                {branch.branchManagers.length ? branch.branchManagers.join(' + ') : '—'}
              </p>
            </div>
            <span className={branchStatusClass(branch.status)}>
              {branchStatusLabel(branch.status, branch.pendingCount)}
            </span>
          </div>

          <div className="bp-kpis">
            <KpiCard label="Loan Officers" value={branch.totalLoanOfficers} />
            <KpiCard label="On Risk" value={branch.atRiskCount} tone="risk" />
            {/*
              Ritmo de cierres del branch: la suma de los promedios de su gente,
              con la MISMA ventana del Qualifier 1 (dos meses cerrados más el
              actual proyectado). Es un pronóstico, por eso es fraccionario.
            */}
            <KpiCard label="Avg Closings 3M" value={branch.avgClosings3m.toFixed(1)} />
            <KpiCard label="Status" value={branchStatusLabel(branch.status, branch.pendingCount)} />
          </div>

          <div className="control-bar">
            <div className="control-group">
              <span className="label-chip">Search</span>
              <input
                type="text"
                className="field bp-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Loan officer name…"
                aria-label="Search loan officer in this branch"
              />
            </div>
          </div>

          {/*
           * ATRIBUCIÓN — LEER ANTES DE "CORREGIR" ESTOS NÚMEROS.
           *
           * Los Loan Officers de esta tabla salen de `employee_branch` con rol
           * LO, o del branch forzado en `org.attribution_override`. Pero las
           * métricas de cada fila son el TOTAL DE LA PERSONA, no sólo lo que
           * produjo en este branch.
           *
           * Es contraintuitivo y está decidido así por el negocio: un préstamo
           * se atribuye al branch del PRÉSTAMO, no al de la persona, y hay
           * Loan Officers con producción repartida en varios branches. Sumar
           * sólo lo de este branch daría un número que no coincide con el de su
           * propia ficha.
           */}
          <div className="tbl-card">
            <div className="tbl-scroll">
              <table className="piv bp-table--los">
                {/* 26 + 6×10 + 14 = 100%. El nombre es lo único largo de la fila. */}
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
                    <th className="bp-center">Verdict</th>
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
                        <RoleChip isBranchManager={lo.isBranchManager} isProducing={lo.isProducing} />
                      </td>
                      <td className="bp-center">{lo.q1.avgWithCurrent.toFixed(1)}</td>
                      <td className="bp-center">
                        {lo.monthlyBenchmark === null ? <span className="bp-muted">—</span> : lo.monthlyBenchmark.toFixed(1)}
                      </td>
                      <td className="bp-center">{fmtGap(lo.q1.gap)}</td>
                      <td className={'bp-center' + (lo.activity.creditApplications ? '' : ' zero')}>{lo.activity.creditApplications}</td>
                      <td className={'bp-center' + (lo.activity.preApprovals ? '' : ' zero')}>{lo.activity.preApprovals}</td>
                      <td className={'bp-center' + (lo.activity.filesCreated ? '' : ' zero')}>{lo.activity.filesCreated}</td>
                      <td className="bp-center">
                        <VerdictBadge verdict={lo.verdict} />
                      </td>
                    </tr>
                  ))}
                  {!visibleLos.length && (
                    <tr>
                      <td className="lbl bp-empty-cell" colSpan={8}>
                        No loan officer matches that search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <CalcNote data={data} />
          <Diagnostics data={data} />
        </>
      )}
    </>
  );
}
