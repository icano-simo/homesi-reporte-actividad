'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { TRIAGE_FILTERS } from '@/lib/business-plan/triage';
import type { TriageState } from '@/lib/business-plan/types';
import Breadcrumbs from './components/Breadcrumbs';
import { Diagnostics, ErrorState, KpiCard, LoadingState, TriageBadge, TriageFilterPills, TriagePendingNotice } from './components/shared';
/* Etapa BP2: el import de `bp-visual.css` se mudó a `app/business-plan/layout.tsx`,
   que es el punto único por el que pasan todas las rutas del módulo. */

/**
 * ============================================================================
 * PANTALLA 1 — BRANCH PORTFOLIO
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO. Primer nivel de Branch Portfolio → Branch → LO.
 *
 * Sin modales: la fila navega a `/business-plan/branch/[code]`, una página con
 * su propia URL.
 */

/** El código de branch viaja en la URL y NO siempre es numérico: hay 'Affinity'
 *  y 'Branch Out of Division' (con espacios). Codificar es obligatorio. */
function branchHref(code: string): string {
  return '/business-plan/branch/' + encodeURIComponent(code);
}

export default function BranchPortfolioPage() {
  const router = useRouter();
  const { data, isLoading, error } = useBusinessPlanData();

  const [loSearch, setLoSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [triageFilter, setTriageFilter] = useState<TriageState | 'all'>('all');

  /** Managers para el desplegable: se derivan de los branches ya cargados. */
  const managerOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.branches.flatMap((b) => b.branchManagers))].sort();
  }, [data]);

  const visibleBranches = useMemo(() => {
    if (!data) return [];
    const needle = loSearch.trim().toLowerCase();
    return data.branches.filter((b) => {
      if (branchFilter !== 'all' && b.branchCode !== branchFilter) return false;
      if (managerFilter !== 'all' && !b.branchManagers.includes(managerFilter)) return false;
      if (triageFilter !== 'all' && b.triage !== triageFilter) return false;
      /*
       * El buscador de LO filtra por PERSONA, no por nombre de branch: muestra
       * los branches que CONTIENEN a ese LO. Es lo que pide el brief y es lo
       * intuitivo -- buscás a alguien para ver dónde está, no para filtrar
       * sucursales que se llamen parecido.
       */
      if (needle && !b.loanOfficers.some((lo) => lo.fullName.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [data, loSearch, managerFilter, branchFilter, triageFilter]);

  const totals = useMemo(() => {
    if (!data) return { branches: 0, los: 0, atRisk: 0, onTrack: 0 };
    return {
      branches: data.branches.length,
      // Un LO asignado a dos branches se cuenta una sola vez.
      los: new Set(data.branches.flatMap((b) => b.loanOfficers.map((lo) => lo.employeeKey))).size,
      atRisk: data.loanOfficers.filter((lo) => lo.triage === 'on_risk').length,
      onTrack: data.loanOfficers.filter((lo) => lo.triage === 'on_track').length,
    };
  }, [data]);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio' }]} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">Branch Portfolio</h1>
          <p className="page-head__subtitle">
            Division branches, their managers and loan officer coverage. Select a branch to open its directory.
          </p>
        </div>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {data && (
        <>
          <TriagePendingNotice />

          <div className="bp-kpis">
            <KpiCard label="Total Branches" value={totals.branches} sub="Division branches only" />
            <KpiCard label="Total Loan Officers" value={totals.los} sub="Distinct people with a Loan Officer role" />
            <KpiCard label="Loan Officers On Risk" value={totals.atRisk} sub="Pending triage engine" tone="risk" />
            <KpiCard label="Loan Officers On Track" value={totals.onTrack} sub="Pending triage engine" tone="ok" />
          </div>

          <div className="control-bar">
            <div className="control-group">
              <span className="label-chip">Loan Officer</span>
              <input
                type="text"
                className="field"
                style={{ minWidth: '220px', cursor: 'text' }}
                value={loSearch}
                onChange={(e) => setLoSearch(e.target.value)}
                placeholder="Search a person…"
                aria-label="Search loan officer"
              />
              <span className="label-chip">Branch Manager</span>
              <select className="field" value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
                <option value="all">All managers</option>
                {managerOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="label-chip">Branch</span>
              <select className="field" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="all">All branches</option>
                {data.branches.map((b) => (
                  <option key={b.branchCode} value={b.branchCode}>
                    {b.branchCode}
                  </option>
                ))}
              </select>
            </div>
            <div className="control-group">
              <TriageFilterPills value={triageFilter} onChange={setTriageFilter} options={TRIAGE_FILTERS} />
            </div>
          </div>

          <div className="tbl-card">
            <div className="tbl-scroll">
              <table className="piv bp-table--branches">
                {/*
                  Etapa BP2 — el reparto de ancho lo fija el `<colgroup>`, no las
                  celdas: `table.piv` usa `table-layout: fixed`, donde un
                  `min-width` en el `td` se ignora. 12 + 38 + 15 + 15 + 20 = 100%.
                  El manager se lleva el 38% porque es el único texto largo de la
                  fila; el resto son números cortos y un pill.
                */}
                <colgroup>
                  <col className="bp-col-branch" />
                  <col className="bp-col-manager" />
                  <col className="bp-col-count" />
                  <col className="bp-col-count" />
                  <col className="bp-col-status" />
                </colgroup>
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Branch</th>
                    <th className="bp-left">Branch Manager</th>
                    <th className="bp-center">Loan Officers</th>
                    <th className="bp-center">At Risk</th>
                    <th className="bp-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBranches.map((b) => (
                    <tr
                      key={b.branchCode}
                      className="metric bp-row-link"
                      tabIndex={0}
                      role="link"
                      onClick={() => router.push(branchHref(b.branchCode))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          router.push(branchHref(b.branchCode));
                        }
                      }}
                    >
                      <td className="lbl">{b.branchCode}</td>
                      {/*
                        Puede haber más de un manager por branch, así que el
                        texto se recorta con elipsis y el `title` conserva los
                        nombres completos: el ancho fijo no puede depender de
                        cuántos managers tenga la sucursal más poblada.
                      */}
                      <td className="bp-left bp-ellipsis" title={b.branchManagers.join(' + ')}>
                        {b.branchManagers.length ? b.branchManagers.join(' + ') : <span className="bp-muted">—</span>}
                      </td>
                      <td className="bp-center">{b.totalLoanOfficers}</td>
                      {/* El cero se apaga para que sólo salten los branches con gente en riesgo. */}
                      <td className="bp-center">
                        {b.atRiskCount === 0 ? (
                          <span className="bp-muted">0</span>
                        ) : (
                          <span className="bp-emphasis">{b.atRiskCount}</span>
                        )}
                      </td>
                      <td className="bp-center">
                        <TriageBadge state={b.triage} />
                      </td>
                    </tr>
                  ))}
                  {!visibleBranches.length && (
                    <tr>
                      <td className="lbl bp-empty-cell" colSpan={5}>
                        No branch matches the current filters.
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
