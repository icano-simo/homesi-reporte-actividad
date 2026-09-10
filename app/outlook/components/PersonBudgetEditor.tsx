'use client';

import { useState } from 'react';
import Modal from '@/app/business-plan/components/Modal';
import type { OutlookData } from '@/lib/outlook/loadData';
import type { OutlookStrategy } from '@/lib/outlook/project';
import StrategyEditor, { type OutlookEditable } from './StrategyEditor';
import BudgetEditor, { type BudgetEditable } from './BudgetEditor';

/**
 * ============================================================================
 * UN SOLO BOTÓN, UN SOLO EDITOR — etapa OL26
 * ============================================================================
 *
 * Hasta acá cada fila tenía hasta TRES controles que abrían tres cosas
 * distintas: la píldora de Own Production, la de Recruitment (si participaba)
 * y una tercera nueva para el presupuesto compuesto del punto 5. Uno solo
 * hacía lo que ya hacía otro -- las dos primeras son la MISMA decisión, "la
 * regla de esta persona en esta estrategia", con dos estrategias posibles-- y
 * el tercero era un control aparte para algo que en realidad es OTRA PESTAÑA
 * de la misma pregunta: cómo se le fija el presupuesto a esta persona.
 *
 * Un solo botón, rotulado "Set budget" siempre -- nunca el texto dinámico de
 * la regla vigente, que es lo que hacía que el mismo control dijera "25% /
 * qtr" en una fila y "by month" en la de al lado. Adentro, un selector de
 * ESTRATEGIA (Own Production, Recruitment si participa) más una pestaña de
 * Budget composition -- el punto 5. Cada pestaña es el contenido que ya
 * existía (`StrategyEditor`, `BudgetEditor`), sin cambios de comportamiento:
 * lo que cambia es que ahora comparten UN diálogo en vez de abrir cada uno el
 * suyo.
 *
 * ⚠ UN REALTOR NPPM NO TIENE ESTRATEGIAS -- no decide por regla de
 * crecimiento, sólo tiene el presupuesto compuesto. Para ese sujeto
 * `strategies` llega vacío y `strategyEditable` en `null`: no hay selector
 * que mostrar, se abre directo en Budget composition.
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
  type Tab = OutlookStrategy | 'composition';
  const [tab, setTab] = useState<Tab>(strategies[0] ?? 'composition');

  return (
    <Modal title={`${label} — Set budget`} onClose={onClose}>
      {strategies.length > 0 && (
        <div className="ol-persontabs">
          <div className="ol-modes" role="radiogroup" aria-label="What to set">
            {[...strategies, 'composition' as const].map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tab === t}
                className={'ol-mode' + (tab === t ? ' is-on' : '')}
                onClick={() => setTab(t)}
              >
                <span className="ol-mode__name">{t === 'composition' ? 'Budget composition' : t}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab !== 'composition' && strategyEditable && (
        <StrategyEditor lo={strategyEditable} strategy={tab} data={data} months={months} onSaved={onSaved} />
      )}
      {tab === 'composition' && <BudgetEditor person={budgetPerson} data={data} months={months} onSaved={onSaved} />}
    </Modal>
  );
}
