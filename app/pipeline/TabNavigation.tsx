'use client';

import type { ReactNode } from 'react';
import { BuildingIcon, GridIcon, AlertTriangleIcon, BarChartIcon } from '@/components/ui/icons';

export type TabType = 'executive' | 'matrix' | 'adverse' | 'analytics';

export interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  adverseCount: number;
}

/**
 * Etapa UX1: los 3 tabs dejan de estar hardcodeados como 3 <button> casi
 * idénticos y pasan a una tabla de datos -- agregar un cuarto tab ahora es una
 * línea acá. `badge` decide si ese tab lleva un contador (hoy solo Adverse).
 */
interface TabDefinition {
  id: TabType;
  label: string;
  icon: ReactNode;
  badge?: 'adverseCount';
}

const TABS: TabDefinition[] = [
  // Etapa UX9: renombrado de "Executive Branch Forecast" -- el id
  // ('executive') no cambia, solo el texto visible del botón.
  { id: 'executive', label: 'Projected Forecast', icon: <BuildingIcon size={14} /> },
  // Etapa UX8: renombrado de "Milestone Pipeline Matrix" -- el id ('matrix')
  // no cambia (nada más depende de él), solo el texto visible del botón.
  { id: 'matrix', label: 'Pipeline by Milestone', icon: <GridIcon size={14} /> },
  // Etapa UX10: renombrado de "Adverse & Risk Loans" -- el id ('adverse') no
  // cambia. Motivo: la tabla solo filtra por status === 'adverse', no existe
  // ninguna noción de "riesgo" en el código; el rótulo viejo prometía algo
  // que no está.
  { id: 'adverse', label: 'Adverse Loans', icon: <AlertTriangleIcon size={14} />, badge: 'adverseCount' },
  // Etapa F7, Parte 1: selector de período + rankings de Loan Program/Loan
  // Type. Solo lectura sobre pipeline_resolved_loans, sin badge (no hay un
  // contador equivalente a adverseCount para este tab).
  { id: 'analytics', label: 'Analytics', icon: <BarChartIcon size={14} /> },
];

/**
 * Sub-navegación de Forecast (spec §4B): 3 pill tabs bajo el banner de KPIs.
 * Mismo comportamiento de F6d; cambia el tratamiento visual (pills del sistema
 * `.tab-btn`, iconos SVG en vez de texto pelado) y el contador de Adverse pasa
 * a un `.badge` en vez de una `.pill.warn` con estilos inline.
 */
export default function TabNavigation({ activeTab, onTabChange, adverseCount }: TabNavigationProps) {
  return (
    <nav className="tab-nav" aria-label="Forecast sections">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const showBadge = tab.badge === 'adverseCount' && adverseCount > 0;
        return (
          <button
            key={tab.id}
            type="button"
            className={'tab-btn' + (isActive ? ' active' : '')}
            onClick={() => onTabChange(tab.id)}
            aria-pressed={isActive}
          >
            {tab.icon}
            {tab.label}
            {showBadge && <span className="badge badge--rose">{adverseCount}</span>}
          </button>
        );
      })}
    </nav>
  );
}
