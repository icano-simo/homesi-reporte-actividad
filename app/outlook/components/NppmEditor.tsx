'use client';

import { useState } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import type { OutlookData } from '@/lib/outlook/loadData';
import { saveNppmBenchmark } from '@/lib/outlook/save';

/**
 * ============================================================================
 * EL BENCHMARK DE UN REALTOR NPPM (etapa OL2)
 * ============================================================================
 *
 * Un formulario de un campo, pero con dos cosas que hay que decir en la pantalla
 * y no sólo en el código:
 *
 * 1. **El benchmark es del REALTOR, no del par (realtor, Loan Officer).** El
 *    mismo realtor trabaja con varias personas y en varias branches --Laura
 *    Delgado está en el 733 con Aimmee Buendía y en el 776 con Silvio Arteaga--
 *    así que lo que se guarda acá vale para todos los lugares donde aparezca.
 *    Quien lo edita desde la fila de una persona tiene que saberlo, porque desde
 *    ahí parece un dato de esa persona.
 *
 * 2. **Hoy no proyecta.** Lo que proyecta NPPM es el benchmark de la estrategia
 *    del Loan Officer. Este número es el compromiso con el que se sumó al
 *    realtor, y sirve para contrastarlo contra su producción real -- que es
 *    justamente la pregunta que un presupuesto de NPPM tiene que poder
 *    contestar.
 *
 *    ⚠ Y no se suma automáticamente al de la estrategia a propósito: la
 *    producción de un realtor se reparte entre los Loan Officers con los que
 *    trabaja, y cuánto le toca a cada uno es la asignación que este módulo no
 *    construye. Sumarlos daría un número plausible y falso. Dicho en la
 *    pantalla, es una decisión pendiente; calculado en silencio, sería un bug
 *    que nadie encuentra.
 */

function stamp(iso: string): string {
  return String(iso).slice(0, 16).replace('T', ' ');
}

export default function NppmEditor({
  realtor,
  ytd,
  data,
  onClose,
  onSaved,
}: {
  realtor: string;
  ytd: number;
  data: OutlookData;
  onClose: () => void;
  /* Se espera la recarga antes de anunciar -- ver `StrategyEditor`. */
  onSaved: () => Promise<void> | void;
}) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  /* Mismo criterio de normalización que el loader: trim, espacios, mayúsculas. */
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
  const history = data.history.nppmBenchmarks
    .filter((r) => norm(r.nppm_realtor) === norm(realtor))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at));

  /*
   * Las formas distintas del mismo nombre que ya están guardadas. Si aparecen
   * dos, es que alguien guardó desde una fila con otra capitalización: la app
   * las une al leer, pero mostrarlo evita que parezca que el dato se duplicó.
   */
  const spellings = [...new Set(history.map((r) => r.nppm_realtor))];

  async function save() {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('The benchmark must be a number of 0 or more.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveNppmBenchmark({
        nppmRealtor: realtor,
        monthlyBenchmark: parsed,
        effectiveFrom: data.effectiveFrom,
        note: note.trim() === '' ? null : note.trim(),
      });
      await onSaved();
      setSaved(`Saved: ${parsed} from ${data.effectiveFrom}. It is a new row; the previous ones stay intact.`);
      setValue('');
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${realtor} — NPPM benchmark`} onClose={onClose}>
      <div className="ol-editor">
        <div className="ol-editor__row">
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="ol-nppm">
              Monthly benchmark
            </label>
            <input
              id="ol-nppm"
              type="number"
              step="0.5"
              min="0"
              className="field ol-editor__num"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          <div className="bp-form__field ol-editor__grow">
            <label className="bp-form__label" htmlFor="ol-nppm-note">
              Why this number (optional)
            </label>
            <input
              id="ol-nppm-note"
              type="text"
              className="field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button type="button" className="bp-btn bp-btn--small" onClick={save} disabled={busy || value.trim() === ''}>
            {busy ? '…' : 'Save'}
          </button>
        </div>

        {/*
          Una sola línea, con las dos cosas que hay que saber en el momento de
          decidir: desde cuándo rige y que no proyecta. El porqué --que la
          producción de un realtor se reparte entre varios Loan Officers y cuánto
          le toca a cada uno no está definido-- está en la cabecera del archivo;
          quien está cargando un número no lo necesita para cargarlo.
        */}
        <p className="ol-editor__hint">
          Closed <b>{ytd}</b> this year with this Loan Officer. Takes effect on <b>{data.effectiveFrom}</b>, belongs
          to the <b>realtor</b> —not to the pair with this Loan Officer— and <b>does not project on its own</b>: what
          projects NPPM is the strategy&apos;s benchmark. Whether one should feed the other is still to be decided.
        </p>

        {error && <div className="bp-notice bp-notice--warn ol-editor__msg">{error}</div>}
        {saved && !error && <div className="bp-notice ol-editor__msg">{saved}</div>}

        {spellings.length > 1 && (
          <p className="ol-editor__hint">
            This realtor is stored under {spellings.length} different spellings ({spellings.join(' · ')}). The app
            treats them as the same person when reading.
          </p>
        )}

        <table className="piv ol-editor__tbl">
          <thead>
            <tr className="mo-row">
              <th className="lbl">Takes effect</th>
              <th className="bp-center">Value</th>
              <th className="bp-left">Who</th>
              <th className="bp-left">When</th>
              <th className="bp-left">Note</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.nppm_benchmark_key} className="metric">
                <td className="lbl">{r.effective_from}</td>
                <td className="bp-center">{Number(r.monthly_benchmark)}</td>
                <td className="bp-left">{r.set_by}</td>
                <td className="bp-left">{stamp(r.created_at)}</td>
                <td className="bp-left bp-history__note">{r.note ?? '—'}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td className="lbl bp-empty-cell" colSpan={5}>
                  Nobody has set this realtor&apos;s benchmark yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
