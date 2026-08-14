'use client';

import { useMemo, useState, use, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { GAP_STATE_LABEL } from '@/lib/business-plan/qualifiers';
import { monthsOfYear, currentYearMonth, shortMonth } from '@/lib/business-plan/months';
import Breadcrumbs from '../../components/Breadcrumbs';
import MonthlyBarChart from '../../components/MonthlyBarChart';
import LoanDetailModal, { type ModalKind } from '../../components/LoanDetailModal';
import BenchmarkEditor from '../../components/BenchmarkEditor';
import DecisionBar from '../../components/DecisionBar';
import NotesPanel from '../../components/NotesPanel';
import { FunnelGlyph } from '../../components/funnelIcons';
import {
  CalcNote,
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
  /* Lo que aporta el pipeline, sin lo ya cerrado. Forecast Total suma los dos. */
  const projectedFromPipeline = lo ? lo.projection.projectedTotal - lo.projection.closedToDate : 0;
  const ctcAndClosing = lo ? lo.projection.inCtc + lo.projection.inClosing : 0;

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
          <h2 className="bp-section-title">Qualifier 1 — volume</h2>

          {/*
           * Bloque forense del mes en curso, en el orden exacto que pidió el
           * negocio: de lo más cierto a lo más pronosticado. Ese orden es el
           * argumento -- primero lo que ya pasó, después lo que falta.
           */}
          {/*
            Cinco tarjetas, todas clickeables: cada una abre el detalle de los
            préstamos que la componen. El orden es el del argumento -- de lo más
            cierto a lo más pronosticado -- y el total va al final.

            Todos los números ENTEROS: un préstamo es discreto. El valor exacto
            de los que son fraccionarios queda en el `title`.
          */}
          <div className="bp-forensic">
            <ForensicItem
              label={'Closings in ' + shortMonth(thisMonth) + ' so far'}
              value={lo.projection.closedToDate}
              onClick={() => setOpenModal('closed')}
            />
            <ForensicItem
              label="Total Pipeline"
              value={lo.projection.totalPipeline}
              suffix="loans"
              onClick={() => setOpenModal('pipeline')}
            />
            <ForensicItem
              label="Healthy"
              value={lo.projection.healthyPipeline}
              suffix="loans"
              onClick={() => setOpenModal('healthy')}
            />
            <ForensicItem
              label="Projected to close after PT"
              value={fmtLoans(projectedFromPipeline)}
              title={exactTitle(projectedFromPipeline)}
              onClick={() => setOpenModal('projected')}
            />
            {/*
              Forecast Total = proyectado + cerrado. Es el número que alimenta
              el GAP, así que va destacado. Los préstamos en CTC/Closing se
              marcan con el mismo punto verde que usa Forecast en su pivot: son
              los que están a un paso de cerrar.
            */}
            <ForensicItem
              label="Forecast Total"
              value={fmtLoans(lo.projection.projectedTotal)}
              title={exactTitle(lo.projection.projectedTotal)}
              strong
              onClick={() => setOpenModal('forecast')}
              badge={
                ctcAndClosing > 0 ? (
                  <span className="bp-ctc-mark" title={`${lo.projection.inCtc} in CTC · ${lo.projection.inClosing} in Closing`}>
                    <i className="ctc-dot" />
                    {ctcAndClosing} CTC
                  </span>
                ) : null
              }
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
             * Una línea por métrica: etiqueta a la izquierda, valor a la
             * derecha. Antes cada una ocupaba dos renglones y el panel se leía
             * como una lista de párrafos en vez de una ficha de datos.
             */}
            {/*
             * JERARQUÍA DEL PANEL — etapa BP10, y el cambio es deliberado.
             *
             * Hasta BP9 el número grande era el promedio con mes actual. Estaba
             * mal: el promedio es el INSUMO y el GAP es la CONCLUSIÓN -- es lo
             * que decide el veredicto. Con dos números grandes en el mismo
             * panel no había ninguno destacado.
             *
             * Ahora todas las filas son normales y sólo el GAP sale del renglón.
             */}
            <div className="mcard bp-stats">
              {/*
               * Los DOS promedios, y no para suavizar el veredicto: son
               * diagnósticos distintos y cambian el tipo de ayuda.
               *   histórico bajo + proyección baja  = problema sostenido
               *   histórico bueno + proyección baja = se le secó el pipeline
               *   histórico bajo + proyección buena = ya está reaccionando
               * El GAP sale SIEMPRE del que incluye el mes actual.
               */}
              <div className="bp-stat">
                <span className="bp-stat__label">Avg 3M (with current month)</span>
                <span className="bp-stat__value" title={exactTitle(lo.q1.avgWithCurrent)}>
                  {fmtAvg(lo.q1.avgWithCurrent)}
                </span>
              </div>
              <div className="bp-stat bp-stat--muted">
                <span className="bp-stat__label">Avg 3M (closed months)</span>
                <span className="bp-stat__value" title={exactTitle(lo.avgClosedMonths)}>
                  {fmtAvg(lo.avgClosedMonths)}
                </span>
              </div>
              {/* Neutro a propósito: el benchmark es una referencia, no una alerta. */}
              <div className="bp-stat">
                <span className="bp-stat__label">Benchmark</span>
                <BenchmarkEditor lo={lo} onSaved={reload} />
              </div>

              {/*
               * GAP: su propio contenedor, número grande y la píldora del estado
               * al lado. El color viene del ESTADO y no fijo en rojo -- alguien
               * On Target con GAP +0,6 dentro de un recuadro rojo leería lo
               * contrario de su veredicto.
               *
               * Un decimal siempre: redondear a entero convertiría un −0,5 en 0,
               * o sea On Target, y eso cambia veredictos, no la presentación.
               */}
              <div className={'bp-gap-hero' + (lo.q1.state ? ' bp-gap-hero--' + lo.q1.state : '')}>
                <span className="bp-stat__label">GAP</span>
                {lo.q1.gap === null ? (
                  <span className="bp-muted">—</span>
                ) : (
                  <div className="bp-gap-hero__row">
                    <span className="bp-gap-hero__value" title={exactTitle(lo.q1.gap)}>
                      {fmtGap(lo.q1.gap)}
                    </span>
                    {lo.q1.state && <span className="bp-gap-hero__state">{GAP_STATE_LABEL[lo.q1.state]}</span>}
                  </div>
                )}
              </div>

              <div className="bp-stat">
                <span className="bp-stat__label">YTD closings</span>
                <span className="bp-stat__value">{lo.ytdClosings}</span>
              </div>
            </div>
          </div>

          {/* ── 3. Qualifier 2 ───────────────────────────────────────────── */}
          {/* El título abre la actividad del año; cada métrica, su detalle. */}
          <h2 className="bp-section-title">
            Qualifier 2 —{' '}
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
            <div className="bp-q2-cards">
              {lo.q2.metrics.map((m) => {
                const short = Math.max(0, m.required - m.actual);
                const pct = m.required <= 0 ? 0 : Math.min(100, (m.actual / m.required) * 100);
                return (
                  <div key={m.key} className={'bp-q2-card' + (m.meets ? ' is-met' : '')}>
                    <button
                      type="button"
                      className="bp-q2-card__name"
                      onClick={() => setOpenModal(m.key === 'fileCreations' ? 'files' : m.key === 'creditReports' ? 'credit' : 'apps')}
                    >
                      {m.label}
                    </button>
                    <div className="bp-q2-card__count">
                      {m.actual} of {m.required}
                    </div>
                    <div className="bp-q2-bar">
                      <div className="bp-q2-bar__fill" style={{ width: pct + '%' }} />
                    </div>
                    <span className={m.meets ? 'badge badge--pill badge--emerald' : 'badge badge--pill badge--rose'}>
                      {m.meets ? 'Met' : 'Short by ' + short}
                    </span>
                    <div className="bp-q2-card__avg" title="Average of the three closed months">
                      usually {fmtActivityAvg(m.trailingAvg)}/month
                    </div>
                  </div>
                );
              })}
            </div>
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

/**
 * Tarjeta del bloque forense.
 *
 * Es un `<button>` y no un `<div onClick>`: así entra en el orden de tabulación
 * y se activa con Enter sin que haya que reimplementar nada de eso a mano.
 */
function ForensicItem({
  label,
  value,
  suffix,
  strong,
  title,
  onClick,
  badge,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  strong?: boolean;
  title?: string;
  onClick?: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={'bp-forensic__item' + (strong ? ' is-strong' : '')}
      title={title}
      onClick={onClick}
    >
      <div className="bp-forensic__value">
        {value}
        {suffix && <span className="bp-forensic__suffix"> {suffix}</span>}
      </div>
      <div className="bp-forensic__label">{label}</div>
      {badge}
    </button>
  );
}
