'use client';

import { useState } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import type { BudgetBucket, OutlookData } from '@/lib/outlook/loadData';
import {
  cadenceLabel,
  projectPlan,
  type BenchmarkPoint,
  type Cadence,
  type GrowthSegment,
} from '@/lib/outlook/project';
import {
  savePersonBudgetBreakdown,
  savePersonBudgetTotal,
  type PersonSubject,
} from '@/lib/outlook/save';

/**
 * ============================================================================
 * SET BUDGET — una sola pantalla (etapa OL26, corregida en OL26d)
 * ============================================================================
 *
 * ⚠ EL MODELO ERA DOS CAMINOS QUE TERMINABAN EN PANTALLAS DISTINTAS. Hasta acá,
 * la regla de crecimiento de Own Production (por mes o por tasa) se decidía en
 * su propia sección, con su propio guardado -- `outlook.growth_rule` /
 * `monthly_target` / `projection_mode` -- y el presupuesto compuesto (el
 * total y su desglose, punto 5) vivía en OTRA sección, con OTRO guardado. Dos
 * decisiones sobre el mismo número, en dos lugares.
 *
 * Ahora hay UN solo lugar donde el número vive: la fila `Own Production` de
 * esta tabla. Los dos modos escriben ahí:
 *
 *   por mes    se escribe el número de cada mes directo en la fila.
 *   por tasa   se elige el período (igual que antes: desde qué mes, cada
 *              cuánto, qué porcentaje) y "Apply" calcula con `projectPlan` --
 *              la MISMA función que arma la tabla del branch, no una copia --
 *              y llena la fila con el resultado. De ahí en más son números
 *              comunes: se pueden seguir ajustando a mano.
 *
 * ⚠ APLICAR UNA TASA NO GUARDA UNA REGLA. Es una calculadora: toma el
 * benchmark ya guardado (`ownProductionRate.savedSchedule`, de
 * `org.employee_benchmark` vía el Business Plan) y el período elegido, y
 * escribe el resultado en la fila. Lo único que se guarda al final es la fila
 * -- `outlook.person_budget_total` / `person_budget_breakdown` --, con el
 * mismo botón que guarda todo lo demás. `outlook.growth_rule` deja de
 * escribirse desde esta pantalla.
 *
 * ⚠ RECRUITMENT YA TIENE FILA -- agregado en OL26e (ver
 * `docs/sql/2026-09-outlook-budget-recruitment-bucket.sql`). Sólo aparece para
 * quien participa del programa (`person.buckets` lo decide en `page.tsx` con
 * `participatesInRecruitment`); un realtor NPPM sigue sin poder tenerlo -- no
 * participa del programa, y el CHECK de la base lo rechaza igual.
 *
 * ============================================================================
 * GOBIERNO DE LA PROYECCIÓN — etapa OL26e
 * ============================================================================
 *
 * Hasta OL26d, "Set budget" no tenía ningún efecto sobre la tabla del branch:
 * el Total que se guardaba acá (`outlook.person_budget_total`) era puramente
 * informativo, y la columna que se ve arriba seguía saliendo, siempre, del
 * motor de siempre (`growth_rule`/`monthly_target`/`projection_mode`). Eso se
 * reportó y la decisión, de Isabella, fue:
 *
 *   "person_budget_total manda cuando existe, la regla cuando no."
 *
 * Por persona y por MES: si hay un Total fijado para ese mes, ese número
 * gobierna la proyección (`projectBranch` y `loanOfficerRowsOf`, en
 * loadData.ts / strategyRows.ts); si no, sigue la regla de crecimiento de
 * siempre, intacta -- las 190 reglas que ya existían no se descartan, siguen
 * siendo el default de quien nadie tocó. Un Total parcial (p.ej. sólo
 * enero-junio) no extrapola ni corta nada: julio-diciembre caen solos a la
 * regla.
 *
 * Por eso esta pantalla ahora tiene que DECIRLO: para alguien que hoy proyecta
 * por regla, guardar un Total acá no es "un ajuste más" -- es un cambio de
 * gobierno para los meses que cubra. El aviso de abajo (`ol-editor__gov`)
 * existe para que quien abre la pantalla lo vea antes de guardar, no
 * después.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.split('-')[1]) - 1];
const CADENCES: Cadence[] = ['monthly', 'quarterly', 'semiannual'];

const BUCKET_LABEL: Record<BudgetBucket, string> = {
  own_production: 'Own Production',
  b2b: 'B2B',
  nppm: 'NPPM',
  recruitment: 'Recruitment',
  business_plan: 'Business Plan',
};

function stamp(iso: string): string {
  return String(iso).slice(0, 16).replace('T', ' ');
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * A quién pertenece este presupuesto, y qué buckets le aplican — confirmado
 * con Isabella: los cuatro a un Loan Officer, sólo `own_production` y
 * `business_plan` a un realtor NPPM. "Un realtor NPPM no tiene B2B ni NPPM
 * propios -- su producción es lo que trae él, más lo que sume un plan si lo
 * tiene."
 */
export interface BudgetEditable {
  subject: PersonSubject;
  label: string;
  buckets: BudgetBucket[];
  budgetTotal: Record<string, number>;
  budgetTotalRevision: number;
  budgetBreakdown: Partial<Record<BudgetBucket, Record<string, number>>>;
  budgetBreakdownRevision: number;
}

/**
 * Lo mínimo para calcular "qué produciría esta tasa" para Own Production:
 * el benchmark guardado (la base sobre la que crece) y la regla vigente, sólo
 * para prellenar la calculadora con lo último que se usó. `null` para un
 * realtor NPPM, que no tiene benchmark de Own Production.
 */
export interface OwnProductionRate {
  savedSchedule: BenchmarkPoint[];
  savedSegments: GrowthSegment[];
}

export default function PersonBudgetEditor({
  person,
  ownProductionRate,
  data,
  months: mesesDelHorizonte,
  onClose,
  onSaved,
}: {
  person: BudgetEditable;
  /** `null` para un realtor NPPM: no tiene regla de crecimiento que calcular. */
  ownProductionRate: OwnProductionRate | null;
  data: OutlookData;
  /** Los meses que la pantalla está mostrando, no `data.remainingMonths` a secas -- mismo motivo de siempre. */
  months?: string[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const months = mesesDelHorizonte ?? data.remainingMonths;

  /*
   * ⚠ "HOY" ES `person.budgetTotal` TAL COMO LLEGÓ, no `totals` (el estado
   * editable) -- el aviso tiene que decir de qué fuente viene la proyección
   * ANTES de que alguien toque un input, no recalcularse mientras escribe.
   *
   * ⚠ SÓLO PARA UN LOAN OFFICER -- etapa OL26e. La precedencia nueva
   * ("person_budget_total manda cuando existe, la regla cuando no") se cableó
   * en `projectBranch` y `loanOfficerRowsOf`, que sólo leen `OutlookLoanOfficer`.
   * Un realtor NPPM proyecta distinto -- por su propio benchmark/promedio de 3
   * meses (`avg3m`/`nppm_realtor_benchmark`), no por `growth_rule` -- y ESE
   * mecanismo no se tocó en esta etapa. Mostrarle este aviso a un realtor
   * afirmaría un cambio de gobierno que hoy no pasa: guardar su Total sigue
   * siendo informativo para él, igual que antes de OL26e.
   */
  const monthsByRule =
    person.subject.kind === 'employee' ? months.filter((m) => person.budgetTotal[m] === undefined) : [];
  const monthsByBudget =
    person.subject.kind === 'employee' ? months.filter((m) => person.budgetTotal[m] !== undefined) : [];

  const [totals, setTotals] = useState<Record<string, string>>(() =>
    Object.fromEntries(months.map((m) => [m, person.budgetTotal[m] === undefined ? '' : String(person.budgetTotal[m])]))
  );
  const [breakdown, setBreakdown] = useState<Record<BudgetBucket, Record<string, string>>>(() =>
    Object.fromEntries(
      person.buckets.map((b) => [
        b,
        Object.fromEntries(months.map((m) => [m, person.budgetBreakdown[b]?.[m] === undefined ? '' : String(person.budgetBreakdown[b]?.[m])])),
      ])
    ) as Record<BudgetBucket, Record<string, string>>
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  /* La calculadora de tasa para Own Production -- cerrada por default: el modo
     por mes (los números de la fila, tal cual) es lo que se ve al abrir. */
  const [rateOpen, setRateOpen] = useState(false);
  const [rateSegments, setRateSegments] = useState<GrowthSegment[]>(
    ownProductionRate && ownProductionRate.savedSegments.length > 0
      ? ownProductionRate.savedSegments
      : [{ fromMonth: months[0] ?? data.currentMonth, cadence: 'quarterly', growthPct: 0 }]
  );

  function totalOf(m: string): number | null {
    const raw = totals[m]?.trim();
    return raw === '' || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw);
  }
  function bucketOf(b: BudgetBucket, m: string): number {
    const raw = breakdown[b]?.[m]?.trim();
    return raw === '' || raw === undefined || !Number.isFinite(Number(raw)) ? 0 : Number(raw);
  }
  function breakdownSumOf(m: string): number {
    return person.buckets.reduce((a, b) => a + bucketOf(b, m), 0);
  }
  /** `null` = no hay total contra qué comparar. */
  function deltaOf(m: string): number | null {
    const t = totalOf(m);
    return t === null ? null : t - breakdownSumOf(m);
  }

  /**
   * Calcula con `projectPlan` -- la MISMA función que arma la tabla del
   * branch -- y escribe el resultado en la fila de Own Production. No guarda
   * nada todavía: eso lo hace "Save budget", como el resto de la fila.
   */
  function applyRate() {
    if (!ownProductionRate) return;
    const steps = projectPlan(months, {
      mode: 'growth',
      benchmarks: ownProductionRate.savedSchedule,
      segments: rateSegments,
      targets: {},
    });
    setBreakdown((prev) => ({
      ...prev,
      own_production: Object.fromEntries(months.map((m, i) => [m, String(steps[i]?.value ?? 0)])),
    }));
    setRateOpen(false);
  }
  function patchSegment(i: number, change: Partial<GrowthSegment>) {
    setRateSegments((prev) => prev.map((s, j) => (j === i ? { ...s, ...change } : s)));
  }
  function addSegment() {
    const used = new Set(rateSegments.map((s) => s.fromMonth));
    const free = months.find((m) => !used.has(m));
    setRateSegments((prev) => [
      ...prev,
      { fromMonth: free ?? months[months.length - 1] ?? data.currentMonth, cadence: 'quarterly', growthPct: 0 },
    ]);
  }

  const totalsChanged = months.some((m) => totalOf(m) !== (person.budgetTotal[m] ?? null));
  const breakdownChanged = person.buckets.some((b) =>
    months.some((m) => bucketOf(b, m) !== (person.budgetBreakdown[b]?.[m] ?? 0))
  );
  /* Lo que el botón de guardar tenía que mirar y no miraba. Ver su nota. */
  const nadaQueGuardar = !totalsChanged && !breakdownChanged;

  /*
   * ============================================================================
   * GUARDAR CON DIFERENCIA — etapa OL26f
   * ============================================================================
   *
   * "No forzar" (el desglose no tiene que sumar el total, y el CHECK de la
   * base a propósito no lo exige) no es lo mismo que "guardar en silencio".
   * Isabella probó la pantalla y guardó un desglose que no sumaba sin darse
   * cuenta -- la fila `Difference` ya lo mostraba, pero nada en el botón lo
   * decía.
   *
   * ⚠ EL BOTÓN, NO UNA CONFIRMACIÓN -- decisión de Isabella: "es un gesto
   * menos que una confirmación, y el número queda a la vista mientras se
   * decide". Un modal de confirmación exige una decisión ANTES de ver el
   * número de nuevo (hay que recordarlo del paso anterior); el botón lo
   * muestra en el mismo lugar donde se hace clic, así que se puede volver a
   * mirar la fila de arriba sin cerrar nada.
   *
   * Suma el ABSOLUTO de la diferencia de cada mes, no el neto: enero +5 y
   * febrero -5 no puede mostrar "sin diferencia" cuando los dos meses están
   * mal, cada uno por su lado.
   *
   * Sólo cuenta si ALGO se va a guardar (`totalsChanged || breakdownChanged`)
   * -- si nadie tocó nada, `save()` no escribe ninguna tabla (ver más abajo,
   * "Nothing had changed"), y el botón no puede advertir sobre un guardado
   * que no va a pasar.
   */
  function pendingDifference(): number {
    if (!totalsChanged && !breakdownChanged) return 0;
    return months.reduce((sum, m) => {
      const d = deltaOf(m);
      return sum + (d === null ? 0 : Math.abs(d));
    }, 0);
  }
  const saveDiff = pendingDifference();
  const saveLabel = saveDiff > 0.001 ? `Save with a difference of ${fmtNum(saveDiff)}` : 'Save budget';

  /*
   * Quién guardó la revisión vigente de cada tabla, para la línea al pie. Por
   * código, no por nombre normalizado -- ver la nota de `PersonSubject` en
   * save.ts.
   */
  const isMine = (r: { employee_key: number | null; nppm_realtor_code: string | null }) =>
    person.subject.kind === 'employee'
      ? r.employee_key === person.subject.employeeKey
      : r.nppm_realtor_code === person.subject.realtorCode;
  const lastTotalRow = data.history.personBudgetTotals
    .filter((r) => isMine(r) && r.revision === person.budgetTotalRevision)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const lastBreakdownRow = data.history.personBudgetBreakdowns
    .filter((r) => isMine(r) && r.revision === person.budgetBreakdownRevision)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    const done: string[] = [];
    try {
      if (totalsChanged) {
        const targets: Record<string, number> = {};
        for (const m of months) {
          const v = totalOf(m);
          if (v !== null) targets[m] = v;
        }
        if (Object.keys(targets).length > 0) {
          const rev = await savePersonBudgetTotal({ subject: person.subject, targets, note: note.trim() === '' ? null : note.trim() });
          done.push(`total revision ${rev}`);
        }
      }
      if (breakdownChanged) {
        const draft: Partial<Record<BudgetBucket, Record<string, number>>> = {};
        for (const b of person.buckets) {
          const byMonth: Record<string, number> = {};
          for (const m of months) {
            const raw = breakdown[b]?.[m]?.trim();
            if (raw !== '' && raw !== undefined && Number.isFinite(Number(raw))) byMonth[m] = Number(raw);
          }
          if (Object.keys(byMonth).length > 0) draft[b] = byMonth;
        }
        if (Object.keys(draft).length > 0) {
          const rev = await savePersonBudgetBreakdown({
            subject: person.subject,
            breakdown: draft,
            note: note.trim() === '' ? null : note.trim(),
          });
          done.push(`breakdown revision ${rev}`);
        }
      }

      if (done.length === 0) {
        setSaved('Nothing had changed.');
      } else {
        await onSaved();
        setSaved('Saved: ' + done.join(' · ') + '.');
        setNote('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${person.label} — Set budget`}
      onClose={onClose}
      footer={
        <div className="ol-editor__row">
          <div className="bp-form__field ol-editor__grow">
            <label className="bp-form__label" htmlFor="ol-budget-note">
              Why (optional)
            </label>
            <input
              id="ol-budget-note"
              type="text"
              className="field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {/*
            ═══════════════════════════════════════════════════════════════
            ⚠ EL BOTÓN NO SABÍA SI HABÍA ALGO QUE GUARDAR — OL26g, punto 3
            ═══════════════════════════════════════════════════════════════

            El síntoma: Isabella guarda, dice que guardó, y le vuelve a
            aparecer el botón de guardar.

            No estaba guardando dos veces, y el estado SÍ se refrescaba. Medido
            en sus propias filas: la revisión 1 se escribió 12:50:59 con UN mes
            y la 2 a las 12:51:53 con SEIS. Cincuenta y cuatro segundos y
            contenido distinto -- dos guardados deliberados. Un doble guardado
            del mismo clic habría dejado dos filas del mismo instante con el
            mismo contenido.

            Era esto: `disabled={busy}` y nada más. Terminado el guardado,
            `busy` vuelve a `false`, el botón se habilita otra vez y sigue
            diciendo «Save budget» -- justo al lado del cartel «Saved: …». Las
            dos cosas juntas se leen como «guardó pero me lo vuelve a pedir».

            `totalsChanged` y `breakdownChanged` ya sabían la respuesta: después
            del `reload` los dos quedan en `false`. Faltaba que el botón los
            mirara.

            ⚠ Y con esto la rama `done.length === 0` de `save()` --«Nothing had
            changed.»-- queda inalcanzable desde este botón. Se deja igual: es
            una guarda redundante a propósito.
          */}
          <button
            type="button"
            className="bp-btn bp-btn--small"
            onClick={save}
            disabled={busy || nadaQueGuardar}
          >
            {busy ? '…' : nadaQueGuardar ? 'Nothing to save' : saveLabel}
          </button>
        </div>
      }
    >
      <div className="ol-editor">
        <h2 className="ol-editor__h">BUDGET COMPOSITION</h2>
        <p className="ol-editor__hint">Where the total is expected to come from. It does not have to add up.</p>

        {monthsByRule.length > 0 && (
          <p className="bp-notice bp-notice--warn ol-editor__gov">
            ⚠{' '}
            {monthsByBudget.length === 0
              ? 'Every month here currently projects by growth rule.'
              : `${monthsByRule.map(monthLabel).join(', ')} currently project by growth rule.`}{' '}
            Saving a Total for a month replaces the rule for that month — it is a change of governance, not an
            adjustment.
          </p>
        )}

        {months.length === 0 ? (
          <p className="ol-editor__hint">There is no month left to set this year.</p>
        ) : (
          <div className="tbl-scroll">
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
                <tr className="metric" style={{ fontWeight: 700 }}>
                  <td className="lbl">Total</td>
                  {months.map((m) => (
                    <td key={m} className="bp-center">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className="field ol-editor__num"
                        value={totals[m] ?? ''}
                        onChange={(e) => setTotals((prev) => ({ ...prev, [m]: e.target.value }))}
                        aria-label={`Total for ${monthLabel(m)}`}
                      />
                    </td>
                  ))}
                </tr>
                {person.buckets.map((b) => (
                  <tr key={b} className="metric">
                    <td className="lbl bp-muted">
                      {BUCKET_LABEL[b]}
                      {b === 'own_production' && ownProductionRate && (
                        <button type="button" className="bp-linkish ol-editor__ratelink" onClick={() => setRateOpen((v) => !v)}>
                          {rateOpen ? 'hide rate' : 'apply a rate'}
                        </button>
                      )}
                    </td>
                    {months.map((m) => (
                      <td key={m} className="bp-center">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          className="field ol-editor__num"
                          value={breakdown[b]?.[m] ?? ''}
                          onChange={(e) =>
                            setBreakdown((prev) => ({ ...prev, [b]: { ...prev[b], [m]: e.target.value } }))
                          }
                          aria-label={`${BUCKET_LABEL[b]} for ${monthLabel(m)}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="metric ol-residual">
                  <td className="lbl">Difference</td>
                  {months.map((m) => {
                    const d = deltaOf(m);
                    const off = d !== null && Math.abs(d) > 0.001;
                    return (
                      <td
                        key={m}
                        className={'bp-center' + (off ? ' ol-editor__delta--off' : '')}
                        title={
                          d === null
                            ? 'No total set yet.'
                            : !off
                              ? 'Adds up to the total.'
                              : `${d > 0 ? 'Short by' : 'Over by'} ${fmtNum(Math.abs(d))}.`
                        }
                      >
                        {d === null ? '' : fmtNum(d)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {rateOpen && ownProductionRate && (
          <section className="ol-editor__rate">
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
                {rateSegments.map((seg, i) => (
                  <tr key={i} className="metric">
                    <td className="lbl">
                      <select
                        className="field ol-editor__sel"
                        value={seg.fromMonth}
                        onChange={(e) => patchSegment(i, { fromMonth: e.target.value })}
                        aria-label="Month the segment starts in"
                      >
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
                        onChange={(e) => patchSegment(i, { cadence: e.target.value as Cadence })}
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
                        onChange={(e) => patchSegment(i, { growthPct: Number(e.target.value) })}
                        aria-label="Segment growth percentage"
                      />
                      <span className="ol-editor__pct">%</span>
                    </td>
                    <td className="lbl">
                      {rateSegments.length > 1 && (
                        <button
                          type="button"
                          className="bp-linkish"
                          onClick={() => setRateSegments((prev) => prev.filter((_, j) => j !== i))}
                        >
                          remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ol-editor__row">
              <button type="button" className="bp-linkish" onClick={addSegment} disabled={rateSegments.length >= months.length}>
                + another segment
              </button>
              <button type="button" className="bp-btn bp-btn--small" onClick={applyRate}>
                Apply to Own Production
              </button>
            </div>
          </section>
        )}

        {(lastTotalRow || lastBreakdownRow) && (
          <p className="ol-editor__hint">
            {lastTotalRow && (
              <>
                Total set by <b>{lastTotalRow.set_by}</b> on {stamp(lastTotalRow.created_at)} (revision{' '}
                {person.budgetTotalRevision}).
              </>
            )}
            {lastTotalRow && lastBreakdownRow ? ' ' : ''}
            {lastBreakdownRow && (
              <>
                Breakdown set by <b>{lastBreakdownRow.set_by}</b> on {stamp(lastBreakdownRow.created_at)} (revision{' '}
                {person.budgetBreakdownRevision}).
              </>
            )}
          </p>
        )}
        {!lastTotalRow && !lastBreakdownRow && (
          <p className="ol-editor__hint">Nobody has set a composed budget for this person yet.</p>
        )}

        {error && <div className="bp-notice bp-notice--warn ol-editor__msg">{error}</div>}
        {saved && !error && <div className="bp-notice ol-editor__msg">{saved}</div>}
      </div>
    </Modal>
  );
}
