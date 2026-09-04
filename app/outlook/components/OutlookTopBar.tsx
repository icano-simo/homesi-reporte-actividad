'use client';

import { useState } from 'react';
import { useOutlookDataContext } from '@/lib/outlook/useOutlookData';
import RecruitEditor, { branchOptions } from '@/app/outlook/components/RecruitEditor';
import RecruitRampEditor from '@/app/outlook/components/RecruitRampEditor';
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
  const [panel, setPanel] = useState<'ramp' | 'new' | null>(null);

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
        ⚠ SÓLO SI HAY DÓNDE GUARDAR. Igual que `monthlyModeAvailable` con el modo
        mes a mes: sin las tres tablas de OL20 aplicadas, alguien llenaría el
        formulario para descubrir al apretar Guardar que no hay tabla.
      */}
      {data.diagnostics.recruitTablesAvailable && (
        <div className="ol-topbar__field">
          <button
            type="button"
            className="ol-pill"
            onClick={() => setPanel('new')}
            title={
              `${enProceso} people are in the hiring process across every branch, and ${conBenchmark} of them have ` +
              `a monthly production set. Without a target a person adds nothing to the budget — empty is not zero: ` +
              `it means nobody has decided yet. Opens the simulator to add someone or set their numbers.`
            }
          >
            Recruitment
            <span className="ol-topbar__count">
              {' · '}
              {enProceso} in process{' · '}
              {conBenchmark} with target
            </span>
          </button>
          <button
            type="button"
            className="ol-pill ol-pill--empty"
            onClick={() => setPanel('ramp')}
            title="The ramp-up curve for a new hire. One curve for everyone, in every branch."
          >
            ramp {rampaTexto(data.recruitRamp)}
          </button>
        </div>
      )}

      {panel === 'ramp' && (
        <RecruitRampEditor
          ramp={data.recruitRamp}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            void reload();
          }}
        />
      )}

      {panel === 'new' && (
        <RecruitEditor
          recruit={null}
          branches={branchOptions(data.branches.map((b) => b.branchCode))}
          /* En un alta no hay a quien vincular todavia: la fila no existe. */
          roster={[]}
          currentMonth={data.currentMonth}
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

/** `25% · 50% · 100%`, leído de la revisión vigente y no escrito a mano. */
function rampaTexto(r: { month1: number; month2: number; month3Plus: number }): string {
  const p = (v: number) => Math.round(v * 100) + '%';
  return `${p(r.month1)} · ${p(r.month2)} · ${p(r.month3Plus)}`;
}
