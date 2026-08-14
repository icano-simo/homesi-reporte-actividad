'use client';

import { useMemo, useState, use } from 'react';
import Link from 'next/link';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { useEnrollment } from '@/lib/business-plan/useEnrollment';
import { useBaseline } from '@/lib/business-plan/useBaseline';
import { progressOf } from '@/lib/business-plan/funnels';
import { formatYearMonth, monthsOfYear, currentYearMonth, shortMonth } from '@/lib/business-plan/months';
import {
  METRIC_LABEL,
  averageOver,
  completeMonthsAfter,
  firstMeasurableMonth,
  fmtPct,
  monthOf,
  pctChange,
  seriesOf,
  type MetricKey,
} from '@/lib/business-plan/impact';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../../../components/Breadcrumbs';
import ImpactChart from '../../../components/ImpactChart';
import { FunnelGlyph } from '../../../components/funnelIcons';
import { ErrorState, LoadingState } from '../../../components/shared';

/**
 * ============================================================================
 * IMPACTO DEL BUSINESS PLAN
 * ============================================================================
 *
 * Etapa BP22 — ARCHIVO NUEVO.
 *
 * Responde una sola pregunta: desde que esta persona se enroló, ¿cambió algo?
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL "ANTES" ESTÁ CONGELADO. EL "DESPUÉS" ES EN VIVO.
 * ---------------------------------------------------------------------------
 * La asimetría es el diseño, no un descuido. El antes sale de
 * `business_plan.enrollment_baseline`, escrito el día de la activación; el
 * después se lee de los datos actuales, mes a mes.
 *
 * Si el antes se recalculara, cambiaría solo: Commercial Activity se rehace con
 * cada carga y las reglas cambian -- el cambio de Heather movió préstamos de un
 * mes a otro. El "impacto" se movería sin que la persona hubiera hecho nada.
 *
 * ---------------------------------------------------------------------------
 * DOS HONESTIDADES QUE ESTA PANTALLA NO NEGOCIA
 * ---------------------------------------------------------------------------
 * 1. El mes del enrolamiento está PARTIDO y no cuenta de ningún lado.
 * 2. Sin un solo mes completo posterior NO SE MUESTRA NINGUNA COMPARACIÓN. Hoy
 *    es el caso: los dos planes se activaron el 14 de agosto de 2026. Una
 *    pantalla que dice "todavía no hay historia" es infinitamente mejor que una
 *    que muestra un −100% falso porque dividió por un mes que no terminó.
 */

const METRICS: MetricKey[] = ['closings', 'creditApplications', 'preApprovals', 'fileCreations'];

export default function ImpactPage({ params }: { params: Promise<{ employeeKey: string }> }) {
  const { employeeKey: rawKey } = use(params);
  const employeeKey = Number(rawKey);

  const { data, isLoading: loadingRoster, error } = useBusinessPlanData();
  const { plan, isLoading: loadingPlan, available } = useEnrollment(employeeKey);
  const { baseline, isLoading: loadingBase, available: baseAvailable } = useBaseline(plan?.enrollment_key ?? null);

  const [metric, setMetric] = useState<MetricKey>('closings');

  const lo = useMemo(() => data?.loanOfficers.find((x) => x.employeeKey === employeeKey) ?? null, [data, employeeKey]);
  const branch = lo?.branchCodes[0] ?? null;

  /* El reloj se lee UNA vez: dos renders del mismo estado no pueden discrepar. */
  const [now] = useState(() => new Date());
  const currentMonth = currentYearMonth(now);
  const months = monthsOfYear(now);

  const enrollmentMonth = plan ? monthOf(plan.activated_at) : currentMonth;
  const afterMonths = completeMonthsAfter(months, enrollmentMonth, currentMonth);
  const after = lo ? averageOver(lo.activity, afterMonths) : null;

  const totals = useMemo(() => {
    if (!plan) return { done: 0, total: 0 };
    const all = plan.nodes.flatMap((n) => n.milestones);
    return { done: all.filter((m) => m.status === 'done').length, total: all.length };
  }, [plan]);

  const loading = loadingRoster || loadingPlan || loadingBase;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Branch Portfolio', href: '/business-plan' },
          ...(branch ? [{ label: branch, href: '/business-plan/branch/' + encodeURIComponent(branch) }] : []),
          ...(lo ? [{ label: lo.fullName, href: '/business-plan/lo/' + employeeKey }] : []),
          { label: 'Impact' },
        ]}
      />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {!loadingPlan && available && !plan && (
        <div className="empty">
          <h2>No active plan</h2>
          <p>Impact is measured against an enrolment, so there is nothing to compare yet.</p>
        </div>
      )}

      {plan && lo && (
        <>
          <div className="page-head">
            <div>
              <h1 className="bp-funnel-title">
                <FunnelGlyph icon={plan.funnel_icon} size={22} tone="strong" />
                {plan.funnel_name}
              </h1>
              <p className="page-head__subtitle">
                {lo.fullName}
                {branch && <> · Branch {branch}</>} · enrolled {plan.activated_at.slice(0, 10)}
              </p>
              <p className="bp-impact-windows">
                {baseline ? (
                  <>
                    <strong>Before:</strong> average of {baseline.baselineMonths.map(formatYearMonth).join(', ')}, frozen
                    on {baseline.capturedAt.slice(0, 10)}.{' '}
                    <strong>After:</strong>{' '}
                    {afterMonths.length === 0
                      ? 'no complete month yet'
                      : afterMonths.map(formatYearMonth).join(', ') + ' — live'}
                    .
                  </>
                ) : (
                  <>No frozen baseline for this enrolment.</>
                )}
              </p>
            </div>
            {/*
              El progreso del plan, al lado de los números. Es la mitad de la
              lectura: 80% del plan hecho con producción plana dice algo muy
              distinto de 20% con producción plana.
            */}
            <div className="bp-ring">
              <div
                className="bp-ring__dial"
                style={{ ['--pct' as string]: progressOf(totals.done, totals.total) + '%' }}
                role="img"
                aria-label={`${progressOf(totals.done, totals.total)} percent of the plan complete`}
              >
                <span className="bp-ring__pct">{progressOf(totals.done, totals.total)}%</span>
              </div>
              <div className="bp-ring__label">
                {totals.done} of {totals.total} steps · plan progress
              </div>
            </div>
          </div>

          {!baseAvailable && (
            <div className="bp-pending" role="status">
              <AlertTriangleIcon size={14} />
              <span>
                The baseline table is not in the database yet — apply{' '}
                <code>docs/sql/2026-08-enrollment-baseline.sql</code> first.
              </span>
            </div>
          )}

          {baseAvailable && !baseline && (
            <div className="bp-pending" role="status">
              <AlertTriangleIcon size={14} />
              <span>
                This enrolment has no frozen baseline, so there is nothing to compare against. It cannot be recovered
                after the fact without guessing — see the backfill section of{' '}
                <code>docs/sql/2026-08-enrollment-baseline.sql</code>.
              </span>
            </div>
          )}

          {/*
            ⚠ La marca de reconstruida. Una línea base calculada hoy mirando
            para atrás NO es la foto del día del enrolamiento: si el lote activo
            cambió desde entonces, estos números no son los que se vieron. Se
            dice, en vez de dejar que se lean como capturados.
          */}
          {baseline?.source === 'reconstructed' && (
            <div className="bp-pending" role="status">
              <AlertTriangleIcon size={14} />
              <span>
                This baseline was <strong>reconstructed</strong> from current data, not captured on the day of
                enrolment — the plan predates the baseline table. If the active batch has changed since{' '}
                {plan.activated_at.slice(0, 10)}, these are not exactly the numbers that were on screen that day.
              </span>
            </div>
          )}

          {/* ── Las cuatro tarjetas ─────────────────────────────────────────── */}
          <div className="bp-impact-cards">
            {METRICS.map((k) => {
              const base = baseline ? baseline[k] : null;
              const now = after ? after[k] : null;
              const measurable = baseline !== null && afterMonths.length > 0;
              const change = measurable ? pctChange(base as number, now as number) : null;
              const tone = change === null ? '' : change > 0 ? ' is-up' : change < 0 ? ' is-down' : ' is-flat';
              return (
                <button
                  key={k}
                  type="button"
                  className={'bp-impact-card' + (metric === k ? ' is-picked' : '')}
                  onClick={() => setMetric(k)}
                  title={'Show the monthly series for ' + METRIC_LABEL[k].toLowerCase()}
                  aria-pressed={metric === k}
                >
                  <div className="bp-impact-card__label">{METRIC_LABEL[k]}</div>
                  <div className="bp-impact-card__pair">
                    <span className="bp-impact-card__before">
                      <span className="bp-impact-card__cap">Before</span>
                      {base === null ? '—' : base.toFixed(base < 10 ? 2 : 1)}
                    </span>
                    <span className="bp-impact-card__arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="bp-impact-card__after">
                      <span className="bp-impact-card__cap">After</span>
                      {/* Sin mes completo posterior no hay "después": va un guion, no un cero. */}
                      {measurable && now !== null ? now.toFixed(now < 10 ? 2 : 1) : '—'}
                    </span>
                  </div>
                  <div className={'bp-impact-card__change' + tone}>
                    {measurable ? fmtPct(change) : 'not measurable yet'}
                  </div>
                </button>
              );
            })}
          </div>

          {/*
            El aviso central de hoy. Va DESPUÉS de las tarjetas, para que se lea
            junto a los guiones que explica y no como un error de carga.
          */}
          {baseline && afterMonths.length === 0 && (
            <div className="bp-impact-notice">
              <strong>Not enough history yet.</strong> The plan started on {plan.activated_at.slice(0, 10)}, so{' '}
              {formatYearMonth(enrollmentMonth)} is split in half and does not count as &ldquo;after&rdquo;. The first
              full month that can be measured is <strong>{formatYearMonth(firstMeasurableMonth(enrollmentMonth))}</strong>.
              Until then the baseline is shown on its own — a comparison against an unfinished month would only measure
              the calendar.
            </div>
          )}

          {/* ── La serie mensual ────────────────────────────────────────────── */}
          <h2 className="bp-section-title">{METRIC_LABEL[metric]} by month</h2>
          <div className="mcard">
            <ImpactChart
              months={months}
              series={seriesOf(lo.activity, metric)}
              enrollmentMonth={enrollmentMonth}
              currentMonth={currentMonth}
              baseline={baseline ? baseline[metric] : null}
              label={METRIC_LABEL[metric]}
            />
            <p className="bp-muted-line">
              The dashed line is the frozen baseline ({baseline ? baseline[metric].toFixed(2) : '—'} per month).{' '}
              {shortMonth(enrollmentMonth)} is the enrolment month: half of it happened before the plan existed, so it
              is drawn but never averaged.
            </p>
          </div>

          <div className="bp-catalog__actions">
            <Link href={'/business-plan/lo/' + employeeKey + '/plan'} className="bp-btn bp-btn--small">
              Back to the plan
            </Link>
          </div>
        </>
      )}
    </>
  );
}
