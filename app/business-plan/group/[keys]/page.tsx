'use client';

import { useMemo, useState, use } from 'react';
import Link from 'next/link';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { aggregateGroup, parseKeys } from '@/lib/business-plan/group';
import { monthsOfYear, currentYearMonth } from '@/lib/business-plan/months';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../../components/Breadcrumbs';
import MonthlyBarChart from '../../components/MonthlyBarChart';
import LoanDetailModal, { type ModalKind } from '../../components/LoanDetailModal';
import { FunnelGlyph } from '../../components/funnelIcons';
import {
  ChannelBreakdown,
  ForensicCards,
  FuturePerformanceCards,
  Q1Panel,
  modalKindOfMetric,
} from '../../components/performance';
import {
  Avatar,
  CalcNote,
  ErrorState,
  LoadingState,
  VerdictBadge,
  VerdictPanel,
  exactTitle,
  fmtAvg,
  fmtGap,
} from '../../components/shared';

/**
 * ============================================================================
 * REVISIÓN CONJUNTA DE VARIOS LOAN OFFICERS
 * ============================================================================
 *
 * Etapa BP23 — ARCHIVO NUEVO. Etapa BP31 — REESCRITO SOBRE LOS COMPONENTES
 * COMPARTIDOS.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ESTA VISTA ES LA INDIVIDUAL CON LOS NÚMEROS SUMADOS. LITERALMENTE.
 * ---------------------------------------------------------------------------
 * BP23 la construyó con su propio markup, y por eso no recibió ninguno de los
 * cambios posteriores: en BP29 la regla de Future performance pasó al ritmo
 * prorrateado y sólo cambió en el perfil, así que el grupo se quedó mostrando el
 * acumulado contra la meta del mes entero -- la lógica que ese cambio había
 * reemplazado. No fue un descuido de nadie: el diseño lo garantizaba.
 *
 * Ahora `aggregateGroup` devuelve un `LoanOfficerRow` SINTÉTICO y esta página
 * monta los mismos componentes que el perfil -- `ForensicCards`,
 * `ChannelBreakdown`, `Q1Panel`, `FuturePerformanceCards`, `MonthlyBarChart` y
 * `LoanDetailModal` -- pasándoles esa fila. No hay una sola copia: cambiar una
 * regla en `components/performance.tsx` cambia las dos vistas a la vez.
 *
 * ---------------------------------------------------------------------------
 * LO QUE SÍ ES PROPIO DEL GRUPO
 * ---------------------------------------------------------------------------
 *   · el aviso de que el veredicto es informativo y no dispara nada
 *   · la lista de miembros con su veredicto individual
 *   · el benchmark como SUMA, con el desglose visible, en vez del editor
 *   · la nota sobre préstamos compartidos
 *
 * ---------------------------------------------------------------------------
 * ⚠ NO HAY PANEL DE NOTAS, Y ES DELIBERADO
 * ---------------------------------------------------------------------------
 * Una nota necesita un destino con FK, y un grupo NO es una entidad guardada:
 * es una selección momentánea que vive en una URL. `business_plan.note` tiene
 * una columna por destino justamente para que la base pueda garantizar que el
 * objeto al que apunta existe (ver el SQL de BP20); un grupo no tendría a qué
 * apuntar, y la única forma de darle una sería inventar una tabla de "grupos"
 * que nadie pidió y que habría que mantener.
 *
 * Si hace falta dejar constancia de una revisión conjunta, va como nota en el
 * perfil de cada miembro -- que además es donde alguien la va a buscar después.
 */

export default function GroupReviewPage({ params }: { params: Promise<{ keys: string }> }) {
  const { keys: rawKeys } = use(params);
  const keys = useMemo(() => parseKeys(rawKeys), [rawKeys]);

  const { data, isLoading, error } = useBusinessPlanData();
  const [openModal, setOpenModal] = useState<ModalKind | null>(null);

  /* El reloj se lee UNA vez: dos renders del mismo estado no pueden discrepar. */
  const [now] = useState(() => new Date());
  const thisMonth = currentYearMonth(now);
  const yearMonths = useMemo(() => monthsOfYear(now), [now]);

  const members = useMemo(
    () => (data ? keys.map((k) => data.loanOfficers.find((lo) => lo.employeeKey === k)).filter(Boolean) : []),
    [data, keys]
  ) as NonNullable<typeof data>['loanOfficers'];

  const missing = keys.length - members.length;

  const group = useMemo(() => {
    if (!data || members.length === 0) return null;
    const d = data.diagnostics;
    return aggregateGroup(members, d.windowMonths, d.closedMonths, thisMonth, d.rates, now.getDate());
  }, [data, members, thisMonth, now]);

  const branches = useMemo(() => [...new Set(members.flatMap((m) => m.branchCodes))].sort(), [members]);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          ...(branches.length === 1
            ? [{ label: branches[0], href: '/business-plan/branch/' + encodeURIComponent(branches[0]) }]
            : []),
          { label: 'Group review' },
        ]}
      />

      <div className="bp-eyebrow">Business Plan · Group review</div>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {members.length > 0 ? members.length : keys.length} loan officers, reviewed together
          </h1>
          <p className="page-head__subtitle">
            {branches.length > 0 && <>Branch {branches.join(', ')} · </>}
            Volume and activity added up across the group.
          </p>
        </div>
        {group && <VerdictPanel verdict={group.row.verdict} />}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {data && members.length === 0 && (
        <div className="empty">
          <h2>Nobody in this group</h2>
          <p>
            <Link href="/business-plan" className="bp-crumbs__current">
              Back to Branch Portfolio
            </Link>
          </p>
        </div>
      )}

      {data && missing > 0 && members.length > 0 && (
        <div className="bp-pending" role="status">
          <AlertTriangleIcon size={14} />
          <span>
            {missing} of the {keys.length} keys in the link are not in the active roster — they are left out of every
            number below.
          </span>
        </div>
      )}

      {group && data && (
        <>
          {/*
            ⚠ El aviso de que esto no dispara nada. Va ARRIBA, junto al
            veredicto, y no al pie: quien mira un badge "On Risk" idéntico al del
            perfil individual actúa antes de llegar al final de la página.
          */}
          <div className="bp-group-note">
            <strong>This verdict is informative.</strong> It uses the same rules as an individual one — the same
            qualifiers, the same pace bands — applied to the added-up numbers. But it triggers no Business Plan: plans
            belong to people, and a group has no funnel, no stages and nobody accountable for them. To act, open a
            member below.
          </div>

          {/* ── Current performance ─────────────────────────────────────────── */}
          <h2 className="bp-section-title">Current performance — this month&apos;s pipeline, added up</h2>
          <ForensicCards lo={group.row} thisMonth={thisMonth} onOpen={(t) => setOpenModal(t)} />
          <ChannelBreakdown lo={group.row} />

          <div className="bp-q1-grid">
            <div className="mcard bp-chart-card">
              <MonthlyBarChart
                months={yearMonths}
                closingsByMonth={group.row.activity.closingsByMonth}
                currentMonth={thisMonth}
                projection={group.row.projection}
                benchmark={group.row.monthlyBenchmark}
                onSelectMonth={(m) => setOpenModal({ month: m })}
              />
            </div>

            {/*
              El mismo panel del perfil. Lo único distinto es el benchmark: acá
              es la SUMA de los individuales y no se edita, así que en vez del
              editor va el número con su desglose a la vista.
            */}
            <Q1Panel
              lo={group.row}
              benchmarkSlot={
                <span
                  className="bp-stat__value"
                  title={members.map((m) => `${m.fullName} ${m.monthlyBenchmark ?? '—'}`).join(' · ')}
                >
                  {group.row.monthlyBenchmark === null ? (
                    <span className="bp-muted">—</span>
                  ) : (
                    <>
                      {group.row.monthlyBenchmark.toFixed(1)}
                      <span className="bp-group-sum">
                        {' '}
                        = {members.map((m) => (m.monthlyBenchmark ?? 0).toFixed(1)).join(' + ')}
                      </span>
                    </>
                  )}
                </span>
              }
            />
          </div>

          {/*
            ⚠ Sin benchmark de alguien, el GAP NO se calcula y NO se rellena con
            cero. Un cero diría que a esa persona no se le pide nada, y el GAP
            del grupo saldría mejor de lo que es.
          */}
          {group.missingBenchmark.length > 0 && (
            <div className="bp-pending" role="status">
              <AlertTriangleIcon size={14} />
              <span>
                No group GAP: {group.missingBenchmark.map((m) => m.fullName).join(', ')}{' '}
                {group.missingBenchmark.length === 1 ? 'has' : 'have'} no benchmark. Treating a missing benchmark as
                zero would make the group look better than it is, so the whole sum is left undefined.
              </span>
            </div>
          )}

          {/* ── Future performance ──────────────────────────────────────────── */}
          <h2 className="bp-section-title">
            Future performance —{' '}
            <button type="button" className="bp-title-btn" onClick={() => setOpenModal('activity')}>
              commercial activity
            </button>
            , added up
          </h2>

          {group.row.q2.metrics.length === 0 ? (
            <p className="bp-muted-line">
              No group benchmark, so the required volumes cannot be derived — see the note above.
            </p>
          ) : (
            <FuturePerformanceCards
              metrics={group.row.q2.metrics}
              onOpenMetric={(k) => setOpenModal(modalKindOfMetric(k))}
            />
          )}

          {/* La deduplicación, dicha. Callarla dejaría la duda de si se comprobó. */}
          <div className="bp-group-dedupe">
            {group.sharedOpenLoans === 0 ? (
              <>No pipeline loan appears under two members of this group, so nothing is counted twice.</>
            ) : (
              <>
                <strong>{group.sharedOpenLoans}</strong> pipeline loan(s) appeared under more than one member and were
                counted once.
              </>
            )}{' '}
            Closings cannot be checked the same way today: <code>loan_number</code> is empty in the active Commercial
            Activity batch — it only started being stored in BP9/BP11, after that upload. A zero here means &ldquo;no
            key to compare&rdquo;, not &ldquo;checked and clean&rdquo;.
          </div>

          {/* ── Quiénes componen el grupo ───────────────────────────────────── */}
          <h2 className="bp-section-title">Who is in this group</h2>
          <div className="tbl-card tbl-card--floating">
            <div className="tbl-scroll">
              <table className="piv bp-table--los">
                <colgroup>
                  <col className="bp-col-name" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-metric" />
                  <col className="bp-col-status" />
                </colgroup>
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Loan Officer</th>
                    <th className="bp-center">Avg 3M</th>
                    <th className="bp-center">Benchmark</th>
                    <th className="bp-center">GAP</th>
                    <th className="bp-center">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.employeeKey} className="metric">
                      <td className="lbl">
                        <Avatar name={m.fullName} />
                        <Link href={'/business-plan/lo/' + m.employeeKey} className="bp-linkish">
                          {m.fullName}
                        </Link>
                        {m.activePlan && (
                          <span className="bp-plan-chip" title={m.activePlan.funnelName}>
                            <FunnelGlyph icon={m.activePlan.funnelIcon} size={11} />
                            plan {m.activePlan.doneMilestones}/{m.activePlan.totalMilestones}
                          </span>
                        )}
                      </td>
                      <td className="bp-center" title={exactTitle(m.q1.avgWithCurrent)}>
                        {fmtAvg(m.q1.avgWithCurrent)}
                      </td>
                      <td className="bp-center">{m.monthlyBenchmark === null ? '—' : m.monthlyBenchmark.toFixed(1)}</td>
                      <td className="bp-center">{fmtGap(m.q1.gap)}</td>
                      <td className="bp-center">
                        <VerdictBadge verdict={m.verdict} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <CalcNote data={data} />

          {/*
            Los MISMOS modales que el perfil: la fila sintética tiene los mismos
            campos, así que `LoanDetailModal` no distingue una persona de un
            grupo. Los préstamos ya vienen deduplicados de `aggregateGroup`, así
            que el detalle no repite ninguno.
          */}
          {openModal !== null && (
            <LoanDetailModal
              kind={openModal}
              lo={group.row}
              thisMonth={thisMonth}
              year={now.getFullYear()}
              yearMonths={yearMonths}
              onClose={() => setOpenModal(null)}
            />
          )}
        </>
      )}
    </>
  );
}
