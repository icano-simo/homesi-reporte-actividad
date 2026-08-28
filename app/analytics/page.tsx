'use client';

// Next.js code-parte el CSS por ruta -- `TabAnalytics.tsx` depende de estas
// clases (.trend-chart, .pareto-bar, .avgticket-dot, .tbl-card, etc., ver
// app/pipeline/styles/forecast-visual.css) pero esa hoja solo se importaba
// en app/pipeline/page.tsx. Sin este import, esta ruta habría renderizado
// el mismo componente sin ningún estilo -- descubierto revisando qué
// clases usa TabAnalytics.tsx contra dónde están definidas, no asumido.
import '@/app/pipeline/styles/forecast-visual.css';
import { useEffect, useState } from 'react';
import type { PipelineLoan, ResolvedLoan } from '@/lib/pipeline/types';
import TabAnalytics from '@/app/pipeline/TabAnalytics';
import { FileSheetIcon } from '@/components/ui/icons';

/**
 * ============================================================================
 * ANALYTICS — pestaña de nivel superior — Etapa ANALYTICS-TAB-1
 * ============================================================================
 *
 * Antes era un sub-tab de Forecast & Pipeline (app/pipeline/page.tsx,
 * TabNavigation.tsx). Se independiza como ruta propia, siguiendo la Opción A
 * del diagnóstico previo (ver docs/ARQUITECTURA.md): fetch propio a
 * /api/pipeline/latest, mismo endpoint que ya usa Forecast, sin ningún
 * contexto/cache compartido -- cada ruta de nivel superior de esta app ya es
 * independiente (Commercial Activity, Business Plan), este módulo sigue el
 * mismo patrón en vez de inventar uno nuevo.
 *
 * `TabAnalytics.tsx` (app/pipeline/, sin mover -- ver decisión en
 * docs/ARQUITECTURA.md) ya era prácticamente standalone: un solo prop
 * (`resolvedLoans`), período propio, y ya llama a `useOrgRoster()`
 * INTERNAMENTE (línea ~1172 de ese archivo) -- esta página no necesita pedir
 * el roster de `org` por su cuenta, alcanza con pasarle los préstamos.
 *
 * Sin filtro de branch a nivel de esta página (a diferencia de Forecast, que
 * sí filtra `resolvedLoans` por `selectedBranch` antes de pasarlos) -- Opción
 * A del diagnóstico: mantenerlo simple, analiza el snapshot completo. Si
 * hiciera falta un filtro de branch acá más adelante, es una etapa aparte.
 *
 * Sin upload ni Topbar: esta página es de solo lectura sobre el snapshot ya
 * cargado (desde Forecast, o restaurado de Supabase) -- subir un archivo
 * nuevo sigue siendo exclusivo de /pipeline.
 */

interface LatestApiResponse {
  resolvedLoans: ResolvedLoan[];
  openLoans: PipelineLoan[];
  warnings: string[];
}

/** Mismo helper que ya existe (duplicado) en app/pipeline/page.tsx y las rutas server-side -- sin lib/ compartido para esto todavía. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

export default function AnalyticsPage() {
  const [data, setData] = useState<LatestApiResponse | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mismo patrón que el fetch inicial de app/pipeline/page.tsx -- un GET, sin
  // POST/upload acá (esta página no lo ofrece). {snapshot: null} (nadie subió
  // nada todavía) es un resultado válido, no un error -- se distingue de un
  // 500 real igual que en Forecast.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/pipeline/latest')
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body && body.error) {
          setError(String(body.error));
          return;
        }
        if (!body || !body.snapshot) return;
        setData({ resolvedLoans: body.resolvedLoans, openLoans: body.openLoans, warnings: body.warnings ?? [] });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingInitial(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="hub-container">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Analytics</h1>
        </div>
      </div>

      {error && <span className="pill warn">{error}</span>}

      {!data && isLoadingInitial && (
        <div className="empty">
          <h2>Loading…</h2>
          <p>Looking for the last saved Forecast snapshot.</p>
        </div>
      )}

      {!data && !isLoadingInitial && !error && (
        <div className="empty">
          <div className="drop-ic">
            <FileSheetIcon size={24} />
          </div>
          <h2>No Forecast data yet</h2>
          <p>Upload a pipeline report from Forecast &amp; Pipeline first -- Analytics reads the same saved snapshot.</p>
        </div>
      )}

      {data && <TabAnalytics resolvedLoans={data.resolvedLoans} />}
    </div>
  );
}
