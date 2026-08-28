'use client';

import { useState } from 'react';
import Link from 'next/link';
import Modal from '@/app/business-plan/components/Modal';
import {
  benchmarkAt,
  cadenceLabel,
  projectMonth,
  type BenchmarkPoint,
  type Cadence,
  type GrowthSegment,
  type OutlookStrategy,
} from '@/lib/outlook/project';
import type { OutlookData, OutlookLoanOfficer } from '@/lib/outlook/loadData';
import { saveGrowthRuleRevision, saveStrategyBenchmark, type EditableStrategy } from '@/lib/outlook/save';

/**
 * ============================================================================
 * EL EDITOR DE UNA ESTRATEGIA — benchmark, regla y qué pasaría (etapa OL2)
 * ============================================================================
 *
 * Todo lo que se decide sobre un par (Loan Officer, estrategia) en un solo
 * lugar: el benchmark, los tramos de crecimiento, la vista previa del efecto y
 * la historia de las dos cosas.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ ES UN MODAL Y NO UNA PÁGINA
 * ---------------------------------------------------------------------------
 * La regla del portal es cero modales para NAVEGAR (ver
 * `app/business-plan/components/Modal.tsx`), y esto no navega: se abre, se
 * decide un número, se cierra y se vuelve a la tabla donde el efecto ya se ve.
 * El criterio de ese archivo aplica tal cual — no es un destino, y una URL
 * propia por cada par (persona × cinco estrategias) serían 300 páginas que nadie
 * va a compartir por link.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LA VISTA PREVIA NO ES ADORNO
 * ---------------------------------------------------------------------------
 * Se guarda un benchmark y una regla; lo que le importa a quien decide es la
 * FILA de meses que sale de los dos. Con "25% trimestral desde septiembre" el
 * primer aumento cae en diciembre, y sin ver la fila eso se descubre después de
 * guardar, mirando la tabla y preguntando por qué tres meses salen iguales.
 *
 * Corre con las MISMAS funciones que la tabla --`benchmarkAt` y `projectMonth`,
 * sin ninguna copia-- así que lo que muestra es lo que va a pasar. Una vista
 * previa con su propia aritmética sería peor que no tenerla: mentiría con
 * autoridad.
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

export default function StrategyEditor({
  lo,
  strategy,
  data,
  onClose,
  onSaved,
}: {
  lo: OutlookLoanOfficer;
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
  const revision = lo.ruleRevision[strategy] ?? 0;
  const effectiveMonth = data.effectiveFrom.slice(0, 7);

  /*
   * Own Production entra al editor para su REGLA pero no para su benchmark: ese
   * vive en `org.employee_benchmark` y el CHECK de `outlook.strategy_benchmark`
   * lo rechaza. Ver la decisión 2 del esquema.
   */
  const benchmarkEditable = strategy !== 'Own Production';

  const [benchValue, setBenchValue] = useState('');
  const [benchNote, setBenchNote] = useState('');
  const [segments, setSegments] = useState<GrowthSegment[]>(
    savedSegments.length > 0
      ? savedSegments
      : [{ fromMonth: months[0] ?? data.currentMonth, cadence: 'quarterly', growthPct: 0 }]
  );
  const [ruleNote, setRuleNote] = useState('');
  const [busy, setBusy] = useState<'bench' | 'rule' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  /*
   * La serie con lo que hay en el formulario: la guardada más el punto que se
   * escribiría. Es exactamente lo que va a quedar en la base, porque el editor
   * no puede modificar los puntos anteriores — sólo agregar el del mes siguiente.
   */
  const draftBenchValue = benchValue.trim() === '' ? null : Number(benchValue);
  const draftSchedule: BenchmarkPoint[] =
    draftBenchValue !== null && Number.isFinite(draftBenchValue) && benchmarkEditable
      ? [...savedSchedule.filter((p) => p.fromMonth !== effectiveMonth), { fromMonth: effectiveMonth, value: draftBenchValue }]
      : savedSchedule;

  const preview = months.map((m) => projectMonth(m, benchmarkAt(draftSchedule, m), segments));
  const previewSaved = months.map((m) => projectMonth(m, benchmarkAt(savedSchedule, m), savedSegments));
  const changesPreview = preview.some((p, i) => p.value !== previewSaved[i].value);

  const benchHistory = data.history.strategyBenchmarks
    .filter((r) => r.employee_key === lo.employeeKey && r.strategy === strategy)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at));

  /* Las revisiones de la regla, agrupadas: una revisión es una decisión. */
  const ruleRevisions = new Map<number, typeof data.history.growthRules>();
  for (const r of data.history.growthRules) {
    if (r.employee_key !== lo.employeeKey || r.strategy !== strategy) continue;
    ruleRevisions.set(r.revision, [...(ruleRevisions.get(r.revision) ?? []), r]);
  }
  const revisionsDesc = [...ruleRevisions.entries()].sort((a, b) => b[0] - a[0]);

  async function saveBenchmark() {
    const parsed = Number(benchValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('El benchmark tiene que ser un número de 0 o más.');
      return;
    }
    setBusy('bench');
    setError(null);
    try {
      await saveStrategyBenchmark({
        employeeKey: lo.employeeKey,
        strategy: strategy as EditableStrategy,
        monthlyBenchmark: parsed,
        /* ⚠ Siempre el primer día del mes SIGUIENTE. Ver `lib/outlook/save.ts`. */
        effectiveFrom: data.effectiveFrom,
        note: benchNote.trim() === '' ? null : benchNote.trim(),
      });
      await onSaved();
      setSaved(`Benchmark guardado: ${fmt(parsed)} desde ${data.effectiveFrom}. Es una fila nueva; las anteriores siguen.`);
      setBenchValue('');
      setBenchNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveRule() {
    /*
     * Los tramos tienen que ir en orden y sin repetir mes: dos tramos que
     * arrancan el mismo mes hacen ambiguo cuál rige, y `projectMonth` resolvería
     * la ambigüedad en silencio quedándose con uno.
     */
    const monthsSeen = new Set<string>();
    for (const seg of segments) {
      if (monthsSeen.has(seg.fromMonth)) {
        setError('Hay dos tramos que arrancan el mismo mes. Cada tramo tiene que empezar en un mes distinto.');
        return;
      }
      monthsSeen.add(seg.fromMonth);
      if (!Number.isFinite(seg.growthPct) || seg.growthPct < -100) {
        setError('El crecimiento de un tramo no puede bajar de -100%.');
        return;
      }
    }
    setBusy('rule');
    setError(null);
    try {
      const written = await saveGrowthRuleRevision({
        employeeKey: lo.employeeKey,
        strategy,
        /* Ordenados por mes: el `segment_order` que se guarda es el de la lista. */
        segments: [...segments].sort((a, b) => a.fromMonth.localeCompare(b.fromMonth)),
        note: ruleNote.trim() === '' ? null : ruleNote.trim(),
      });
      await onSaved();
      setSaved(
        `Regla guardada como revisión ${written}` +
          (written > 1 ? `. La revisión ${written - 1} queda entera y legible en el historial.` : '.')
      );
      setRuleNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function patch(i: number, change: Partial<GrowthSegment>) {
    setSegments((prev) => prev.map((s, j) => (j === i ? { ...s, ...change } : s)));
  }

  /* El mes por defecto de un tramo nuevo: el siguiente al último que ya hay. */
  function addSegment() {
    const used = new Set(segments.map((s) => s.fromMonth));
    const free = months.find((m) => !used.has(m));
    setSegments((prev) => [
      ...prev,
      { fromMonth: free ?? months[months.length - 1] ?? data.currentMonth, cadence: 'quarterly', growthPct: 0 },
    ]);
  }

  return (
    <Modal title={`${lo.fullName} — ${strategy}`} onClose={onClose}>
      <div className="ol-editor">
        {/* ── El benchmark ─────────────────────────────────────────────── */}
        <section className="ol-editor__block">
          <h3 className="ol-editor__h">Benchmark mensual</h3>

          {benchmarkEditable ? (
            <>
              <div className="ol-editor__row">
                <div className="bp-form__field">
                  <label className="bp-form__label" htmlFor="ol-bench">
                    Nuevo valor
                  </label>
                  <input
                    id="ol-bench"
                    type="number"
                    step="0.5"
                    min="0"
                    className="field ol-editor__num"
                    value={benchValue}
                    onChange={(e) => setBenchValue(e.target.value)}
                    placeholder={savedSchedule.length ? fmt(benchmarkAt(savedSchedule, months[0] ?? data.currentMonth)) : '0'}
                  />
                </div>
                <div className="bp-form__field ol-editor__grow">
                  <label className="bp-form__label" htmlFor="ol-bench-note">
                    Por qué este número (opcional)
                  </label>
                  <input
                    id="ol-bench-note"
                    type="text"
                    className="field"
                    value={benchNote}
                    onChange={(e) => setBenchNote(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="bp-btn bp-btn--small"
                  onClick={saveBenchmark}
                  disabled={busy !== null || benchValue.trim() === ''}
                >
                  {busy === 'bench' ? '…' : 'Guardar'}
                </button>
              </div>
              {/*
                Que la fecha esté a la vista y no sólo en el código: quien carga
                un presupuesto tiene que saber que no toca el mes en curso.
              */}
              <p className="ol-editor__hint">
                Rige desde <b>{data.effectiveFrom}</b> — el primer día del mes siguiente. El mes en curso ya se está
                midiendo contra el benchmark anterior y no se toca.
              </p>
            </>
          ) : (
            <p className="ol-editor__hint">
              Own Production no se edita acá. Su benchmark vive en <code>org.employee_benchmark</code> y se cambia en{' '}
              <Link href={`/business-plan/lo/${lo.employeeKey}`}>el perfil del Business Plan</Link>. Tenerlo en dos
              lugares daría dos valores para el mismo dato y ninguna forma de saber cuál manda — el CHECK de la tabla lo
              impide, no es una omisión. Su <b>regla de crecimiento</b> sí se decide acá, abajo.
            </p>
          )}

          {savedSchedule.length > 0 && benchmarkEditable && (
            <table className="piv ol-editor__tbl">
              <thead>
                <tr className="mo-row">
                  <th className="lbl">Rige desde</th>
                  <th className="bp-center">Benchmark</th>
                </tr>
              </thead>
              <tbody>
                {[...savedSchedule]
                  .sort((a, b) => b.fromMonth.localeCompare(a.fromMonth))
                  .map((p) => (
                    <tr key={p.fromMonth} className="metric">
                      <td className="lbl">{p.fromMonth}</td>
                      <td className="bp-center">{fmt(p.value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── La regla ─────────────────────────────────────────────────── */}
        <section className="ol-editor__block">
          <h3 className="ol-editor__h">
            Regla de crecimiento{' '}
            <span className="bp-muted ol-editor__rev">
              {revision === 0 ? 'sin revisión guardada' : `revisión ${revision} vigente · al guardar queda la ${revision + 1}`}
            </span>
          </h3>

          <table className="piv ol-editor__tbl">
            <thead>
              <tr className="mo-row">
                <th className="lbl">Desde</th>
                <th className="lbl">Cada</th>
                <th className="bp-center">Crecimiento</th>
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
                      aria-label="Mes desde el que aplica el tramo"
                    >
                      {/*
                        Sólo los meses que este módulo proyecta. Un tramo que
                        arranca antes cambiaría la cuenta de períodos --y por lo
                        tanto los meses de acá-- desde un mes que la tabla no
                        muestra: el número se movería sin nada visible que lo
                        explique.
                      */}
                      {months.map((m) => (
                        <option key={m} value={m}>
                          {monthLabel(m)} {m.split('-')[0]}
                        </option>
                      ))}
                      {!months.includes(seg.fromMonth) && (
                        <option value={seg.fromMonth}>{seg.fromMonth} (guardado)</option>
                      )}
                    </select>
                  </td>
                  <td className="lbl">
                    <select
                      className="field ol-editor__sel"
                      value={seg.cadence}
                      onChange={(e) => patch(i, { cadence: e.target.value as Cadence })}
                      aria-label="Cadencia del tramo"
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
                      aria-label="Porcentaje de crecimiento del tramo"
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
                        quitar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ol-editor__row">
            <button type="button" className="bp-linkish" onClick={addSegment} disabled={segments.length >= months.length}>
              + agregar tramo
            </button>
            {segments.length >= months.length && (
              <span className="bp-muted ol-editor__hint">
                Un tramo por mes proyectado es el máximo: dos tramos no pueden arrancar el mismo mes.
              </span>
            )}
          </div>

          {/*
            El 0% no es un caso raro que haya que explicar en el código: es la
            única forma de decir "no crece" en un modelo append-only, porque una
            revisión sin tramos no tiene filas y entonces no existe.
          */}
          <p className="ol-editor__hint">
            Para que no crezca, un tramo de <b>0%</b> — así queda firmado quién decidió que no creciera. Un tramo nuevo
            reemplaza al anterior desde su mes: <b>el último tramo que arrancó es el que rige</b>.
          </p>

          <div className="ol-editor__row">
            <div className="bp-form__field ol-editor__grow">
              <label className="bp-form__label" htmlFor="ol-rule-note">
                Por qué esta regla (opcional)
              </label>
              <input
                id="ol-rule-note"
                type="text"
                className="field"
                value={ruleNote}
                onChange={(e) => setRuleNote(e.target.value)}
              />
            </div>
            <button type="button" className="bp-btn bp-btn--small" onClick={saveRule} disabled={busy !== null}>
              {busy === 'rule' ? '…' : `Guardar revisión ${revision + 1}`}
            </button>
          </div>
        </section>

        {/* ── Qué pasaría ──────────────────────────────────────────────── */}
        <section className="ol-editor__block">
          <h3 className="ol-editor__h">
            Qué pasaría <span className="bp-muted ol-editor__rev">sin guardar · las mismas funciones que la tabla</span>
          </h3>
          {months.length === 0 ? (
            <p className="ol-editor__hint">
              No queda ningún mes por proyectar este año. Lo que se guarde ahora rige desde {data.effectiveFrom}.
            </p>
          ) : (
            <table className="piv ol-editor__tbl">
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
                <tr className="metric">
                  <td className="lbl bp-muted">Hoy</td>
                  {previewSaved.map((p) => (
                    <td key={p.month} className={'bp-center' + (p.value ? '' : ' zero')}>
                      {p.value}
                    </td>
                  ))}
                </tr>
                <tr className="metric" style={{ fontWeight: 700 }}>
                  <td className="lbl">Con este cambio</td>
                  {preview.map((p) => (
                    <td key={p.month} className={'bp-center' + (p.value ? '' : ' zero')} title={p.explain}>
                      {p.value}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          {months.length > 0 && (
            <p className="ol-editor__hint">
              {changesPreview ? (
                <>
                  Cada celda trae su cuenta en el tooltip. El aumento cae cuando se cumple el <b>período completo</b>:
                  con {cadenceLabel(segments[0]?.cadence ?? 'quarterly')} desde {monthLabel(segments[0]?.fromMonth ?? (months[0] ?? data.currentMonth))}, el
                  primer mes es el benchmark tal cual.
                </>
              ) : (
                <>Con estos valores la proyección no cambia respecto de lo que ya está guardado.</>
              )}
            </p>
          )}
        </section>

        {error && <div className="bp-notice bp-notice--warn ol-editor__msg">{error}</div>}
        {saved && !error && <div className="bp-notice ol-editor__msg">{saved}</div>}

        {/* ── La historia ──────────────────────────────────────────────── */}
        <section className="ol-editor__block">
          <button type="button" className="bp-linkish" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'ocultar historial' : `ver historial (${benchHistory.length + revisionsDesc.length} decisión(es))`}
          </button>

          {showHistory && (
            <>
              <h3 className="ol-editor__h">Benchmarks guardados</h3>
              <table className="piv ol-editor__tbl">
                <thead>
                  <tr className="mo-row">
                    <th className="lbl">Rige desde</th>
                    <th className="bp-center">Valor</th>
                    <th className="bp-left">Quién</th>
                    <th className="bp-left">Cuándo</th>
                    <th className="bp-left">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {benchHistory.map((r) => (
                    <tr key={r.strategy_benchmark_key} className="metric">
                      <td className="lbl">{r.effective_from}</td>
                      <td className="bp-center">{fmt(Number(r.monthly_benchmark))}</td>
                      <td className="bp-left">{r.set_by}</td>
                      <td className="bp-left">{stamp(r.created_at)}</td>
                      <td className="bp-left bp-history__note">{r.note ?? '—'}</td>
                    </tr>
                  ))}
                  {benchHistory.length === 0 && (
                    <tr>
                      <td className="lbl bp-empty-cell" colSpan={5}>
                        {benchmarkEditable
                          ? 'Nadie fijó todavía el benchmark de esta estrategia.'
                          : 'El historial de Own Production está en el perfil del Business Plan.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <h3 className="ol-editor__h">Revisiones de la regla</h3>
              {revisionsDesc.map(([rev, rows]) => (
                <div key={rev} className={'ol-editor__rev-card' + (rev === revision ? ' is-current' : '')}>
                  <div className="ol-editor__rev-head">
                    <b>Revisión {rev}</b>
                    {rev === revision && <span className="ol-editor__tag">vigente</span>}
                    <span className="bp-muted">
                      {rows[0].set_by} · {stamp(rows[0].created_at)}
                    </span>
                  </div>
                  <div className="ol-editor__rev-body">
                    {[...rows]
                      .sort((a, b) => a.segment_order - b.segment_order)
                      .map((r) => (
                        <span key={r.growth_rule_key} className="ol-editor__seg">
                          {Number(r.growth_pct)}% {cadenceLabel(r.cadence)} desde {r.from_month.slice(0, 7)}
                        </span>
                      ))}
                  </div>
                  {rows[0].note && <div className="ol-editor__rev-note">{rows[0].note}</div>}
                </div>
              ))}
              {revisionsDesc.length === 0 && (
                <p className="ol-editor__hint">No hay ninguna regla guardada para esta estrategia.</p>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
