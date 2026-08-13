'use client';

import type { ReactNode } from 'react';
import { BuildingIcon, GridIcon, AlertTriangleIcon } from '@/components/ui/icons';

export type TabType = 'executive' | 'matrix' | 'adverse';

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
  { id: 'executive', label: 'Executive Branch Forecast', icon: <BuildingIcon size={14} /> },
  // Etapa UX8: renombrado de "Milestone Pipeline Matrix" -- el id ('matrix')
  // no cambia (nada más depende de él), solo el texto visible del botón.
  { id: 'matrix', label: 'Pipeline by Milestone', icon: <GridIcon size={14} /> },
  { id: 'adverse', label: 'Adverse & Risk Loans', icon: <AlertTriangleIcon size={14} />, badge: 'adverseCount' },
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
