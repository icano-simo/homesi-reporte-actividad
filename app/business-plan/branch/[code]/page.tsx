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

  /* Suma de los promedios de sus Loan Officers: el ritmo de cierres del branch. */
  const branchAvgClosings = useMemo(
    () => (branch?.loanOfficers ?? []).reduce((sum, lo) => sum + lo.activity.avgClosings3m, 0),
    [branch]
  );

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
    <>
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
              {/* El manager es un dato, no una explicación: se queda, en una línea.
                  Hoy los 13 branches tienen exactamente uno, pero el roster admite
                  varios y la vista los junta. */}
              <p className="page-head__subtitle">
                {branch.branchManagers.length ? branch.branchManagers.join(' + ') : '—'}
              </p>
            </div>
          </div>

          <TriagePendingNotice />

          <div className="bp-kpis">
            <KpiCard label="Loan Officers" value={branch.totalLoanOfficers} />
            <KpiCard label="On Risk" value={branch.atRiskCount} tone="risk" />
            {/* Reemplaza a "Branch Managers", que sin subtítulo sólo decía "1" y
                repetía lo que ya está bajo el título. */}
            <KpiCard label="Avg Closings 3M" value={branchAvgClosings.toFixed(1)} />
            {/* Guion mientras no haya motor, igual que la columna Status. */}
            <KpiCard label="Status" value={branch.triage === 'not_evaluable' ? '—' : TRIAGE_LABEL[branch.triage]} />
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
           *
           * Etapa BP4: esto era además un párrafo al pie de la pantalla. Se
           * quitó de la interfaz -- le sirve a quien mantiene el módulo, no a
           * quien lee la tabla.
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
                      {/* Etapa BP4: los encabezados ya estaban centrados desde BP2 pero
                          las celdas seguían alineadas a la derecha con `.val`. */}
                      <td className="bp-center">{lo.activity.avgClosings3m.toFixed(1)}</td>
                      {/* Guion, no "no benchmark" repetido: hoy es igual en las 38 filas. */}
                      <td className="bp-center">
                        {lo.monthlyBenchmark === null ? <span className="bp-muted">—</span> : lo.monthlyBenchmark.toFixed(1)}
                      </td>
                      <td className="bp-center">
                        {lo.gap === null ? <span className="bp-muted">—</span> : fmtDecimal(lo.gap)}
                      </td>
                      <td className={'bp-center' + (lo.activity.creditApplications ? '' : ' zero')}>{lo.activity.creditApplications}</td>
                      <td className={'bp-center' + (lo.activity.preApprovals ? '' : ' zero')}>{lo.activity.preApprovals}</td>
                      <td className={'bp-center' + (lo.activity.filesCreated ? '' : ' zero')}>{lo.activity.filesCreated}</td>
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

          <Diagnostics data={data} />
        </>
      )}
    </>
  );
}
