'use client';

import { useState } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import type { Ramp } from '@/lib/outlook/recruitment';
import { saveRecruitRamp } from '@/lib/outlook/save';

/**
 * ============================================================================
 * LA RAMPA DE ARRANQUE — etapa OL20
 * ============================================================================
 *
 * 25% el primer mes, 50% el segundo, 100% desde el tercero. Es la curva con la
 * que alguien que entra llega a su producción esperada, y la decisión del
 * negocio es que sea UNA y sea la misma para todos.
 *
 * ⚠ ES GLOBAL Y EL PANEL LO DICE. Se abre desde la fila de un branch, así que
 * lo natural es leerlo como "la rampa de este branch"; no lo es. Cambiarla acá
 * mueve el presupuesto de los quince, en los diecisiete branches, y eso tiene
 * que estar escrito arriba del formulario y no en un tooltip.
 *
 * ⚠ SE GUARDAN LOS TRES PORCENTAJES EN UNA FILA, siempre los tres. Guardar sólo
 * el que cambió dejaría una revisión con dos valores y uno nulo, y quien la
 * lea después no sabría si el nulo es "no cambió" o "nadie lo fijó" -- la misma
 * ambigüedad que la etapa evita en el benchmark, donde sí es información.
 *
 * ⚠ Y NO SE EDITAN LOS MESES, sólo los porcentajes. Que la rampa dure tres
 * tramos --mes 1, mes 2, mes 3 en adelante-- está en `projectRecruit` y en el
 * esquema; ofrecer un cuarto tramo acá sería ofrecer algo que el modelo no sabe
 * calcular.
 */
export default function RecruitRampEditor({
  ramp,
  onClose,
  onSaved,
}: {
  ramp: Ramp;
  onClose: () => void;
  onSaved: () => void;
}) {
  /*
   * Los tres viven como TEXTO mientras se editan, y en por ciento y no en
   * fracción: el formulario habla en 25 porque la pantalla y el negocio hablan
   * en 25. La conversión a 0.25 pasa una sola vez, al guardar.
   */
  const [m1, setM1] = useState(pct(ramp.month1));
  const [m2, setM2] = useState(pct(ramp.month2));
  const [m3, setM3] = useState(pct(ramp.month3Plus));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nums = [m1, m2, m3].map((t) => (t.trim() === '' ? NaN : Number(t)));
  const invalido = nums.some((n) => !Number.isFinite(n) || n < 0 || n > 100);

  async function save() {
    if (invalido) {
      setError('Each percentage has to be a number between 0 and 100.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveRecruitRamp({
        month1: nums[0] / 100,
        month2: nums[1] / 100,
        month3Plus: nums[2] / 100,
        note: note.trim() === '' ? null : note.trim(),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Ramp-up for a new hire" onClose={onClose}>
      <div className="ol-editor">
        <p className="ol-editor__hint">
          How much of their monthly production a new hire is expected to do while they ramp up. This is{' '}
          <b>one curve for everyone</b> — changing it moves the budget of every person in hiring, in every branch.
        </p>

        <div className="ol-editor__row">
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="ramp-1">
              First month
            </label>
            <input
              id="ramp-1"
              type="text"
              inputMode="decimal"
              className="field ol-editor__num"
              value={m1}
              onChange={(e) => setM1(e.target.value)}
            />
          </div>
          <span className="ol-editor__pct">%</span>
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="ramp-2">
              Second month
            </label>
            <input
              id="ramp-2"
              type="text"
              inputMode="decimal"
              className="field ol-editor__num"
              value={m2}
              onChange={(e) => setM2(e.target.value)}
            />
          </div>
          <span className="ol-editor__pct">%</span>
          <div className="bp-form__field">
            <label className="bp-form__label" htmlFor="ramp-3">
              Third month onwards
            </label>
            <input
              id="ramp-3"
              type="text"
              inputMode="decimal"
              className="field ol-editor__num"
              value={m3}
              onChange={(e) => setM3(e.target.value)}
            />
          </div>
          <span className="ol-editor__pct">%</span>
        </div>

        <div className="ol-editor__row">
          <div className="bp-form__field ol-editor__grow">
            <label className="bp-form__label" htmlFor="ramp-note">
              Why (optional)
            </label>
            <input
              id="ramp-note"
              type="text"
              className="field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button type="button" className="bp-btn bp-btn--small" onClick={save} disabled={busy || invalido}>
            {busy ? '…' : 'Save'}
          </button>
        </div>

        {error && <div className="bp-notice bp-notice--warn ol-editor__msg">{error}</div>}
      </div>
    </Modal>
  );
}

/** 0.25 -> "25". Sin decimales cuando no hacen falta, que es siempre hoy. */
function pct(v: number): string {
  const n = v * 100;
  return String(Number.isInteger(n) ? n : Number(n.toFixed(2)));
}
