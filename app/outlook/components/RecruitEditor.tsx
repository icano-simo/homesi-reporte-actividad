'use client';

import { useState } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import type { BranchRecruit } from '@/lib/outlook/loadData';
import { STAGE_LABEL } from '@/lib/outlook/recruitment';
import { saveRecruitLink, saveRecruitProjection } from '@/lib/outlook/save';

/**
 * ============================================================================
 * EL EDITOR DE UNA PROYECCIÓN DE RECLUTAMIENTO — etapa OL20
 * ============================================================================
 *
 * ⚠ DOS FECHAS Y NO UNA, y hace falta que sean dos:
 *
 *   Start date      cuándo entra. Precargada de `fecha_inicio` cuando existe --
 *                   sólo la traen los 2 de `hr_pipeline`; los 13 de Salesforce
 *                   no tienen ninguna, así que sin este campo no habría de dónde
 *                   sacarla.
 *   Producing from  desde qué mes cuenta para el presupuesto. Puede ser
 *                   POSTERIOR a la de entrada: entrar y producir no son el mismo
 *                   mes, y alguien que empieza el 14 de septiembre no produce un
 *                   septiembre.
 *
 * ⚠ NUNCA SE USA `close_date` COMO FECHA DE ENTRADA. Es cuándo se cerró el
 * reclutamiento, no cuándo empieza a trabajar; usarla adelantaría la producción
 * de todos. Se muestra, porque explica la etapa, pero no se copia a ningún
 * campo.
 *
 * ⚠ Y EL BRANCH ES EDITABLE. `Recruitment` es un marcador de "todavía no se
 * sabe", no un lugar: cuando se sepa a dónde va alguien, se corrige acá sin
 * esperar a que la fuente lo traiga.
 *
 * Usa el mismo `Modal` y las mismas clases que `StrategyEditor` -- `ol-editor`,
 * `bp-form__label`, `bp-btn` -- porque es el mismo tipo de decisión y tiene que
 * verse igual. Inventar clases nuevas habría dado un panel sin estilos.
 */
export default function RecruitEditor({
  recruit,
  branches,
  onClose,
  onSaved,
}: {
  recruit: BranchRecruit;
  /** Los branches reales, para no obligar a tipear un código. */
  branches: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(recruit.personName);
  const [branch, setBranch] = useState(recruit.branchCodeActual);
  const [startDate, setStartDate] = useState(recruit.startDate ?? '');
  const [producingFrom, setProducingFrom] = useState(recruit.producingFrom);
  /*
   * ⚠ EL BENCHMARK VIVE COMO TEXTO mientras se edita, y no como número: un
   * `number | null` no puede representar "el campo está vacío porque lo estoy
   * borrando". Vacío se guarda como `null`, que es "nadie fijó cuánto se
   * espera"; un 0 escrito a mano se guarda como 0, que es "no se espera que
   * produzca". Son dos cosas distintas y el editor tiene que poder decir las dos.
   */
  const [benchmark, setBenchmark] = useState(
    recruit.monthlyBenchmark === null ? '' : String(recruit.monthlyBenchmark)
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numero = benchmark.trim() === '' ? null : Number(benchmark);
  const invalido = numero !== null && (!Number.isFinite(numero) || numero < 0);

  async function save() {
    if (invalido) {
      setError('Monthly production has to be a number, or empty if nobody has decided yet.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveRecruitProjection({
        identity: recruit.identity,
        source: recruit.identity.startsWith('manual:') ? 'manual' : 'future_loan_officer',
        personName: name,
        role: recruit.role,
        branchCode: branch,
        startDate: startDate.trim() === '' ? null : startDate,
        producingFrom,
        monthlyBenchmark: numero,
        nmls: recruit.nmls,
        note: note.trim() === '' ? null : note.trim(),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await saveRecruitLink({ identity: recruit.identity, employeeKey: null, note: 'Unlinked from the branch view.' });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${recruit.personName} — ${STAGE_LABEL[recruit.stage]}`} onClose={onClose}>
      <div className="ol-editor">
        {/*
          El `close_date` se muestra y no se edita: viene de la fuente, explica
          la etapa, y es lo que decide --por fecha-- si un `probable` sigue
          siendo pipeline o pasó a caso sin resolver.
        */}
        {recruit.closeDate && (
          <p className="ol-editor__hint">
            Recruitment closed <b>{recruit.closeDate}</b>. That date comes from the source and is not edited here.
          </p>
        )}

        <div className="ol-editor__row">
          <div className="bp-form__field ol-editor__grow">
            <label className="bp-form__label" htmlFor="rec-name">
              Name
            </label>
            <input id="rec-name" type="text" className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="rec-branch">
              Branch
            </label>
            <input
              id="rec-branch"
              type="text"
              className="field"
              list="rec-branches"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
            <datalist id="rec-branches">
              {branches.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="ol-editor__row">
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="rec-start">
              Start date
            </label>
            <input
              id="rec-start"
              type="date"
              className="field"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="rec-from">
              Producing from
            </label>
            <input
              id="rec-from"
              type="month"
              className="field"
              value={producingFrom}
              onChange={(e) => setProducingFrom(e.target.value)}
            />
          </div>
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="rec-bench">
              Monthly production
            </label>
            <input
              id="rec-bench"
              type="text"
              inputMode="decimal"
              className="field"
              value={benchmark}
              placeholder="nobody has set it"
              onChange={(e) => setBenchmark(e.target.value)}
            />
          </div>
        </div>

        {/*
          La distinción entre vacío y cero, dicha donde se decide: es la que
          hace que una fila sin números se pueda leer sin preguntar.
        */}
        <p className="ol-editor__hint">
          Leave <b>Monthly production</b> empty if nobody has decided yet — the row shows no projection and says why. A
          zero means something different: that no production is expected. And a new hire ramps up — 25% of this the
          first month, 50% the second, 100% from the third.
        </p>

        {recruit.linkedEmployeeKey !== null && (
          <p className="ol-editor__hint">
            Linked to a roster employee{recruit.linkedByNmls ? ' by NMLS, which is an exact match' : ''}, so this
            projection adds nothing: from here on the roster projects them.
          </p>
        )}

        <div className="ol-editor__row">
          <div className="bp-form__field ol-editor__grow">
            <label className="bp-form__label" htmlFor="rec-note">
              Why (optional)
            </label>
            <input id="rec-note" type="text" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {recruit.linkedEmployeeKey !== null && !recruit.linkedByNmls && (
            <button type="button" className="bp-btn bp-btn--small" onClick={unlink} disabled={busy}>
              Unlink
            </button>
          )}
          <button type="button" className="bp-btn bp-btn--small" onClick={save} disabled={busy || invalido}>
            {busy ? '…' : 'Save'}
          </button>
        </div>

        {error && <div className="bp-notice bp-notice--warn ol-editor__msg">{error}</div>}
      </div>
    </Modal>
  );
}
