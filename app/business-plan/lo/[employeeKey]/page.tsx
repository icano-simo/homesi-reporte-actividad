'use client';

import { useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { GAP_STATE_CLASS, GAP_STATE_LABEL } from '@/lib/business-plan/qualifiers';
import { monthsOfYear, currentYearMonth, formatYearMonth, shortMonth } from '@/lib/business-plan/months';
import type { MilestoneBucket } from '@/lib/business-plan/types';
import Breadcrumbs from '../../components/Breadcrumbs';
import MonthlyBarChart from '../../components/MonthlyBarChart';
import Modal from '../../components/Modal';
import BenchmarkEditor from '../../components/BenchmarkEditor';
import DecisionBar from '../../components/DecisionBar';
import {
  CalcNote,
  Diagnostics,
  ErrorState,
  LoadingState,
  NotFoundState,
  RoleChip,
  VerdictPanel,
  fmtActivityAvg,
  fmtAvg,
  fmtGap,
  fmtLoans,
  exactTitle,
  initialsOf,
} from '../../components/shared';

/**
 * ============================================================================
 * VISTA 3 — PERFIL DEL LOAN OFFICER
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO. Reescrita en BP5, que es cuando dejó de ser una
 * maqueta: el motor de veredicto ya está definido.
 *
 * El orden de la pantalla es deliberado:
 *   1. quién es y cuál es el veredicto
 *   2. Qualifier 1: el bloque forense del mes, el gráfico y las estadísticas
 *   3. Qualifier 2: la actividad comercial
 *   4. la barra de decisión, si hace falta actuar
 *   5. la nota de cálculo, ya fuera del área operativa
 */

const MILESTONES: MilestoneBucket[] = ['Started', 'Processing', 'Underwriting', 'Closing'];

export default function LoanOfficerDetailPage({ params }: { params: Promise<{ employeeKey: string }> }) {
  const { employeeKey: rawKey } = use(params);
  /*
   * `org.dim_employee.employee_key` es `bigint` (etapa BP6). En JavaScript no
   * hay enteros de 64 bits en `number`, así que el chequeo correcto es
   * `isSafeInteger` y no `isFinite`: `isFinite` acepta un valor que ya perdió
   * precisión al convertirse. Con las claves actuales (1..57) da igual, pero el
   * tipo de la columna admite valores que no darían igual.
   */
  const employeeKey = Number(rawKey);
  const router = useRouter();
  const { data, isLoading, error, reload } = useBusinessPlanData();

  const [openModal, setOpenModal] = useState<null | 'activity' | 'milestones'>(null);

  const lo = useMemo(
    () =>
      Number.isSafeInteger(employeeKey) ? (data?.loanOfficers.find((x) => x.employeeKey === employeeKey) ?? null) : null,
    [data, employeeKey]
  );

  const primaryBranch = lo?.branchCodes[0] ?? null;
  const reference = useMemo(() => new Date(), []);
  const yearMonths = useMemo(() => monthsOfYear(reference), [reference]);
  const thisMonth = currentYearMonth(reference);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          ...(primaryBranch ? [{ label: primaryBranch, href: '/business-plan/branch/' + encodeURIComponent(primaryBranch) }] : []),
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
          {/* ── 1. Identidad y veredicto ─────────────────────────────────── */}
          <div className="bp-profile">
            <div className="bp-profile__id">
              <div className="bp-avatar" aria-hidden="true">
                {initialsOf(lo.fullName)}
              </div>
              <div className="bp-profile__text">
                <h1 className="bp-profile__name">
                  {lo.fullName}
                  <RoleChip isBranchManager={lo.isBranchManager} isProducing={lo.isProducing} />
                </h1>
                <p className="bp-profile__meta">
                  Branch {lo.branchCodes.join(', ')}
                  {/*
                    Sin esta marca, alguien que sepa que las fuentes reportan
                    parte de su producción bajo otro branch leería el branch de
                    arriba como un error de atribución.
                  */}
                  {lo.attributionOverride && (
                    <span className="bp-chip" title={lo.attributionOverride.reason ?? undefined}>
                      Attribution forced
                    </span>
                  )}
                  {lo.tier && <> · Tier {lo.tier}</>}
                </p>
              </div>
            </div>
            {/* El veredicto es lo primero que hay que leer, no una pill al margen. */}
            <VerdictPanel verdict={lo.verdict} />
          </div>

          {/* ── 2. Qualifier 1 ───────────────────────────────────────────── */}
          <h2 className="bp-section-title">Qualifier 1 — volume</h2>

          {/*
           * Bloque forense del mes en curso, en el orden exacto que pidió el
           * negocio: de lo más cierto a lo más pronosticado. Ese orden es el
           * argumento -- primero lo que ya pasó, después lo que falta.
           */}
          <div className="bp-forensic">
            <ForensicItem label={'Closings in ' + shortMonth(thisMonth)} value={lo.projection.closedToDate} />
            <ForensicItem label="Total Pipeline" value={lo.projection.totalPipeline} suffix="loans" />
            <ForensicItem label="Healthy" value={lo.projection.healthyPipeline} suffix="loans" />
            {/* Entero: un préstamo es discreto. El exacto queda en el title. */}
            <ForensicItem
              label="Projected to close after PT"
              value={fmtLoans(lo.projection.projectedTotal)}
              title={exactTitle(lo.projection.projectedTotal)}
              strong
            />
          </div>

          {/*
            DESGLOSE POR CANAL. La proyección combina dos modelos distintos --
            Banked por cascada de milestone sobre los healthy, Brokered por tasa
            plana sobre el total-- y sin abrirlo el número de arriba es
            imposible de explicar. Sólo se muestran los canales con préstamos.
          */}
          <div className="bp-channels">
            {lo.projection.banked.loans > 0 && (
              <div className="bp-channel">
                <span className="bp-channel__name">Banked</span>
                <span className="bp-channel__detail">
                  {lo.projection.banked.loans} healthy loans → <strong>{fmtAvg(lo.projection.banked.projected)}</strong>{' '}
                  <span className="bp-channel__how">milestone cascade</span>
                </span>
              </div>
            )}
            {lo.projection.brokered.loans > 0 && (
              <div className="bp-channel">
                <span className="bp-channel__name">Brokered</span>
                <span className="bp-channel__detail">
                  {lo.projection.brokered.loans} loans → <strong>{fmtAvg(lo.projection.brokered.projected)}</strong>{' '}
                  <span className="bp-channel__how">flat rate, on the whole pipeline</span>
                </span>
              </div>
            )}
            {lo.projection.banked.loans === 0 && lo.projection.brokered.loans === 0 && (
              <div className="bp-channel">
                <span className="bp-channel__detail bp-muted">No open loans due to close this month.</span>
              </div>
            )}
          </div>

          <div className="bp-forensic-lines">
            {/* Sólo si tiene. Si no, la línea no se muestra. */}
            {lo.projection.inCtc + lo.projection.inClosing > 0 && (
              <p>
                <strong>Projected to close soon:</strong> {lo.projection.inCtc} in CTC · {lo.projection.inClosing} in
                Closing
              </p>
            )}
            <p>
              <button
                type="button"
                className="bp-linkish"
                onClick={() => setOpenModal('milestones')}
                title="Open the loan-by-loan detail"
              >
                {MILESTONES.map((m) => `${lo.projection.byMilestone[m]} in ${m}`).join(' · ')}
              </button>
            </p>
          </div>

          <div className="bp-q1-grid">
            <div className="mcard bp-chart-card">
              <MonthlyBarChart
                months={yearMonths}
                closingsByMonth={lo.activity.closingsByMonth}
                currentMonth={thisMonth}
                projection={lo.projection}
                benchmark={lo.monthlyBenchmark}
              />
            </div>

            {/*
             * Una línea por métrica: etiqueta a la izquierda, valor a la
             * derecha. Antes cada una ocupaba dos renglones y el panel se leía
             * como una lista de párrafos en vez de una ficha de datos.
             */}
            <div className="mcard bp-stats">
              {/*
               * Los DOS promedios, y no para suavizar el veredicto: son
               * diagnósticos distintos y cambian el tipo de ayuda.
               *   histórico bajo + proyección baja  = problema sostenido
               *   histórico bueno + proyección baja = se le secó el pipeline
               *   histórico bajo + proyección buena = ya está reaccionando
               * El GAP sale SIEMPRE del que incluye el mes actual, y por eso
               * ese va notablemente más grande que el resto.
               */}
              <div className="bp-stat bp-stat--hero">
                <span className="bp-stat__label">Avg 3M (with current month)</span>
                <span className="bp-stat__value" title={exactTitle(lo.q1.avgWithCurrent)}>
                  {fmtAvg(lo.q1.avgWithCurrent)}
                </span>
              </div>
              <div className="bp-stat">
                <span className="bp-stat__label">Avg 3M (closed months)</span>
                <span className="bp-stat__value" title={exactTitle(lo.avgClosedMonths)}>
                  {fmtAvg(lo.avgClosedMonths)}
                </span>
              </div>
              <div className="bp-stat">
                <span className="bp-stat__label">Benchmark</span>
                <BenchmarkEditor lo={lo} onSaved={reload} />
              </div>
              <div className="bp-stat">
                <span className="bp-stat__label">GAP</span>
                {/*
                 * Número y estado en la MISMA píldora: separados en dos
                 * renglones había que unirlos mentalmente para leer "−0,5 está
                 * en riesgo". Un decimal siempre -- redondear a entero
                 * convertiría un −0,5 en 0, o sea On Target, y cambiaría el
                 * veredicto en vez de la presentación.
                 */}
                {lo.q1.gap === null ? (
                  <span className="bp-muted">—</span>
                ) : (
                  <span
                    className={'bp-gap-pill ' + (lo.q1.state ? GAP_STATE_CLASS[lo.q1.state] : '')}
                    title={exactTitle(lo.q1.gap)}
                  >
                    <strong>{fmtGap(lo.q1.gap)}</strong>
                    {lo.q1.state && <span className="bp-gap-pill__state">{GAP_STATE_LABEL[lo.q1.state]}</span>}
                  </span>
                )}
              </div>
              <div className="bp-stat">
                <span className="bp-stat__label">YTD</span>
                <span className="bp-stat__value">{lo.ytdClosings}</span>
              </div>
            </div>
          </div>

          {/* ── 3. Qualifier 2 ───────────────────────────────────────────── */}
          <h2 className="bp-section-title">Qualifier 2 — commercial activity</h2>

          {lo.q2.metrics.length === 0 ? (
            <p className="bp-muted-line">No benchmark on record, so the required volumes cannot be derived.</p>
          ) : (
            /*
             * Tarjetas y no una tabla. La tabla decía "No" y dejaba al lector
             * restando para saber qué tan lejos estaba de la meta. Acá la barra
             * muestra la distancia y la píldora la dice en números.
             */
            <div className="bp-q2-cards">
              {lo.q2.metrics.map((m) => {
                const short = Math.max(0, m.required - m.actual);
                const pct = m.required <= 0 ? 0 : Math.min(100, (m.actual / m.required) * 100);
                return (
                  <div key={m.key} className={'bp-q2-card' + (m.meets ? ' is-met' : '')}>
                    <div className="bp-q2-card__name">{m.label}</div>
                    <div className="bp-q2-card__bar">
                      <div className="bp-q2-bar">
                        <div className="bp-q2-bar__fill" style={{ width: pct + '%' }} />
                      </div>
                      <div className="bp-q2-card__count">
                        {m.actual} of {m.required}
                        <span className="bp-q2-card__avg" title="Average of the three closed months">
                          · usually {fmtActivityAvg(m.trailingAvg)}/month
                        </span>
                      </div>
                    </div>
                    <span className={m.meets ? 'badge badge--pill badge--emerald' : 'badge badge--pill badge--rose'}>
                      {m.meets ? 'Met' : 'Short by ' + short}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <p className="bp-forensic-lines">
            <button type="button" className="bp-linkish" onClick={() => setOpenModal('activity')}>
              Open this year&apos;s commercial activity
            </button>
          </p>

          {/* ── 4. Barra de decisión ─────────────────────────────────────── */}
          <DecisionBar
            lo={lo}
            onChooseFunnel={() => router.push('/business-plan/lo/' + lo.employeeKey + '/funnel')}
            onReviewed={reload}
          />

          <CalcNote data={data} />
          <Diagnostics data={data} />

          {/* ── Modales: detalle complementario, nunca navegación ─────────── */}
          {openModal === 'activity' && (
            <Modal title={lo.fullName + ' — commercial activity ' + reference.getFullYear()} onClose={() => setOpenModal(null)}>
              <table className="piv">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Month</th>
                    <th className="bp-center">Files</th>
                    <th className="bp-center">Credit Reports</th>
                    <th className="bp-center">Applications</th>
                    <th className="bp-center">Closings</th>
                  </tr>
                </thead>
                <tbody>
                  {yearMonths.map((m) => (
                    <tr key={m} className="metric">
                      <td className="lbl">{formatYearMonth(m)}</td>
                      <td className="bp-center">{lo.activity.filesByMonth[m] ?? 0}</td>
                      <td className="bp-center">{lo.activity.creditReportsByMonth[m] ?? 0}</td>
                      <td className="bp-center">{lo.activity.applicationsByMonth[m] ?? 0}</td>
                      <td className="bp-center">{lo.activity.closingsByMonth[m] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Modal>
          )}

          {openModal === 'milestones' && (
            <Modal title={lo.fullName + ' — open loans by milestone'} onClose={() => setOpenModal(null)}>
              <table className="piv">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Milestone</th>
                    <th className="bp-left">Last milestone date</th>
                    <th className="bp-center">Healthy</th>
                    <th className="bp-center">Channel</th>
                    <th className="bp-center">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[...lo.openLoanDetail]
                    .sort((a, b) => MILESTONES.indexOf(a.milestone) - MILESTONES.indexOf(b.milestone))
                    .map((l, i) => (
                      <tr key={i} className="metric">
                        <td className="lbl">
                          {l.milestone}
                          {l.rawMilestone && l.rawMilestone !== l.milestone && <span className="bp-chip">{l.rawMilestone}</span>}
                        </td>
                        <td className="bp-left">{l.milestoneDate ?? '—'}</td>
                        <td className="bp-center">{l.healthy ? 'Yes' : 'No'}</td>
                        <td className="bp-center">{l.channel ?? '—'}</td>
                        <td className="bp-center">
                          {l.amount === null ? '—' : l.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    ))}
                  {lo.openLoanDetail.length === 0 && (
                    <tr>
                      <td className="lbl bp-empty-cell" colSpan={5}>
                        No open loans in the active snapshot.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Modal>
          )}
        </>
      )}
    </>
  );
}

function ForensicItem({
  label,
  value,
  suffix,
  strong,
  title,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  strong?: boolean;
  title?: string;
}) {
  return (
    <div className={'bp-forensic__item' + (strong ? ' is-strong' : '')} title={title}>
      <div className="bp-forensic__label">{label}</div>
      <div className="bp-forensic__value">
        {value}
        {suffix && <span className="bp-forensic__suffix"> {suffix}</span>}
      </div>
    </div>
  );
}
