'use client';

import { useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { monthsOfYear, currentYearMonth } from '@/lib/business-plan/months';
import Breadcrumbs from '../../components/Breadcrumbs';
import MonthlyBarChart from '../../components/MonthlyBarChart';
import LoanDetailModal, { type ModalKind } from '../../components/LoanDetailModal';
import BenchmarkEditor from '../../components/BenchmarkEditor';
import DecisionBar from '../../components/DecisionBar';
import {
  ChannelBreakdown,
  ForensicCards,
  FuturePerformanceCards,
  Q1Panel,
  modalKindOfMetric,
} from '../../components/performance';
import NotesPanel from '../../components/NotesPanel';
import { FunnelGlyph } from '../../components/funnelIcons';
import {
  CalcNote,
  ErrorState,
  LoadingState,
  NotFoundState,
  RoleChip,
  VerdictPanel,
  Avatar,
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

  const [openModal, setOpenModal] = useState<ModalKind | null>(null);

  const lo = useMemo(
    () =>
      Number.isSafeInteger(employeeKey) ? (data?.loanOfficers.find((x) => x.employeeKey === employeeKey) ?? null) : null,
    [data, employeeKey]
  );

  const primaryBranch = lo?.branchCodes[0] ?? null;
  const reference = useMemo(() => new Date(), []);
  const yearMonths = useMemo(() => monthsOfYear(reference), [reference]);
  const thisMonth = currentYearMonth(reference);
  /* `projectedFromPipeline` y `ctcAndClosing` se mudaron a `ForensicCards`
     junto con las tarjetas que los usaban (etapa BP31). */

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
              {/*
                Etapa BP21: el mismo componente que el resto del modulo, para
                que esta persona tenga el mismo tono aca y en cualquier otra
                pantalla donde aparezca su avatar.
              */}
              <Avatar name={lo.fullName} size="md" />
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

          {/*
            Si ya tiene plan, se dice ARRIBA y visible. Sin esto el perfil se veía
            igual antes y después de activar, y no había forma de saber desde acá
            que la persona ya estaba cursando algo.
          */}
          {lo.activePlan && (
            <button
              type="button"
              className="bp-plan-banner"
              onClick={() => router.push('/business-plan/lo/' + lo.employeeKey + '/plan')}
            >
              <span className="bp-plan-banner__label">Active business plan</span>
              <span className="bp-plan-banner__name">
                {/* Etapa BP21: el icono del funnel, tambien aca. */}
                <FunnelGlyph icon={lo.activePlan.funnelIcon} size={18} />
                {lo.activePlan.funnelName}
              </span>
              <span className="bp-plan-banner__meta">
                {lo.activePlan.doneMilestones} of {lo.activePlan.totalMilestones} stages · since{' '}
                {lo.activePlan.activatedAt.slice(0, 10)}
              </span>
              <span className="bp-plan-banner__cta">See progress →</span>
            </button>
          )}

          {/* ── 2. Qualifier 1 ───────────────────────────────────────────── */}
          <h2 className="bp-section-title">Current performance — this month&apos;s pipeline</h2>

          {/*
            Etapa BP31: las cinco tarjetas y el desglose por canal se mudaron a
            `components/performance.tsx`, tal cual estaban. La revisión conjunta
            monta EXACTAMENTE estos componentes con los números sumados -- es lo
            que impide que las dos vistas vuelvan a divergir.
          */}
          <ForensicCards lo={lo} thisMonth={thisMonth} onOpen={(t) => setOpenModal(t)} />
          <ChannelBreakdown lo={lo} />

          {/*
            Etapa BP9: acá iba el desglose por milestone
            ("2 in Started · 0 in Processing · …"). Se quitó: sumaba 8 al lado
            de un chip que decía 7 healthy y parecía un error sin serlo -- el
            desglose cuenta TODO el pipeline y el chip sólo los healthy. Ese
            detalle vive ahora dentro de los modales de las tarjetas, donde cada
            préstamo se ve con su milestone y no hay dos totales compitiendo.
          */}

          <div className="bp-q1-grid">
            <div className="mcard bp-chart-card">
              <MonthlyBarChart
                months={yearMonths}
                closingsByMonth={lo.activity.closingsByMonth}
                currentMonth={thisMonth}
                projection={lo.projection}
                benchmark={lo.monthlyBenchmark}
                onSelectMonth={(m) => setOpenModal({ month: m })}
              />
            </div>

            {/*
              El panel del GAP también es compartido. Lo único propio del perfil
              es el EDITOR del benchmark: el del grupo es una suma y no se edita.
            */}
            <Q1Panel lo={lo} benchmarkSlot={<BenchmarkEditor lo={lo} onSaved={reload} />} />
          </div>

          {/* ── 3. Qualifier 2 ───────────────────────────────────────────── */}
          {/* El título abre la actividad del año; cada métrica, su detalle. */}
          <h2 className="bp-section-title">
            Future performance —{' '}
            <button type="button" className="bp-title-btn" onClick={() => setOpenModal('activity')}>
              commercial activity
            </button>
          </h2>

          {lo.q2.metrics.length === 0 ? (
            <p className="bp-muted-line">No benchmark on record, so the required volumes cannot be derived.</p>
          ) : (
            /*
             * Tarjetas y no una tabla. La tabla decía "No" y dejaba al lector
             * restando para saber qué tan lejos estaba de la meta. Acá la barra
             * muestra la distancia y la píldora la dice en números.
             */
            <FuturePerformanceCards metrics={lo.q2.metrics} onOpenMetric={(k) => setOpenModal(modalKindOfMetric(k))} />
          )}

          {/* ── 4. Barra de decisión ─────────────────────────────────────── */}
          <DecisionBar
            lo={lo}
            onChooseFunnel={() => router.push('/business-plan/lo/' + lo.employeeKey + '/funnel')}
            onReviewed={reload}
            onSeeProgress={() => router.push('/business-plan/lo/' + lo.employeeKey + '/plan')}
          />

          {/*
            ── 5. Notas del perfil — etapa BP20 ────────────────────────────
            El nivel más alto de los cuatro: lo que no cuelga de ningún paso ni
            de ninguna etapa. Contexto de la persona, acuerdos generales, por
            qué se la pasó a Watch. Va después de la barra de decisión porque se
            escribe DESPUÉS de decidir, no antes.
          */}
          <NotesPanel
            target={{ kind: 'employee', key: lo.employeeKey }}
            title={'Notes on ' + lo.fullName}
            placeholder="What was discussed with this loan officer, what was agreed…"
          />

          {/* Etapa BP16: el diagnóstico se mudó a Settings. Acá queda sólo la
              nota de cálculo, que explica los números de ESTA pantalla. */}
          <CalcNote data={data} />

          {/* ── Modales: detalle complementario, nunca navegación ─────────── */}
          {openModal !== null && (
            <LoanDetailModal
              kind={openModal}
              lo={lo}
              thisMonth={thisMonth}
              year={reference.getFullYear()}
              yearMonths={yearMonths}
              onClose={() => setOpenModal(null)}
            />
          )}

        </>
      )}
    </>
  );
}
