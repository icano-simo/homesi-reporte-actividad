'use client';

import { useState } from 'react';
import Link from 'next/link';
import Modal from '@/app/business-plan/components/Modal';
import {
  benchmarkAt,
  cadenceLabel,
  modeLabel,
  projectPlan,
  type BenchmarkPoint,
  type Cadence,
  type GrowthSegment,
  type OutlookStrategy,
  type ProjectionMode,
  type StrategyPlan,
} from '@/lib/outlook/project';
import type { OutlookData, OutlookLoanOfficer } from '@/lib/outlook/loadData';
import type { OutlookSubject } from '@/lib/outlook/save';
import {
  saveGrowthRuleRevision,
  saveMonthlyTargets,
  saveStrategyBenchmark,
  setProjectionMode,
  type EditableStrategy,
} from '@/lib/outlook/save';

/**
 * ============================================================================
 * EL EDITOR DE UNA ESTRATEGIA — etapas OL2 y OL4
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * ⚠ PRIMERO EL MODO, DESPUÉS UN SOLO BLOQUE
 * ---------------------------------------------------------------------------
 * La versión de OL2 mostraba cuatro bloques a la vez --benchmark, constructor de
 * tramos, vista previa e historial-- cada uno con su explicación. Para entender
 * qué hacía cada uno había que leerlos todos, y sólo dos servían para la
 * decisión que se venía a tomar.
 *
 * Ahora la pantalla arranca con UNA pregunta: ¿por porcentaje o mes a mes? Y
 * según la respuesta muestra un bloque, no cuatro.
 *
 *   `growth`   un benchmark y una regla; los meses se calculan
 *   `monthly`  un número por mes; el número es el número
 *
 * ---------------------------------------------------------------------------
 * ⚠ LO DEL OTRO MODO NO SE BORRA, Y LA PANTALLA LO DICE
 * ---------------------------------------------------------------------------
 * Cambiar de modo no toca lo guardado del otro: la regla sigue ahí y los meses
 * fijados también. Cuando el modo inactivo tiene algo guardado, se muestra en
 * una línea --qué es y que no se está aplicando-- porque si no, alguien que
 * vuelve a "por porcentaje" se encuentra con una regla que no puso.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LA VISTA PREVIA APARECE CUANDO HAY ALGO QUE PREVISUALIZAR
 * ---------------------------------------------------------------------------
 * En OL2 estaba siempre, y con la tabla vacía mostraba ceros contra ceros: una
 * fila de nada que ocupaba el mismo espacio que la que sí importa. Ahora sale
 * cuando el plan del formulario proyecta algo o cambia lo que ya está guardado.
 *
 * Corre con `projectPlan`, LA MISMA función que arma la tabla, sin ninguna
 * copia. Una vista previa con su propia aritmética sería peor que no tenerla:
 * mentiría con autoridad, y nadie revisa dos veces lo que ya vio confirmado.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.split('-')[1]) - 1];
const CADENCES: Cadence[] = ['monthly', 'quarterly', 'semiannual'];

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function stamp(iso: string): string {
  return String(iso).slice(0, 16).replace('T', ' ');
}

/**
 * ============================================================================
 * QUIÉN DECIDE — una persona o un branch (etapa OL11)
 * ============================================================================
 *
 * El editor dejó de recibir un `OutlookLoanOfficer` y recibe SÓLO lo que
 * necesita: el sujeto al que pertenece la decisión, cómo se llama en el título,
 * y los siete campos de configuración.
 *
 * ⚠ Es una interfaz estrecha y no un `OutlookLoanOfficer` sintético para el
 * branch. Un objeto de persona fabricado --con `employeeKey` inventado, `ytd` en
 * cero, `strategies` vacío-- habría compilado y dejado la puerta abierta a que
 * el editor leyera cualquiera de esos campos falsos. Así, lo que no está en esta
 * interfaz no se puede usar.
 *
 * Los siete campos son los mismos que ya tenía `OutlookLoanOfficer`, así que una
 * persona se pasa tal cual; un branch los trae en su `BranchStrategy`.
 */
export interface OutlookEditable {
  /** A quién pertenece la decisión. Ver `OutlookSubject` en `save.ts`. */
  subject: OutlookSubject;
  /** Cómo se llama en el título: "Galo Rizzo" o "Branch 747". */
  label: string;
  benchmarkSchedules: OutlookLoanOfficer['benchmarkSchedules'];
  rulesByStrategy: OutlookLoanOfficer['rulesByStrategy'];
  targetsByStrategy: OutlookLoanOfficer['targetsByStrategy'];
  modeByStrategy: OutlookLoanOfficer['modeByStrategy'];
  modeSetBy: OutlookLoanOfficer['modeSetBy'];
  ruleRevision: OutlookLoanOfficer['ruleRevision'];
  targetRevision: OutlookLoanOfficer['targetRevision'];
}

export default function StrategyEditor({
  lo,
  strategy,
  data,
  onClose,
  onSaved,
}: {
  lo: OutlookEditable;
  strategy: OutlookStrategy;
  data: OutlookData;
  onClose: () => void;
  /*
   * ⚠ Devuelve una promesa y se la ESPERA antes de anunciar el guardado. La
   * recarga tarda unos segundos, y sin esperarla la pantalla decía "guardada
   * como revisión 2" arriba de un título que seguía diciendo "revisión 1
   * vigente" -- dos afirmaciones contradictorias sobre lo mismo, y la falsa era
   * la de más autoridad. Medido en la primera pasada de OL2.
   */
  onSaved: () => Promise<void> | void;
}) {
  const months = data.remainingMonths;
  const savedSchedule = lo.benchmarkSchedules[strategy] ?? [];
  const savedSegments = lo.rulesByStrategy[strategy] ?? [];
  const savedTargets = lo.targetsByStrategy[strategy] ?? {};
  const savedMode: ProjectionMode = lo.modeByStrategy[strategy] ?? 'growth';
  const modeSetBy = lo.modeSetBy[strategy] ?? null;
  const revision = lo.ruleRevision[strategy] ?? 0;
  const targetRevision = lo.targetRevision[strategy] ?? 0;
  const effectiveMonth = data.effectiveFrom.slice(0, 7);
  const monthlyAvailable = data.diagnostics.monthlyModeAvailable;

  /*
   * Own Production entra al editor para su REGLA y para sus meses fijados, pero
   * no para su benchmark: ese vive en `org.employee_benchmark` y el CHECK de
   * `outlook.strategy_benchmark` lo rechaza. Ver la decisión 2 del esquema OL1.
   */
  const benchmarkEditable = strategy !== 'Own Production';

  const [mode, setMode] = useState<ProjectionMode>(savedMode);
  const [benchValue, setBenchValue] = useState('');
  const [segments, setSegments] = useState<GrowthSegment[]>(
    savedSegments.length > 0
      ? savedSegments
      : [{ fromMonth: months[0] ?? data.currentMonth, cadence: 'quarterly', growthPct: 0 }]
  );
  const [targets, setTargets] = useState<Record<string, string>>(() =>
    Object.fromEntries(months.map((m) => [m, savedTargets[m] === undefined ? '' : String(savedTargets[m])]))
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  /*
   * El plan que hay EN EL FORMULARIO. Es exactamente lo que va a quedar
   * guardado: el editor no puede modificar los puntos anteriores del benchmark,
   * sólo agregar el del mes siguiente.
   */
  const draftBench = benchValue.trim() === '' ? null : Number(benchValue);
  const draftSchedule: BenchmarkPoint[] =
    draftBench !== null && Number.isFinite(draftBench) && benchmarkEditable
      ? [...savedSchedule.filter((p) => p.fromMonth !== effectiveMonth), { fromMonth: effectiveMonth, value: draftBench }]
      : savedSchedule;
  const draftTargets: Record<string, number> = {};
  for (const m of months) {
    const raw = targets[m]?.trim();
    if (raw !== '' && raw !== undefined && Number.isFinite(Number(raw))) draftTargets[m] = Number(raw);
  }

  const draftPlan: StrategyPlan = { mode, benchmarks: draftSchedule, segments, targets: draftTargets };
  const savedPlan: StrategyPlan = {
    mode: savedMode,
    benchmarks: savedSchedule,
    segments: savedSegments,
    targets: savedTargets,
  };
  const preview = projectPlan(months, draftPlan);
  const previewSaved = projectPlan(months, savedPlan);
  const changes = preview.some((p, i) => p.value !== previewSaved[i].value);
  /* Sale cuando hay algo que mirar: en OL2 mostraba ceros contra ceros. */
  const showPreview = months.length > 0 && (changes || preview.some((p) => p.value !== 0));

  /* Qué hay guardado en el modo que NO está elegido ahora mismo. */
  const otherSaved =
    mode === 'growth'
      ? targetRevision > 0
        ? `There are saved monthly numbers (revision ${targetRevision}: ${months
            .map((m) => `${monthLabel(m)} ${savedTargets[m] ?? 0}`)
            .join(' · ')}).`
        : null
      : savedSegments.length > 0
        ? `There is a saved growth rule (revision ${revision}: ${savedSegments
            .map((g) => `${g.growthPct}% ${cadenceLabel(g.cadence)} from ${monthLabel(g.fromMonth)}`)
            .join(' · ')}).`
        : null;

  /*
   * ⚠ El historial es DEL SUJETO, no de la persona. Con `r.employee_key === ...`
   * un branch habría visto vacío --sus filas tienen `employee_key` en NULL-- y,
   * peor, un `employee_key` nulo comparado contra otro nulo habría mezclado los
   * historiales de los dieciséis branches si alguien "arreglaba" el filtro.
   */
  const isMine = (r: { employee_key: number | null; branch_code: string | null }) =>
    lo.subject.kind === 'employee' ? r.employee_key === lo.subject.employeeKey : r.branch_code === lo.subject.branchCode;

  const benchHistory = data.history.strategyBenchmarks
    .filter((r) => isMine(r) && r.strategy === strategy)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  /* Las revisiones de la regla y de los meses, agrupadas: cada una es una decisión. */
  const ruleRevisions = new Map<number, typeof data.history.growthRules>();
  for (const r of data.history.growthRules) {
    if (!isMine(r) || r.strategy !== strategy) continue;
    ruleRevisions.set(r.revision, [...(ruleRevisions.get(r.revision) ?? []), r]);
  }
  const targetRevisions = new Map<number, typeof data.history.monthlyTargets>();
  for (const r of data.history.monthlyTargets) {
    if (!isMine(r) || r.strategy !== strategy) continue;
    targetRevisions.set(r.revision, [...(targetRevisions.get(r.revision) ?? []), r]);
  }
  const modeHistory = data.history.projectionModes
    .filter((r) => isMine(r) && r.strategy === strategy)
    .sort((a, b) => b.projection_mode_key - a.projection_mode_key);
  const historyCount =
    benchHistory.length + ruleRevisions.size + targetRevisions.size + modeHistory.length;

  /*
   * UN SOLO GUARDAR, y escribe únicamente lo que cambió.
   *
   * En OL2 había dos botones --uno para el benchmark y otro para la regla-- y
   * eran dos mitades de la misma decisión: cuánto es la base y cuánto crece. Se
   * podía guardar una y olvidarse de la otra, y la proyección quedaba a medio
   * cambiar sin que nada avisara.
   */
  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    const done: string[] = [];
    try {
      if (mode === 'growth') {
        if (benchmarkEditable && benchValue.trim() !== '') {
          const parsed = Number(benchValue);
          if (!Number.isFinite(parsed) || parsed < 0) throw new Error('The benchmark must be a number of 0 or more.');
          await saveStrategyBenchmark({
            subject: lo.subject,
            strategy: strategy as EditableStrategy,
            monthlyBenchmark: parsed,
            /* ⚠ Siempre el primer día del mes SIGUIENTE. Ver `lib/outlook/save.ts`. */
            effectiveFrom: data.effectiveFrom,
            note: note.trim() === '' ? null : note.trim(),
          });
          done.push(`benchmark ${fmt(parsed)} from ${data.effectiveFrom}`);
        }

        /*
         * Dos tramos no pueden arrancar el mismo mes: haría ambiguo cuál rige, y
         * `projectMonth` resolvería la ambigüedad en silencio quedándose con uno.
         */
        const seen = new Set<string>();
        for (const seg of segments) {
          if (seen.has(seg.fromMonth)) throw new Error('Two segments start in the same month.');
          seen.add(seg.fromMonth);
          if (!Number.isFinite(seg.growthPct) || seg.growthPct < -100)
            throw new Error("A segment's growth cannot go below -100%.");
        }
        const ruleChanged =
          segments.length !== savedSegments.length ||
          segments.some(
            (g, i) =>
              g.fromMonth !== savedSegments[i]?.fromMonth ||
              g.cadence !== savedSegments[i]?.cadence ||
              g.growthPct !== savedSegments[i]?.growthPct
          );
        if (ruleChanged) {
          const written = await saveGrowthRuleRevision({
            subject: lo.subject,
            strategy,
            segments: [...segments].sort((a, b) => a.fromMonth.localeCompare(b.fromMonth)),
            note: note.trim() === '' ? null : note.trim(),
          });
          done.push(`growth rule revision ${written}`);
        }
      } else {
        const targetsChanged =
          months.some((m) => (draftTargets[m] ?? 0) !== (savedTargets[m] ?? 0)) || targetRevision === 0;
        if (targetsChanged) {
          const written = await saveMonthlyTargets({
            subject: lo.subject,
            strategy,
            /* Los meses vacíos se guardan en 0: la revisión se lee entera. */
            targets: Object.fromEntries(months.map((m) => [m, draftTargets[m] ?? 0])),
            note: note.trim() === '' ? null : note.trim(),
          });
          done.push(`monthly numbers, revision ${written}`);
        }
      }

      /*
       * ⚠ El modo va ÚLTIMO, y sólo si cambió. Ver el bloque del orden en
       * `save.ts`: si fallara, lo guardado queda sin aplicar y la proyección no
       * se mueve, que es la mitad segura de fallar.
       */
      if (mode !== savedMode) {
        await setProjectionMode({
          subject: lo.subject,
          strategy,
          mode,
          note: note.trim() === '' ? null : note.trim(),
        });
        done.push(`mode ${modeLabel(mode)}`);
      }

      if (done.length === 0) {
        setSaved('Nothing had changed.');
      } else {
        await onSaved();
        setSaved('Saved: ' + done.join(' · ') + '.');
        setBenchValue('');
        setNote('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function patch(i: number, change: Partial<GrowthSegment>) {
    setSegments((prev) => prev.map((s, j) => (j === i ? { ...s, ...change } : s)));
  }

  function addSegment() {
    const used = new Set(segments.map((s) => s.fromMonth));
    const free = months.find((m) => !used.has(m));
    setSegments((prev) => [
      ...prev,
      { fromMonth: free ?? months[months.length - 1] ?? data.currentMonth, cadence: 'quarterly', growthPct: 0 },
    ]);
  }

  return (
    <Modal title={`${lo.label} — ${strategy}`} onClose={onClose}>
      <div className="ol-editor">
        {/* ── La pregunta ─────────────────────────────────────────────── */}
        <div className="ol-modes" role="radiogroup" aria-label="How the budget is set">
          {(['growth', 'monthly'] as ProjectionMode[]).map((m) => (
            /*
              ⚠ El modo mes a mes no se ofrece si sus tablas no están. Ofrecerlo
              igual dejaría a alguien escribiendo cuatro números para descubrir
              al apretar Guardar que no hay dónde ponerlos -- y el mensaje de
              error, por claro que sea, llega después del trabajo perdido.
            */
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={m === 'monthly' && !monthlyAvailable}
              className={'ol-mode' + (mode === m ? ' is-on' : '')}
              onClick={() => setMode(m)}
              title={
                m === 'monthly' && !monthlyAvailable
                  ? 'docs/sql/2026-08-outlook-monthly-mode.sql has not been applied yet'
                  : undefined
              }
            >
              <span className="ol-mode__name">{m === 'growth' ? 'By growth rate' : 'Month by month'}</span>
              <span className="ol-mode__hint">
                {m === 'monthly' && !monthlyAvailable
                  ? "this stage's SQL has not been applied"
                  : m === 'growth'
                    ? 'a benchmark and a rule; the months are calculated'
                    : "each month's number, written"}
              </span>
            </button>
          ))}
        </div>

        {mode !== savedMode && (
          <p className="ol-editor__hint">
            <b>{modeLabel(savedMode)}</b> rules now. Saving switches it to <b>{modeLabel(mode)}</b>.
          </p>
        )}
        {mode === savedMode && modeSetBy && (
          <p className="ol-editor__hint">
            Set <b>{modeLabel(savedMode)}</b> by {modeSetBy.setBy} on {stamp(modeSetBy.at)}.
          </p>
        )}

        {/* ── Modo A: benchmark y regla ───────────────────────────────── */}
        {mode === 'growth' && (
          <section className="ol-editor__block">
            {benchmarkEditable ? (
              <div className="ol-editor__row">
                <div className="bp-form__field">
                  <label className="bp-form__label" htmlFor="ol-bench">
                    Monthly benchmark
                  </label>
                  <input
                    id="ol-bench"
                    type="number"
                    step="0.5"
                    min="0"
                    className="field ol-editor__num"
                    value={benchValue}
                    onChange={(e) => setBenchValue(e.target.value)}
                    placeholder={fmt(benchmarkAt(savedSchedule, months[0] ?? data.currentMonth))}
                  />
                </div>
              </div>
            ) : (
              <p className="ol-editor__hint">
                {/* Own Production siempre es de una persona: el link solo existe ahi. */}
                Own Production&apos;s benchmark is edited in{' '}
                {lo.subject.kind === 'employee' ? (
                  <Link href={`/business-plan/lo/${lo.subject.employeeKey}`}>the Business Plan profile</Link>
                ) : (
                  'the Business Plan profile'
                )}
                . What is decided here is how much it grows.
              </p>
            )}

            <table className="piv ol-editor__tbl">
              <thead>
                <tr className="mo-row">
                  <th className="lbl">From</th>
                  <th className="lbl">Every</th>
                  <th className="bp-center">Growth</th>
                  <th className="lbl"></th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg, i) => (
                  <tr key={i} className="metric">
                    <td className="lbl">
                      <select
                        className="field ol-editor__sel"
                        value={seg.fromMonth}
                        onChange={(e) => patch(i, { fromMonth: e.target.value })}
                        aria-label="Month the segment starts in"
                      >
                        {/*
                          Sólo los meses que este módulo proyecta. Un tramo que
                          arranca antes cambiaría la cuenta de períodos desde un
                          mes que la tabla no muestra: el número se movería sin
                          nada visible que lo explique.
                        */}
                        {months.map((m) => (
                          <option key={m} value={m}>
                            {monthLabel(m)} {m.split('-')[0]}
                          </option>
                        ))}
                        {!months.includes(seg.fromMonth) && (
                          <option value={seg.fromMonth}>{seg.fromMonth} (saved)</option>
                        )}
                      </select>
                    </td>
                    <td className="lbl">
                      <select
                        className="field ol-editor__sel"
                        value={seg.cadence}
                        onChange={(e) => patch(i, { cadence: e.target.value as Cadence })}
                        aria-label="Segment cadence"
                      >
                        {CADENCES.map((c) => (
                          <option key={c} value={c}>
                            {cadenceLabel(c)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="bp-center">
                      <input
                        type="number"
                        step="1"
                        className="field ol-editor__num"
                        value={String(seg.growthPct)}
                        onChange={(e) => patch(i, { growthPct: Number(e.target.value) })}
                        aria-label="Segment growth percentage"
                      />
                      <span className="ol-editor__pct">%</span>
                    </td>
                    <td className="lbl">
                      {segments.length > 1 && (
                        <button
                          type="button"
                          className="bp-linkish"
                          onClick={() => setSegments((prev) => prev.filter((_, j) => j !== i))}
                        >
                          remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button
              type="button"
              className="bp-linkish"
              onClick={addSegment}
              disabled={segments.length >= months.length}
            >
              + another segment
            </button>
          </section>
        )}

        {/* ── Modo B: el número de cada mes ───────────────────────────── */}
        {mode === 'monthly' && (
          <section className="ol-editor__block">
            {months.length === 0 ? (
              <p className="ol-editor__hint">There is no month left to set this year.</p>
            ) : (
              <div className="ol-months">
                {months.map((m) => (
                  <div key={m} className="bp-form__field">
                    <label className="bp-form__label" htmlFor={'ol-t-' + m}>
                      {monthLabel(m)}
                    </label>
                    <input
                      id={'ol-t-' + m}
                      type="number"
                      step="1"
                      min="0"
                      className="field ol-editor__num"
                      value={targets[m] ?? ''}
                      onChange={(e) => setTargets((prev) => ({ ...prev, [m]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Lo que queda guardado del otro modo ─────────────────────── */}
        {otherSaved && (
          <p className="ol-editor__hint">
            {otherSaved} It is not applied while <b>{modeLabel(mode)}</b> rules, and it is not deleted: switching
            back brings it into effect exactly as it is.
          </p>
        )}

        {/* ── Guardar. Una sola línea de texto, y es la que hace falta ── */}
        <div className="ol-editor__row">
          <div className="bp-form__field ol-editor__grow">
            <label className="bp-form__label" htmlFor="ol-note">
              Why (optional)
            </label>
            <input id="ol-note" type="text" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="button" className="bp-btn bp-btn--small" onClick={save} disabled={busy}>
            {busy ? '…' : 'Save'}
          </button>
        </div>
        <p className="ol-editor__hint">
          Takes effect on <b>{data.effectiveFrom}</b>, the first day of next month.
        </p>

        {error && <div className="bp-notice bp-notice--warn ol-editor__msg">{error}</div>}
        {saved && !error && <div className="bp-notice ol-editor__msg">{saved}</div>}

        {/* ── Qué pasaría, sólo si hay algo que mirar ─────────────────── */}
        {showPreview && (
          <section className="ol-editor__block">
            <h3 className="ol-editor__h">
              What would happen <span className="bp-muted ol-editor__rev">not saved yet</span>
            </h3>
            <table className="piv ol-editor__tbl ol-preview">
              <thead>
                <tr className="mo-row">
                  <th className="lbl"></th>
                  {months.map((m) => (
                    <th key={m} className="bp-center">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {changes && (
                  <tr className="metric">
                    <td className="lbl bp-muted">Today</td>
                    {previewSaved.map((p) => (
                      <td key={p.month} className={'bp-center' + (p.value ? '' : ' zero')}>
                        {p.value}
                      </td>
                    ))}
                  </tr>
                )}
                <tr className="metric" style={{ fontWeight: 700 }}>
                  <td className="lbl">{changes ? 'With this change' : 'Projection'}</td>
                  {preview.map((p) => (
                    <td key={p.month} className={'bp-center' + (p.value ? '' : ' zero')} title={p.explain}>
                      {p.value}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>
        )}

        {/* ── La historia, detrás de un enlace ────────────────────────── */}
        <div>
          <button type="button" className="bp-linkish" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'hide history' : `view history (${historyCount})`}
          </button>
        </div>

        {showHistory && (
          <section className="ol-editor__block">
            {modeHistory.length > 0 && (
              <>
                <h3 className="ol-editor__h">Mode</h3>
                <table className="piv ol-editor__tbl">
                  <tbody>
                    {modeHistory.map((r) => (
                      <tr key={r.projection_mode_key} className="metric">
                        <td className="lbl">{modeLabel(r.mode)}</td>
                        <td className="bp-left">{r.set_by}</td>
                        <td className="bp-left">{stamp(r.created_at)}</td>
                        <td className="bp-left bp-history__note">{r.note ?? 'no note'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {benchHistory.length > 0 && (
              <>
                <h3 className="ol-editor__h">Benchmarks</h3>
                <table className="piv ol-editor__tbl">
                  <tbody>
                    {benchHistory.map((r) => (
                      <tr key={r.strategy_benchmark_key} className="metric">
                        <td className="lbl">
                          {fmt(Number(r.monthly_benchmark))} <span className="bp-muted">from {r.effective_from}</span>
                        </td>
                        <td className="bp-left">{r.set_by}</td>
                        <td className="bp-left">{stamp(r.created_at)}</td>
                        <td className="bp-left bp-history__note">{r.note ?? 'no note'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {ruleRevisions.size > 0 && (
              <>
                <h3 className="ol-editor__h">Growth rules</h3>
                {[...ruleRevisions.entries()]
                  .sort((a, b) => b[0] - a[0])
                  .map(([rev, rows]) => (
                    <div
                      key={rev}
                      className={'ol-editor__rev-card' + (rev === revision && savedMode === 'growth' ? ' is-current' : '')}
                    >
                      <div className="ol-editor__rev-head">
                        <b>Revision {rev}</b>
                        {rev === revision && savedMode === 'growth' && <span className="ol-editor__tag">in effect</span>}
                        <span className="bp-muted">
                          {rows[0].set_by} · {stamp(rows[0].created_at)}
                        </span>
                      </div>
                      <div className="ol-editor__rev-body">
                        {[...rows]
                          .sort((a, b) => a.segment_order - b.segment_order)
                          .map((r) => (
                            <span key={r.growth_rule_key} className="ol-editor__seg">
                              {Number(r.growth_pct)}% {cadenceLabel(r.cadence)} from {r.from_month.slice(0, 7)}
                            </span>
                          ))}
                      </div>
                      {rows[0].note && <div className="ol-editor__rev-note">{rows[0].note}</div>}
                    </div>
                  ))}
              </>
            )}

            {targetRevisions.size > 0 && (
              <>
                <h3 className="ol-editor__h">Monthly numbers</h3>
                {[...targetRevisions.entries()]
                  .sort((a, b) => b[0] - a[0])
                  .map(([rev, rows]) => (
                    <div
                      key={rev}
                      className={
                        'ol-editor__rev-card' + (rev === targetRevision && savedMode === 'monthly' ? ' is-current' : '')
                      }
                    >
                      <div className="ol-editor__rev-head">
                        <b>Revision {rev}</b>
                        {rev === targetRevision && savedMode === 'monthly' && (
                          <span className="ol-editor__tag">in effect</span>
                        )}
                        <span className="bp-muted">
                          {rows[0].set_by} · {stamp(rows[0].created_at)}
                        </span>
                      </div>
                      <div className="ol-editor__rev-body">
                        {[...rows]
                          .sort((a, b) => a.target_month.localeCompare(b.target_month))
                          .map((r) => (
                            <span key={r.monthly_target_key} className="ol-editor__seg">
                              {monthLabel(r.target_month.slice(0, 7))} {Number(r.target)}
                            </span>
                          ))}
                      </div>
                      {rows[0].note && <div className="ol-editor__rev-note">{rows[0].note}</div>}
                    </div>
                  ))}
              </>
            )}

            {historyCount === 0 && <p className="ol-editor__hint">Nothing has been saved for this strategy yet.</p>}
          </section>
        )}
      </div>
    </Modal>
  );
}
