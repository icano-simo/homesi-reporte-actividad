'use client';

import { useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { branchStatusClass, branchStatusLabel } from '@/lib/business-plan/intervention';
import { serializeKeys } from '@/lib/business-plan/group';
import Breadcrumbs from '../../components/Breadcrumbs';
import {
  CalcNote,
  ErrorState,
  KpiCard,
  LoadingState,
  NotFoundState,
  RoleChip,
  VerdictBadge,
  fmtActivityAvg,
  fmtAvg,
  exactTitle,
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
  /*
   * Etapa BP23. Un `Set` de claves y no un flag por fila: la selección tiene
   * que sobrevivir a filtrar por nombre. Con un booleano dentro de cada fila,
   * escribir en el buscador habría borrado en silencio a los que dejaron de
   * verse -- y el conteo de la barra habría cambiado solo.
   */
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const togglePick = (k: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

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
            <KpiCard label="Avg Closings 3M" value={fmtAvg(branch.avgClosings3m)} />
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
          <div className="tbl-card tbl-card--floating">
            <div className="tbl-scroll">
              <table className="piv bp-table--cards bp-table--los">
                {/*
                  Etapa BP17: se quitaron Benchmark y GAP de esta tabla.

                  El veredicto SIGUE derivando de los dos. Alguien va a ver
                  "On Risk" sin ver por que, y la explicacion esta en el perfil
                  -- por eso el benchmark NO se toco alla: es donde se explica.

                  Las tres metricas de actividad pasan a PROMEDIO MENSUAL de los
                  3 meses cerrados. Antes eran el acumulado del lote, que no se
                  puede comparar ni entre personas ni entre meses.
                */}
                <colgroup>
                  <col className="bp-col-pick" />
                  <col className="bp-col-name" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-status" />
                </colgroup>
                <thead>
                  <tr className="mo-row">
                    <th className="bp-center bp-pick-cell">
                      {/*
                        La casilla de "todos" opera sobre los VISIBLES, no sobre
                        el branch entero: marcar una casilla que dice "todos" y
                        que además seleccione a cinco personas que el filtro está
                        escondiendo sería una trampa.
                      */}
                      <input
                        type="checkbox"
                        aria-label="Select every visible loan officer"
                        title="Select every visible loan officer"
                        checked={visibleLos.length > 0 && visibleLos.every((lo) => picked.has(lo.employeeKey))}
                        ref={(el) => {
                          if (el) {
                            const some = visibleLos.some((lo) => picked.has(lo.employeeKey));
                            const all = visibleLos.length > 0 && visibleLos.every((lo) => picked.has(lo.employeeKey));
                            el.indeterminate = some && !all;
                          }
                        }}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            for (const lo of visibleLos) {
                              if (e.target.checked) next.add(lo.employeeKey);
                              else next.delete(lo.employeeKey);
                            }
                            return next;
                          })
                        }
                      />
                    </th>
                    <th className="lbl">Loan Officer</th>
                    <th className="bp-center">Avg Closings 3M</th>
                    <th className="bp-center">Avg Credit Apps</th>
                    <th className="bp-center">Avg Pre-Approvals</th>
                    <th className="bp-center">Avg File Creations</th>
                    <th className="bp-center">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLos.map((lo) => (
                    <tr
                      key={lo.employeeKey}
                      className={'metric bp-row-link' + (picked.has(lo.employeeKey) ? ' is-picked' : '')}
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
                      {/*
                        `stopPropagation`: la fila entera es un enlace al perfil
                        desde BP1. Sin esto, marcar la casilla navegaba y la
                        selección se perdia antes de verse.
                      */}
                      <td className="bp-center bp-pick-cell" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={picked.has(lo.employeeKey)}
                          aria-label={'Select ' + lo.fullName}
                          onChange={() => togglePick(lo.employeeKey)}
                        />
                      </td>
                      <td className="lbl">
                        {/* Siempre el nombre canónico del roster, nunca el crudo de la fuente. */}
                        {lo.fullName}
                        <RoleChip isBranchManager={lo.isBranchManager} isProducing={lo.isProducing} />
                        {/* Quién ya está cursando un plan: el mismo dato que
                            alimenta el Status de intervención del branch. */}
                        {lo.activePlan && (
                          <span
                            className="bp-plan-chip"
                            title={`${lo.activePlan.funnelName} · ${lo.activePlan.doneMilestones} of ${lo.activePlan.totalMilestones} stages`}
                          >
                            plan {lo.activePlan.doneMilestones}/{lo.activePlan.totalMilestones}
                          </span>
                        )}
                      </td>
                      <td className="bp-center" title={exactTitle(lo.q1.avgWithCurrent)}>
                        {fmtAvg(lo.q1.avgWithCurrent)}
                      </td>
                      {/* Promedios mensuales, no acumulados: comparables entre personas. */}
                      <td
                        className={'bp-center' + (lo.trailingActivityAvg.applications ? '' : ' zero')}
                        title={exactTitle(lo.trailingActivityAvg.applications)}
                      >
                        {fmtActivityAvg(lo.trailingActivityAvg.applications)}
                      </td>
                      <td
                        className={'bp-center' + (lo.trailingActivityAvg.creditReports ? '' : ' zero')}
                        title={exactTitle(lo.trailingActivityAvg.creditReports)}
                      >
                        {fmtActivityAvg(lo.trailingActivityAvg.creditReports)}
                      </td>
                      <td
                        className={'bp-center' + (lo.trailingActivityAvg.fileCreations ? '' : ' zero')}
                        title={exactTitle(lo.trailingActivityAvg.fileCreations)}
                      >
                        {fmtActivityAvg(lo.trailingActivityAvg.fileCreations)}
                      </td>
                      <td className="bp-center">
                        <VerdictBadge verdict={lo.verdict} />
                      </td>
                    </tr>
                  ))}
                  {!visibleLos.length && (
                    <tr>
                      <td className="lbl bp-empty-cell" colSpan={7}>
                        No loan officer matches that search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/*
            ⚠ La barra aparece a partir de DOS. Con uno solo, "revisar en
            conjunto" es su propio perfil, que ya está a un clic en la fila.
          */}
          {picked.size >= 2 && (
            <div className="bp-pickbar" role="region" aria-label="Group review">
              <span className="bp-pickbar__count">{picked.size} selected</span>
              <span className="bp-pickbar__names">
                {[...picked]
                  .map((k) => branch.loanOfficers.find((lo) => lo.employeeKey === k)?.fullName)
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <button type="button" className="bp-linkish" onClick={() => setPicked(new Set())}>
                clear
              </button>
              <button
                type="button"
                className="bp-btn bp-btn--primary bp-btn--small"
                onClick={() => router.push('/business-plan/group/' + serializeKeys([...picked]))}
              >
                Review together
              </button>
            </div>
          )}

          {/* Etapa BP16: el diagnóstico se mudó a Settings. Acá queda sólo la
              nota de cálculo, que explica los números de ESTA pantalla. */}
          <CalcNote data={data} />
        </>
      )}
    </>
  );
}
