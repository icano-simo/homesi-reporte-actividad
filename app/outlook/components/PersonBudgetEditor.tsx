'use client';

import Modal from '@/app/business-plan/components/Modal';
import type { OutlookData } from '@/lib/outlook/loadData';
import type { OutlookStrategy } from '@/lib/outlook/project';
import StrategyEditor, { type OutlookEditable } from './StrategyEditor';
import BudgetEditor, { type BudgetEditable } from './BudgetEditor';

/**
 * ============================================================================
 * UN SOLO BOTÓN, UNA SOLA PANTALLA — etapa OL26, corregido en OL26c
 * ============================================================================
 *
 * Hasta acá cada fila tenía hasta TRES controles que abrían tres cosas
 * distintas -- la píldora de Own Production, la de Recruitment y una tercera
 * para el presupuesto compuesto. Eso se unificó en un solo botón, "Set
 * budget" -- pero la primera versión lo abría detrás de PESTAÑAS (un selector
 * de estrategia arriba, cada una escondiendo a las demás), que es el mismo
 * problema con un nivel más: dos capas de pestañas, la de adentro (by month /
 * by rate, ya existía) y la de afuera, nueva.
 *
 * ⚠ SIN PESTAÑAS, TODO JUNTO. Cada estrategia que aplica (Own Production,
 * Recruitment si participa) se apila en su propia sección, seguida por el
 * presupuesto compuesto -- todo visible en una sola pantalla que se recorre,
 * no se navega. El contenido de cada sección es el mismo de siempre
 * (`StrategyEditor`, `BudgetEditor`), sin cambios de comportamiento: lo único
 * que cambia es que ya no compiten por el mismo espacio escondiéndose entre
 * sí.
 *
 * ⚠ UN REALTOR NPPM NO TIENE ESTRATEGIAS -- no decide por regla de
 * crecimiento, sólo tiene el presupuesto compuesto. Para ese sujeto
 * `strategies` llega vacío y `strategyEditable` en `null`: la pantalla es
 * directamente el presupuesto compuesto, sin secciones arriba.
 */
export default function PersonBudgetEditor({
  label,
  strategies,
  strategyEditable,
  budgetPerson,
  data,
  months,
  onClose,
  onSaved,
}: {
  label: string;
  /** Las estrategias con regla de crecimiento que aplican -- vacío para un realtor. */
  strategies: OutlookStrategy[];
  /** `null` cuando el sujeto no tiene regla de crecimiento (un realtor NPPM). */
  strategyEditable: OutlookEditable | null;
  budgetPerson: BudgetEditable;
  data: OutlookData;
  months?: string[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  return (
    <Modal title={`${label} — Set budget`} onClose={onClose}>
      <div className="ol-editor">
        {strategyEditable &&
          strategies.map((s) => (
            <section key={s} className="ol-editor__block">
              <h3 className="ol-editor__h">{s}</h3>
              <StrategyEditor lo={strategyEditable} strategy={s} data={data} months={months} onSaved={onSaved} />
            </section>
          ))}

        <section className="ol-editor__block">
          {strategies.length > 0 && <h3 className="ol-editor__h">Budget composition</h3>}
          <BudgetEditor person={budgetPerson} data={data} months={months} onSaved={onSaved} />
        </section>
      </div>
    </Modal>
  );
}
