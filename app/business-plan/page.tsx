'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import Breadcrumbs from './components/Breadcrumbs';
import { CalcNote, ErrorState, KpiCard, LoadingState } from './components/shared';

/**
 * ============================================================================
 * VISTA 1 — BRANCH PORTFOLIO
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO. Reescrita en BP5.
 *
 * Sin modales: la fila navega a `/business-plan/branch/[code]`, una página con
 * su propia URL.
 *
 * FILTROS (etapa BP5): quedó UNO. Antes había desplegable de Branch Manager,
 * desplegable de Branch y pills de estado. Con 13 branches en pantalla, filtrar
 * branches es más trabajo que mirarlos: la lista entra entera.
 *
 * El único que sobrevive busca PERSONAS, que es lo que no se puede hacer a ojo
 * -- con ~38 Loan Officers repartidos, "¿dónde está Kiana?" no se responde
 * mirando. Por eso el resultado de buscar "Kiana" es el branch 703, no un
 * branch que se llame parecido.
 */

/** El código de branch viaja en la URL y NO siempre es numérico: hay
 *  'Branch Out of Division' (con espacios). Codificar es obligatorio. */
function branchHref(code: string): string {
  return '/business-plan/branch/' + encodeURIComponent(code);
}

export default function BranchPortfolioPage() {
  const router = useRouter();
  const { data, isLoading, error } = useBusinessPlanData();
  const [loSearch, setLoSearch] = useState('');

  const visibleBranches = useMemo(() => {
    if (!data) return [];
    const needle = loSearch.trim().toLowerCase();
    if (!needle) return data.branches;
    // Muestra los branches que CONTIENEN a esa persona.
    return data.branches.filter((b) => b.loanOfficers.some((lo) => lo.fullName.toLowerCase().includes(needle)));
  }, [data, loSearch]);

  /** A quién encontró la búsqueda, para no dejar al usuario adivinando. */
  const matches = useMemo(() => {
    if (!data) return [];
    const needle = loSearch.trim().toLowerCase();
    if (!needle) return [];
    return data.loanOfficers.filter((lo) => lo.fullName.toLowerCase().includes(needle));
  }, [data, loSearch]);

  const totals = useMemo(() => {
    if (!data) return { branches: 0, los: 0, atRisk: 0, onTrack: 0 };
    return {
      branches: data.branches.length,
      // Un Loan Officer asignado a dos branches se cuenta una sola vez.
      los: new Set(data.branches.flatMap((b) => b.loanOfficers.map((lo) => lo.employeeKey))).size,
      atRisk: data.loanOfficers.filter((lo) => lo.verdict === 'on_risk').length,
      onTrack: data.loanOfficers.filter((lo) => lo.verdict === 'on_track').length,
    };
  }, [data]);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Branch Portfolio' }]} />

      <div className="page-head">
        <h1 className="page-head__title">Branch Portfolio</h1>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {data && (
        <>
          <div className="bp-kpis">
            <KpiCard label="Branches" value={totals.branches} />
            <KpiCard label="Loan Officers" value={totals.los} />
            <KpiCard label="On Risk" value={totals.atRisk} tone="risk" />
            <KpiCard label="On Track" value={totals.onTrack} tone="ok" />
          </div>

          <div className="control-bar">
            <div className="control-group">
              <span className="label-chip">Loan Officer</span>
              <input
                type="text"
                className="field bp-search"
                value={loSearch}
                onChange={(e) => setLoSearch(e.target.value)}
                placeholder="Search a person…"
                aria-label="Search loan officer"
              />
            </div>
            {loSearch.trim() !== '' && (
              <div className="control-group bp-search-hits">
                {matches.length === 0
                  ? 'No loan officer matches that name.'
                  : matches.map((lo) => lo.fullName + ' → ' + lo.branchCodes.join(', ')).join('  ·  ')}
              </div>
            )}
          </div>

          <div className="tbl-card tbl-card--floating">
            <div className="tbl-scroll">
              <table className="piv bp-table--cards bp-table--branches">
                {/*
                  El reparto de ancho lo fija el `<colgroup>`, no las celdas:
                  `table.piv` usa `table-layout: fixed`, donde un `min-width` en
                  el `td` se ignora. Etapa BP15 sumó la columna "With plan".
                */}
                <colgroup>
                  <col className="bp-col-branch" />
                  <col className="bp-col-manager" />
                  <col className="bp-col-count" />
                  <col className="bp-col-count" />
                  <col className="bp-col-count" />
                </colgroup>
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Branch</th>
                    <th className="bp-left">Branch Manager</th>
                    <th className="bp-center">Loan Officers</th>
                    <th className="bp-center">At Risk</th>
                    {/* Etapa BP34: la columna Status se fue -- es el mismo
                        indicador de intervención que se quitó del branch. */}
                    <th className="bp-center">With plan</th>
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
                      <td className="bp-left bp-ellipsis" title={b.branchManagers.join(' + ')}>
                        {b.branchManagers.length ? b.branchManagers.join(' + ') : <span className="bp-muted">—</span>}
                      </td>
                      <td className="bp-center">{b.totalLoanOfficers}</td>
                      {/* El cero se apaga para que sólo salten los branches con gente en riesgo. */}
                      <td className="bp-center">
                        {b.atRiskCount === 0 ? <span className="bp-muted">0</span> : <span className="bp-emphasis">{b.atRiskCount}</span>}
                      </td>
                      {/* Cuántos ya están cursando un plan. Es lo que explica que
                          un branch con gente en riesgo pueda estar "Atendido" en
                          vez de "Pendiente". */}
                      <td className="bp-center">
                        {b.loanOfficers.filter((lo) => lo.activePlan !== null).length === 0 ? (
                          <span className="bp-muted">0</span>
                        ) : (
                          b.loanOfficers.filter((lo) => lo.activePlan !== null).length
                        )}
                      </td>
                    </tr>
                  ))}
                  {!visibleBranches.length && (
                    <tr>
                      <td className="lbl bp-empty-cell" colSpan={6}>
                        No branch matches that search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Etapa BP16: el diagnóstico se mudó a Settings. Acá queda sólo la
              nota de cálculo, que explica los números de ESTA pantalla. */}
          <CalcNote data={data} />
        </>
      )}
    </>
  );
}
