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
import type { LoanRecord } from '@/lib/domain/types';
import { loadCurrentReport } from '@/lib/supabase/loadCurrent';
import TabAnalytics from '@/app/pipeline/TabAnalytics';
import CommercialActivityTrends from '@/app/pipeline/CommercialActivityTrends';
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
  /**
   * Etapa ANALYTICS-CA-TRENDS-1 -- primera pieza que necesita distinguir
   * entre datos de Forecast (Closing, ya cargados arriba) y de Commercial
   * Activity (`LoanRecord[]`, ver comentario más abajo en el render: TODAVÍA
   * no se cargan en esta página). Selector local, sin persistir en URL --
   * mismo criterio que el resto de los toggles de esta pestaña.
   */
  const [analyticsView, setAnalyticsView] = useState<'closing' | 'commercialActivity'>('closing');

  /*
   * Etapa ANALYTICS-CA-TRENDS-2 -- estado PROPIO de esta página para
   * Commercial Activity, independiente del de Forecast de arriba. Mismos
   * 3 estados que ya usa `app/page.tsx` (records/isLoadingInitial/error),
   * sin compartir ningún hook -- son dos fetches separados a propósito
   * (ver comentario de cabecera: "cada ruta de nivel superior es
   * independiente").
   */
  const [caRecords, setCaRecords] = useState<LoanRecord[] | null>(null);
  const [caLoadingInitial, setCaLoadingInitial] = useState(true);
  const [caError, setCaError] = useState<string | null>(null);

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

  /*
   * Etapa ANALYTICS-CA-TRENDS-2 -- segundo fetch independiente, mismo
   * `loadCurrentReport()` que ya usa `app/page.tsx` (lib/supabase/
   * loadCurrent.ts), con su propio try/catch -- no comparte estado ni
   * cache con el efecto de Forecast de arriba. `null` (nadie subió nada /
   * Supabase no configurado) es un resultado válido, no un error --
   * mismo criterio que ya documenta `loadCurrentReport()` en su propio
   * archivo.
   */
  useEffect(() => {
    let cancelled = false;
    loadCurrentReport()
      .then((current) => {
        if (cancelled) return;
        if (current) setCaRecords(current.records);
      })
      .catch((err) => {
        if (cancelled) return;
        setCaError(errorMessage(err));
      })
      .finally(() => {
        if (cancelled) return;
        setCaLoadingInitial(false);
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
        <div className="seg">
          <button type="button" className={analyticsView === 'closing' ? 'on' : ''} onClick={() => setAnalyticsView('closing')}>
            Closing
          </button>
          <button
            type="button"
            className={analyticsView === 'commercialActivity' ? 'on' : ''}
            onClick={() => setAnalyticsView('commercialActivity')}
          >
            Commercial Activity
          </button>
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

      {data && analyticsView === 'closing' && <TabAnalytics resolvedLoans={data.resolvedLoans} />}

      {/*
       * Etapa ANALYTICS-CA-TRENDS-2 -- los 3 estados posibles de
       * `loadCurrentReport()`, mismo criterio que `app/page.tsx`: error real
       * (caError), "todavía no hay datos" (caRecords === null, después de
       * cargar), y datos reales (aunque sea un array vacío -- eso lo maneja
       * la tabla de CommercialActivityTrends con su propio "No records for
       * this strategy", no acá).
       */}
      {analyticsView === 'commercialActivity' && (
        <>
          {caError && <span className="pill warn">{caError}</span>}

          {caRecords === null && caLoadingInitial && !caError && (
            <div className="empty">
              <h2>Loading…</h2>
              <p>Looking for the last saved Commercial Activity report.</p>
            </div>
          )}

          {caRecords === null && !caLoadingInitial && !caError && (
            <div className="empty">
              <div className="drop-ic">
                <FileSheetIcon size={24} />
              </div>
              <h2>Todavía no hay datos de actividad</h2>
              <p>
                La actividad se sincroniza desde BigQuery cada vez que se sube Encompass por la app de cargas. Si esta
                pantalla sigue vacía después de una carga, avisá al equipo de datos: el que falló es el sync, no esta
                vista.
              </p>
            </div>
          )}

          {caRecords !== null && <CommercialActivityTrends records={caRecords} />}
        </>
      )}
    </div>
  );
}
