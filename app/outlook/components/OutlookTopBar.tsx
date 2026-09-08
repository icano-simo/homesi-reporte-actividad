'use client';

import { useState } from 'react';
import { useOutlookDataContext } from '@/lib/outlook/useOutlookData';
import RecruitEditor, { branchOptions } from '@/app/outlook/components/RecruitEditor';
import { horizonOptions } from '@/lib/outlook/horizon';

/**
 * ============================================================================
 * LA BARRA DEL MÓDULO — etapa OL22, ARCHIVO NUEVO
 * ============================================================================
 *
 * Dos controles que son de TODO Outlook y vivían dentro de una pantalla:
 *
 *   Project through   estaba en el estado de la vista de cada branch, así que
 *                     elegirlo en el 747 no cambiaba nada en el 733 y había que
 *                     repetir la selección trece veces. Un horizonte distinto
 *                     por branch no significa nada: el presupuesto es de la
 *                     división.
 *   Recruitment       el alta a mano estaba en la vista de un branch y sólo en
 *                     los que ya tenían gente en proceso -- en el 747 sí y en el
 *                     724 no. Un alta todavía no tiene branch, así que vivir
 *                     dentro de uno la hacía parecer de ese branch.
 *
 * ⚠ VA EN EL `layout.tsx`, que envuelve a las dos rutas y NO se desmonta al
 * navegar entre ellas. Por eso la selección del horizonte sobrevive a ir de la
 * lista a un branch: si la barra viviera en cada página, volvería al valor por
 * defecto en cada navegación.
 *
 * ⚠ Y EL BOTÓN DICE EL ESTADO, no sólo su nombre:
 *
 *     Recruitment · 15 in process · 0 with target
 *
 * Las quince personas están repartidas en cuatro branches y hasta OL22 no había
 * forma de saber que existían sin recorrerlos uno por uno. El segundo número es
 * el que importa: dice de un vistazo que ninguna tiene benchmark todavía, así
 * que el presupuesto de reclutamiento vale cero -- que es un estado correcto y
 * no un bug, pero hay que poder verlo sin entrar a ningún lado.
 */
export default function OutlookTopBar() {
  const { data, horizonMonths, setHorizonMonths, reload } = useOutlookDataContext();
  const [panel, setPanel] = useState<'new' | null>(null);

  /* Sin datos no hay nada que rotular: la barra no se dibuja hasta que cargan. */
  if (!data) return null;

  const opciones = horizonOptions(data.currentMonth);
  const enProceso = data.diagnostics.recruitsRead;
  const conBenchmark = data.diagnostics.recruitsWithBenchmark;

  return (
    <div className="ol-topbar">
      <label className="ol-topbar__field">
        <span className="ol-topbar__lbl">Project through</span>
        <select
          className="field"
          value={horizonMonths ?? ''}
          onChange={(e) => setHorizonMonths(e.target.value === '' ? null : Number(e.target.value))}
          title="Applies to every branch: the budget is the division's, not one branch's."
        >
          {opciones.map((o) => (
            <option key={o.label} value={o.months ?? ''}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {/*
        ══════════════════════════════════════════════════════════════════════
        UN SOLO BOTON — etapa OL24
        ══════════════════════════════════════════════════════════════════════

        OL23 puso una barra con cuatro cosas: dos insignias, el boton y la
        pildora de la rampa. Eran cuatro controles del mismo rango para una sola
        decision, y la rampa --que es global a la division-- competia con el alta
        de UNA persona como si fueran del mismo nivel.

        Queda un boton, y se lleva el contador: `15 in process` no se pierde
        porque es lo unico que dice que esas quince personas existen sin entrar a
        recorrer los cuatro branches donde viven.

        La rampa se fue ADENTRO del modal. Ver la advertencia que la acompania
        alla: sigue siendo global, y eso hay que decirlo donde se la edita.
      */}
      {data.diagnostics.recruitTablesAvailable && (
        <button
          type="button"
          className="ol-btn-coral"
          onClick={() => setPanel('new')}
          title={
            `${enProceso} people are in the hiring process across every branch, and ${conBenchmark} of them ` +
            `have a monthly production set. Without a target a person adds nothing to the budget — empty is ` +
            `not zero: it means nobody has decided yet. Opens the simulator, where the ramp-up curve is set too.`
          }
        >
          + Add hiring projection
          <span className="ol-btn-coral__count">
            {' · '}
            {enProceso} in process
          </span>
        </button>
      )}

      {/*
        El editor de rampa suelto se fue: la rampa se configura dentro del alta
        -- etapa OL24. Un panel menos que abrir para una decision que casi
        siempre se toma junto con la otra.
      */}

      {panel === 'new' && (
        <RecruitEditor
          recruit={null}
          branches={branchOptions(data.branches.map((b) => b.branchCode))}
          /* En un alta no hay a quien vincular todavia: la fila no existe. */
          roster={[]}
          currentMonth={data.currentMonth}
          ramp={data.recruitRamp}
          recruitCount={enProceso}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

/* `rampaTexto` se fue: la pildora segmentada de OL23 dibuja los tres tramos
   como elementos propios, asi que ya no hay una cadena que armar. */
