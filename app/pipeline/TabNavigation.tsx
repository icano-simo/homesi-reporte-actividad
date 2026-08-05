'use client';

export type TabType = 'executive' | 'matrix' | 'adverse';

export interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  adverseCount: number;
}

/**
 * Etapa F6d: shell de navegación por tabs del rediseño de Forecast -- solo
 * los 3 botones, sin el contenido de cada tab todavía (eso es F6e/F6f/F6g).
 * Usa .tab-nav/.tab-btn/.tab-btn.active (forecast-visual.css, agregadas en
 * F6a) y .pill.warn (legacy-components.css, ya existía) para el contador de
 * Adverse -- ningún CSS nuevo en esta etapa. Componente aislado todavía:
 * page.tsx no lo importa (eso es F6h).
 */
export default function TabNavigation({ activeTab, onTabChange, adverseCount }: TabNavigationProps) {
  return (
    <nav className="tab-nav">
      <button className={`tab-btn ${activeTab === 'executive' ? 'active' : ''}`} onClick={() => onTabChange('executive')}>
        Executive Branch Forecast
      </button>
      <button className={`tab-btn ${activeTab === 'matrix' ? 'active' : ''}`} onClick={() => onTabChange('matrix')}>
        Milestone Pipeline Matrix
      </button>
      <button className={`tab-btn ${activeTab === 'adverse' ? 'active' : ''}`} onClick={() => onTabChange('adverse')}>
        Adverse & Risk Loans
        {adverseCount > 0 && (
          <span className="pill warn" style={{ fontSize: '10px', padding: '2px 8px', marginLeft: '2px' }}>
            {adverseCount}
          </span>
        )}
      </button>
    </nav>
  );
}
