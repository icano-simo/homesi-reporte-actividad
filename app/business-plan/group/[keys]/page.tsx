'use client';

import { useMemo, use } from 'react';
import Link from 'next/link';
import { useBusinessPlanData } from '@/lib/business-plan/useBusinessPlanData';
import { aggregateGroup, parseKeys } from '@/lib/business-plan/group';
import { GAP_STATE_LABEL, requiredUnits } from '@/lib/business-plan/qualifiers';
import { formatYearMonth, monthsOfYear, currentYearMonth, shortMonth } from '@/lib/business-plan/months';
import { AlertTriangleIcon } from '@/components/ui/icons';
import Breadcrumbs from '../../components/Breadcrumbs';
import { FunnelGlyph } from '../../components/funnelIcons';
import {
  Avatar,
  ErrorState,
  LoadingState,
  VerdictBadge,
  VerdictPanel,
  exactTitle,
  fmtActivityAvg,
  fmtAvg,
  fmtGap,
  fmtLoans,
} from '../../components/shared';

/**
 * ============================================================================
 * REVISIÓN CONJUNTA DE VARIOS LOAN OFFICERS
 * ============================================================================
 *
 * Etapa BP23 — ARCHIVO NUEVO.
 *
 * ---------------------------------------------------------------------------
 * PÁGINA, NO MODAL, Y LAS CLAVES EN LA URL
 * ---------------------------------------------------------------------------
 * `/business-plan/group/1-25-33` se puede compartir, marcar y abrir en otra
 * pestaña. Un modal habría obligado a rehacer la selección para volver a la
 * misma revisión, y una revisión que no se puede mandar por link no sirve para
 * discutirla con nadie. Es la misma regla que rige los tres niveles del módulo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL VEREDICTO DEL GRUPO NO DISPARA NADA
 * ---------------------------------------------------------------------------
 * Se calcula con las mismas reglas que el individual, sobre los números
 * agregados, y es INFORMATIVO. Los Business Plan son de personas: un grupo no
 * se enrola, no tiene funnel y no tiene pasos. Está escrito en la pantalla
 * porque un badge "On Risk" idéntico al del perfil invita a actuar sobre él.
 *
 * La agregación vive en `lib/business-plan/group.ts` -- ahí está el porqué de
 * sumar en vez de promediar promedios, y la deduplicación.
 */

export default function GroupReviewPage({ params }: { params: Promise<{ keys: string }> }) {
  const { keys: rawKeys } = use(params);
  const keys = useMemo(() => parseKeys(rawKeys), [rawKeys]);

  const { data, isLoading, error } = useBusinessPlanData();

  const members = useMemo(
    () => (data ? keys.map((k) => data.loanOfficers.find((lo) => lo.employeeKey === k)).filter(Boolean) : []),
    [data, keys]
  ) as NonNullable<typeof data>['loanOfficers'];

  const missing = keys.length - members.length;

  const group = useMemo(() => {
    if (!data || members.length === 0) return null;
    const d = data.diagnostics;
    return aggregateGroup(
      members, d.windowMonths, d.closedMonths, d.windowMonths[d.windowMonths.length - 1], d.rates,
      /* El dia del mes, para el ritmo prorrateado del Future performance. */
      new Date().getDate()
    );
  }, [data, members]);

  const branches = useMemo(() => [...new Set(members.flatMap((m) => m.branchCodes))].sort(), [members]);
  const year = useMemo(() => monthsOfYear(new Date()), []);
  const thisMonth = currentYearMonth(new Date());

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
        {group && <VerdictPanel verdict={group.verdict} />}
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
            veredicto, y no al pie: quien mira un badge "On Risk" idéntico al
            del perfil individual actúa antes de llegar al pie de la página.
          */}
          <div className="bp-group-note">
            <strong>This verdict is informative.</strong> It uses the same rules as an individual one, applied to the
            added-up numbers — but it triggers no Business Plan. Plans belong to people: a group has no funnel, no stages
            and nobody accountable for them. To act, open a member below.
          </div>

          {/* ── Qualifier 1, sumado ─────────────────────────────────────────── */}
          <h2 className="bp-section-title">Current performance — volume, added up</h2>
          <div className="bp-forensic">
            <GroupItem label={'Closings in ' + shortMonth(thisMonth) + ' so far'} value={fmtLoans(group.projection.closedToDate)} />
            <GroupItem label="Total Pipeline" value={fmtLoans(group.projection.totalPipeline)} />
            <GroupItem label="Healthy Pipeline" value={fmtLoans(group.projection.healthyPipeline)} />
            <GroupItem
              label={shortMonth(thisMonth) + ' projection'}
              value={fmtLoans(group.projection.projectedTotal)}
              title={exactTitle(group.projection.projectedTotal)}
              strong
            />
          </div>

          {/* ── El GAP del grupo ────────────────────────────────────────────── */}
          <div className="mcard bp-group-gap">
            <div className="bp-group-gap__row">
              <div>
                <div className="m-name">3-month average</div>
                <div className="kpi-hero__value" title={exactTitle(group.q1.avgWithCurrent)}>
                  {fmtAvg(group.q1.avgWithCurrent)}
                </div>
                {/*
                  La cuenta escrita: es exactamente el punto que separa sumar de
                  promediar promedios, y verla evita la discusión.
                */}
                <div className="bp-muted-line">
                  ({group.q1.windowMonths.slice(0, -1).map((m) => group.closingsByMonth[m] ?? 0).join(' + ')} +{' '}
                  {group.projection.projectedTotal.toFixed(2)} projected) ÷ {group.q1.windowMonths.length} months
                </div>
              </div>
              <div>
                <div className="m-name">Group benchmark</div>
                <div className="kpi-hero__value">{group.benchmark === null ? '—' : group.benchmark.toFixed(1)}</div>
                <div className="bp-muted-line">
                  {group.benchmark === null
                    ? 'sum not available'
                    : members.map((m) => (m.monthlyBenchmark ?? 0).toFixed(1)).join(' + ')}
                </div>
              </div>
              <div>
                <div className="m-name">GAP</div>
                <div
                  className={
                    'kpi-hero__value' +
                    (group.q1.gap === null ? '' : group.q1.gap < 0 ? ' kpi-hero__value--risk' : ' kpi-hero__value--emerald')
                  }
                >
                  {fmtGap(group.q1.gap)}
                </div>
                <div className="bp-muted-line">{group.q1.state ? GAP_STATE_LABEL[group.q1.state] : 'not evaluable'}</div>
              </div>
            </div>

            {/*
              ⚠ Sin benchmark de alguien, el GAP NO se calcula y NO se rellena
              con cero. Un cero diría que a esa persona no se le pide nada, y el
              GAP del grupo saldría mejor de lo que es.
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
          </div>

          {/* ── Qualifier 2, sumado ─────────────────────────────────────────── */}
          <h2 className="bp-section-title">Future performance — activity, added up</h2>
          <div className="bp-q2-grid">
            {[
              { k: 'applications' as const, label: 'Credit applications', rate: data.diagnostics.rates.q2.applications },
              { k: 'creditReports' as const, label: 'Pre-approvals', rate: data.diagnostics.rates.q2.creditReports },
              { k: 'fileCreations' as const, label: 'File creations', rate: data.diagnostics.rates.q2.fileCreations },
            ].map((row) => {
              const required = group.benchmark === null ? null : requiredUnits(group.benchmark, row.rate);
              const actual = group.currentActivity[row.k];
              return (
                <div key={row.k} className="mcard bp-q2-card">
                  <div className="bp-q2-card__name">{row.label}</div>
                  <div className="bp-q2-card__value">
                    {actual}
                    <span className="bp-q2-card__req"> / {required ?? '—'}</span>
                  </div>
                  <div className="bp-q2-card__avg" title="Group total ÷ 3 closed months">
                    usually {fmtActivityAvg(group.trailingActivityAvg[row.k])}/month
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Producción agregada por mes ─────────────────────────────────── */}
          <h2 className="bp-section-title">Group closings by month</h2>
          <div className="mcard">
            <GroupBars months={year} byMonth={group.closingsByMonth} benchmark={group.benchmark} />
            <p className="bp-muted-line">
              Every bar is the sum of the members&apos; closings for that month. The window that feeds the GAP is{' '}
              {group.q1.windowMonths.map(formatYearMonth).join(', ')}, with the last one projected.
            </p>
          </div>

          {/*
            La deduplicación, dicha. Callarla dejaría la duda de si se comprobó.
          */}
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
        </>
      )}
    </>
  );
}

function GroupItem({
  label,
  value,
  title,
  strong,
}: {
  label: string;
  value: string;
  title?: string;
  strong?: boolean;
}) {
  return (
    <div className={'bp-forensic__item' + (strong ? ' is-strong' : '')} title={title}>
      <div className="bp-forensic__value">{value}</div>
      <div className="bp-forensic__label">{label}</div>
    </div>
  );
}

/**
 * Barras del año, sin proyección segmentada.
 *
 * No se reutiliza `MonthlyBarChart`: aquél apila los tres componentes de la
 * proyección del mes en curso, y para un grupo esos segmentos no son la lectura
 * que se busca -- lo que se mira es la producción conjunta a lo largo del año.
 */
function GroupBars({
  months,
  byMonth,
  benchmark,
}: {
  months: string[];
  byMonth: Record<string, number>;
  benchmark: number | null;
}) {
  const H = 130;
  const GAP = 5;
  const values = months.map((m) => byMonth[m] ?? 0);
  const max = Math.max(1, ...values, benchmark ?? 0);
  const w = `calc((100% - ${(months.length - 1) * GAP}px) / ${months.length})`;
  return (
    <div className="bp-chart">
      <div className="bp-chart__plot" style={{ height: H + 'px' }}>
        {benchmark !== null && (
          <div
            className="bp-chart__benchmark"
            style={{ bottom: (benchmark / max) * H + 'px' }}
            title={`Group benchmark ${benchmark.toFixed(1)}`}
          >
            <span className="bp-chart__benchmark-label">{benchmark.toFixed(1)}</span>
          </div>
        )}
        <div className="bp-chart__bars" style={{ gap: GAP + 'px' }}>
          {months.map((m) => (
            <div key={m} className="bp-impact-chart__col" style={{ width: w }}>
              <div className="bp-chart__value">{(byMonth[m] ?? 0) > 0 ? byMonth[m] : ''}</div>
              <div
                className="bp-chart__bar"
                style={{ height: ((byMonth[m] ?? 0) / max) * H + 'px' }}
                title={`${shortMonth(m)}: ${byMonth[m] ?? 0} closings`}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="bp-chart__axis" style={{ gap: GAP + 'px' }}>
        {months.map((m) => (
          <div key={m} className="bp-chart__tick" style={{ width: w }}>
            {shortMonth(m)}
          </div>
        ))}
      </div>
    </div>
  );
}
