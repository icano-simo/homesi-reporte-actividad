'use client';

import { useState } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import type { BudgetBucket, OutlookData } from '@/lib/outlook/loadData';
import {
  savePersonBudgetBreakdown,
  savePersonBudgetTotal,
  type PersonSubject,
} from '@/lib/outlook/save';

/**
 * ============================================================================
 * EL PRESUPUESTO COMPUESTO POR PLAN DE NEGOCIO — etapa OL26, punto 5
 * ============================================================================
 *
 * La relación se invierte respecto del resto del módulo: en todos los demás
 * editores se fija un benchmark y una regla, y los meses SALEN de ahí. Acá el
 * TOTAL se escribe directo, mes por mes -- y el desglose de abajo (Own
 * Production, B2B, NPPM, Business Plan) es la explicación de ese total, no su
 * origen.
 *
 * ⚠ EL DESGLOSE NO TIENE POR QUÉ SUMAR EL TOTAL, y la fila `Difference` lo
 * muestra sin corregirlo. Forzarlo -- rechazando el guardado, o reescalando
 * los buckets para que cierren -- inventaría de dónde sale la diferencia; ver
 * `docs/sql/2026-09-outlook-budget-composition.sql`, que tampoco lo fuerza en
 * la base.
 *
 * ⚠ `business_plan` ES UNA EXPECTATIVA DECLARADA, no una lectura del funnel:
 * quien la carga escribe cuánto espera que el plan de acompañamiento
 * produzca. No hay ningún cálculo detrás -- ver el `comment on column` de
 * `person_budget_breakdown.value` en el SQL, que es donde esto tiene que
 * seguir siendo cierto el día que alguien lea el esquema sin este archivo al
 * lado.
 *
 * ---------------------------------------------------------------------------
 * ⚠ DOS GUARDADOS, Y EL ORDEN IMPORTA — mismo criterio que `change_funnel`
 * ---------------------------------------------------------------------------
 * El total se guarda PRIMERO. Si el desglose fallara después, el total ya
 * escrito no se pierde: queda vigente sin desglose todavía, que la pantalla
 * puede mostrar tal cual. Guardar el desglose primero y que el total fallara
 * después dejaría un desglose sin nada contra qué compararse.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.split('-')[1]) - 1];

const BUCKET_LABEL: Record<BudgetBucket, string> = {
  own_production: 'Own Production',
  b2b: 'B2B',
  nppm: 'NPPM',
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

export default function BudgetEditor({
  person,
  data,
  onClose,
  onSaved,
  months: mesesDelHorizonte,
}: {
  person: BudgetEditable;
  data: OutlookData;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  /** Mismo criterio que `StrategyEditor`: los meses que la pantalla muestra, no `data.remainingMonths` a secas. */
  months?: string[];
}) {
  const months = mesesDelHorizonte ?? data.remainingMonths;

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

  const totalsChanged = months.some((m) => totalOf(m) !== (person.budgetTotal[m] ?? null));
  const breakdownChanged = person.buckets.some((b) =>
    months.some((m) => bucketOf(b, m) !== (person.budgetBreakdown[b]?.[m] ?? 0))
  );

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
    <Modal title={`${person.label} — Budget composition`} onClose={onClose}>
      <div className="ol-editor">
        <p className="ol-editor__hint">
          The <b>total</b> is fixed first, month by month — it stops being the sum of the strategies shown above.
          The <b>breakdown</b> below is informational: it explains where the total is expected to come from, and it
          does not have to add up to it — the <b>Difference</b> row shows it, nothing forces it.
        </p>

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
                    <td className="lbl bp-muted">{BUCKET_LABEL[b]}</td>
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
                            ? 'No total set for this month yet, so there is nothing to compare the breakdown against.'
                            : !off
                              ? 'The breakdown adds up to the total.'
                              : `The breakdown ${d > 0 ? 'is short by' : 'is over by'} ${fmtNum(Math.abs(d))}, against the total. Not forced — decide how to close it.`
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
          <button type="button" className="bp-btn bp-btn--small" onClick={save} disabled={busy}>
            {busy ? '…' : 'Save budget'}
          </button>
        </div>

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
