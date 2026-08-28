'use client';

/*
 * ⚠ Etapa V2b: acá había 5 imports más (`read` de xlsx, `readWorkbook`,
 * `classifyLoan`, `isHelocLien2`, `saveUpload`) que sostenían la carga manual
 * de archivo desde esta pantalla.
 *
 * Se quitó el ACCESO, no el código: los 4 módulos siguen intactos en el repo,
 * sin un solo cambio, por si el sync de BigQuery falla en los primeros días y
 * hay que volver. Revertir es revertir este commit -- no hay nada que
 * reescribir. Borrarlos de verdad es un cambio aparte, cuando esto lleve un
 * tiempo estable.
 */
import { useEffect, useState } from 'react';
import type { YearMonth } from '@/lib/parsing/types';
import type { LoanRecord } from '@/lib/domain/types';
import { buildReportTree } from '@/lib/aggregation/buildReportTree';
import { buildLoanOfficerTree } from '@/lib/aggregation/buildLoanOfficerTree';
import { deriveMonthRange, ymLabel } from '@/lib/aggregation/months';
import { loansForCell, type DrillDownContext } from '@/lib/aggregation/loansForCell';
import type { Measure } from '@/lib/aggregation/types';
import { exportToExcel } from '@/lib/export/exportToExcel';
import { loadCurrentReport } from '@/lib/supabase/loadCurrent';
import { BRANCH_ORDER, type Branch } from '@/config/roster';
import { METRICS, type MetricKey } from '@/config/metrics';
import { DownloadIcon, FileSheetIcon } from '@/components/ui/icons';
import SummaryCards from '@/components/report/SummaryCards';
import PivotTable from '@/components/report/PivotTable';
import LoanOfficerTable from '@/components/report/LoanOfficerTable';
import LoanDetailModal from '@/components/report/LoanDetailModal';
import Toolbar, { type GroupBy, type ChannelFilter } from '@/components/report/Toolbar';
import { matchesStrategy, strategyLabel, type StrategyFilter } from '@/lib/domain/strategy';

/**
 * ⚠ Cuándo se actualizó por última vez, en la zona de quien mira.
 *
 * Acá SÍ corresponde `new Date(...)`, al revés de lo que hace `monthOf()` en
 * loadCurrent.ts. No es la misma clase de dato: `synced_at` es un `timestamptz`
 * -- un INSTANTE, con offset incluido en el texto ('...T01:33:28.858+00:00') --
 * y convertirlo a la hora local es exactamente lo que se quiere. Las fechas de
 * `monthOf()` son días de calendario sin hora ni zona; ahí construir un Date
 * inventaría una medianoche UTC y correría el mes.
 *
 * Formato de 24 horas y día/mes/año, que es como lo lee la usuaria.
 */
function formatLastSync(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const fecha = at.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = at.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Actualizado el ${fecha} a las ${hora}`;
}

/**
 * Extrae un mensaje legible tanto de un Error nativo como de un error de
 * Supabase/PostgREST (un objeto plano {code,message,details,hint}, no una
 * instancia de Error) -- String(err) sobre ese objeto da '[object Object]'.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

/**
 * Todos los ids de nivel Metric ('br::'+branch+'::m::'+metric), uno por
 * combinación branch×métrica -- el mismo esquema que ya usa PivotTable para
 * togglear el desglose de Loan Officer/BD de cada metric group. Factorizado
 * para que defaultCollapsed() y handleCollapseAll() (más abajo) partan de la
 * MISMA enumeración -- antes handleCollapseAll() la omitía por completo, que
 * era la causa real de que reabrir un branch después de "Collapse all"
 * mostrara sus Metrics ya expandidas (con Loan Officers visibles): sus ids no
 * estaban en el Set, y "no está en el Set" se lee como "no colapsado" en
 * todo el árbol (ver PivotTable.tsx/PivotRow.tsx, ninguno de los dos se
 * tocó).
 */
function allMetricIds(): string[] {
  const ids: string[] = [];
  for (const b of BRANCH_ORDER) {
    for (const { key } of METRICS) {
      ids.push('br::' + b + '::m::' + key);
    }
  }
  return ids;
}

/**
 * Port de defaultCollapsed() del legacy: al cargar un archivo, los headers
 * de Total/Branch quedan expandidos, pero el desglose de Loan Officer/BD de
 * cada métrica de cada branch empieza colapsado -- mismo esquema de ids
 * ('br::'+branch+'::m::'+metric) que usa PivotTable para togglearlos.
 */
function defaultCollapsed(): Set<string> {
  return new Set(allMetricIds());
}

export default function Home() {
  // Estado equivalente al bloque STATE del legacy.
  const [records, setRecords] = useState<LoanRecord[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // Etapa 2 (refacción de filtros): reemplaza `view: 'main'|'b2b'|'loanOfficer'`
  // (excluyente) por 2 conceptos separados -- ver GroupBy/ChannelFilter en
  // Toolbar.tsx para el porqué. `groupBy` sigue siendo un modo de
  // presentación único a la vez (Branch×Metric o Loan Officer, igual que
  // antes); `strategyFilter`/`channelFilter` son filtros de datos independientes,
  // combinables entre sí y con cualquier groupBy.
  const [groupBy, setGroupBy] = useState<GroupBy>('branch');
  /*
   * Etapa V3: reemplaza al booleano `b2bOnly`. B2B era un interruptor aparte
   * cuando en realidad es una de cinco estrategias mutuamente excluyentes; el
   * selector lo pone en su lugar y de paso hace alcanzables las otras cuatro,
   * que antes no se podían aislar desde ninguna pantalla.
   */
  const [strategyFilter, setStrategyFilter] = useState<StrategyFilter>('all');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  // Etapa 12 (agregado): criterio de orden de la agrupación "Por Loan Officer" -- solo importa cuando groupBy==='loanOfficer'.
  const [sortBy, setSortBy] = useState<MetricKey | 'total'>('total');
  const [measure, setMeasure] = useState<Measure>('count');
  const [year, setYear] = useState<'all' | string>('2026');
  const [start, setStart] = useState<YearMonth | null>(null);
  const [branchFilter, setBranchFilter] = useState<Branch | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsed());
  // Drill-down (Fase 1): contexto de la celda clickeada, o null si el modal
  // está cerrado. Los loans se derivan de filteredRecords en cada render
  // (ver drillDownLoans más abajo) -- no se guarda una copia de la lista acá,
  // así que si el usuario cambia un filtro con el modal abierto, la lista se
  // actualiza sola en vez de quedar desincronizada de la tabla.
  const [drillDown, setDrillDown] = useState<DrillDownContext | null>(null);
  // No estaba en la lista de estado del brief; se agrega porque el criterio
  // de éxito 6 exige mostrar el error de readWorkbook sin crashear la página.
  const [error, setError] = useState<string | null>(null);
  // Indicador simple de "generando..." para el botón Descargar Excel (Etapa 9b).
  const [isExporting, setIsExporting] = useState(false);
  /*
   * Etapa V2b: `max(synced_at)` de loan_records_v2, tal como lo devuelve
   * loadCurrentReport. Reemplaza al indicador de guardado (`saveStatus`), que
   * describía una acción que esta pantalla ya no puede iniciar.
   *
   * Se llena dentro del efecto de montaje, nunca en el render del servidor.
   * Eso importa: `toLocaleDateString` da resultados distintos según la zona del
   * proceso, así que formatear esto durante el SSR produciría una fecha del
   * servidor y otra del navegador -- un mismatch de hidratación. Arrancando en
   * null, el servidor no pinta ninguna fecha.
   */
  const [lastSync, setLastSync] = useState<string | null>(null);
  // true mientras se consulta loadCurrentReport() al montar -- evita mostrar
  // el emptyState de "sube tu archivo" antes de saber si hay algo guardado.
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);

  // Deja el estado de filtros/colapso en su valor por defecto, tanto para un
  // archivo recién cargado como para el reporte restaurado desde Supabase.
  function applyLoadedReport(loanRecords: LoanRecord[], name: string) {
    setRecords(loanRecords);
    setFileName(name);
    setGroupBy('branch');
    setStrategyFilter('all');
    setChannelFilter('all');
    setSortBy('total');
    setMeasure('count');
    setYear('2026');
    setStart(null);
    setBranchFilter('all');
    setCollapsed(defaultCollapsed());
    setDrillDown(null);
    setError(null);
  }

  // Al montar: si nadie cargó un archivo en esta sesión, restaurar el último
  // reporte guardado en Supabase (is_current=true), si existe. No dispara
  // saveUpload() de nuevo -- esos datos ya están guardados.
  useEffect(() => {
    if (records !== null) return;
    let cancelled = false;
    loadCurrentReport()
      .then((current) => {
        if (cancelled || !current) return;
        applyLoadedReport(current.records, current.fileName);
        setLastSync(current.uploadedAt);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * ⚠ Etapa V2b: acá vivía `handleFileChange`, el lector del .xlsx que armaba
   * los LoanRecord con `classifyLoan` y los guardaba con `saveUpload`.
   *
   * Se fue con el botón que lo disparaba. Los 4 módulos que usaba siguen
   * intactos en lib/ -- ver el comentario de los imports arriba.
   */

  function handleToggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExpandAll() {
    setCollapsed(new Set());
  }

  // Port de collapseAll del legacy: colapsa 'total' y cada header de branch.
  // Etapa 12: en la vista "Por Loan Officer" no hay 'total' ni branches --
  // colapsa cada Loan Officer visible en su lugar (mismo esquema de id
  // 'lo::'+nombre que usa LoanOfficerTable).
  //
  // Fix (jerarquía de expansión): además de 'total' y cada branch, ahora
  // también agrega TODOS los ids de Metric (allMetricIds(), misma lista que
  // defaultCollapsed()) -- antes se omitían, así que después de "Collapse
  // all" el Set no tenía ninguna entrada de Metric, y al reabrir un branch
  // sus 4 Metrics aparecían ya expandidas (con el desglose de Loan
  // Officer/BD visible) en vez de colapsadas. Cada nivel (Branch, Metric)
  // sigue teniendo su propio id independiente -- esto no cambia esa
  // arquitectura, solo corrige qué ids quedan en el Set al colapsar todo.
  function handleCollapseAll() {
    const s = new Set<string>();
    if (groupBy === 'loanOfficer') {
      if (loanOfficerTree) {
        for (const officer of loanOfficerTree.officers) s.add('lo::' + officer.name);
      }
    } else {
      s.add('total');
      for (const b of BRANCH_ORDER) s.add('br::' + b);
      for (const id of allMetricIds()) s.add(id);
    }
    setCollapsed(s);
  }

  async function handleExportExcel() {
    if (!records) return;
    setIsExporting(true);
    try {
      await exportToExcel({
        records,
        months: monthsShown,
        measure,
        fileName: fileName ?? 'archivo',
        // Etapa V3: la primera hoja del libro pasa a ser la de la estrategia
        // elegida. Ver exportToExcel para qué hace con 'all'.
        strategyFilter,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsExporting(false);
    }
  }

  // Cálculos derivados del estado -- se recalculan en cada render, no son estado.
  // Etapa 2: monthRange/availableYears/availableBranches siguen derivándose de
  // `records` SIN filtrar (igual que antes de esta etapa, cuando `records` no
  // se filtraba por B2B tampoco para esto) -- los selectores de rango de
  // fecha/branch disponibles no dependen de qué filtros de datos estén
  // activos, mismo comportamiento preservado.
  const monthRange = records ? deriveMonthRange(records) : null;
  const allMonths = monthRange?.allMonths ?? [];
  const effectiveMonths = start ? allMonths.filter((ym) => ym >= start) : allMonths;
  const monthsShown = year === 'all' ? effectiveMonths : effectiveMonths.filter((ym) => ym.startsWith(year));

  const availableYears = [...new Set(allMonths.map((ym) => ym.split('-')[0]))];
  const availableBranches = records
    ? BRANCH_ORDER.filter((b) => records.some((r) => r.branch === b))
    : [];

  // Etapa 2: filtros de datos (B2B + Loan Info Channel) aplicados ACÁ, antes
  // de agregar -- ni buildReportTree ni buildLoanOfficerTree filtran nada
  // internamente, solo agregan lo que reciben (ver comentario en
  // buildReportTree.ts). Combinables entre sí y con cualquier groupBy.
  // Micro-etapa (Channel vacío como categoría): 'empty' es un sentinel de
  // ChannelFilter (Toolbar.tsx), no el valor real -- se traduce acá a
  // loanInfoChannel === '' sin normalizar el dato ni asignarlo a Banked ni a
  // Brokered. Decisión de negocio confirmada por Isabella: da visibilidad a
  // esos 7 loans, no los oculta ni los reclasifica.
  const filteredRecords = records
    ? records.filter(
        (r) =>
          matchesStrategy(r.strategy, strategyFilter) &&
          (channelFilter === 'all' ||
            (channelFilter === 'empty' ? r.loanInfoChannel === '' : r.loanInfoChannel === channelFilter)),
      )
    : null;


  /*
   * ⚠ Etapa V3: antes era `b2bOnly ? 'bd' : 'loanOfficer'`. La regla no cambia,
   * cambia de dónde sale: el desglose por BD tiene sentido SÓLO en B2B, porque
   * el Business Developer es quien define esa estrategia. En Affinity, NPPM,
   * Recruitment y Own Production el BD no es la dimensión que explica nada, así
   * que se desglosa por Loan Officer igual que con el filtro en "All".
   *
   * Es exactamente el comportamiento que tenía el toggle: 'B2B only' -> BD,
   * cualquier otra cosa -> Loan Officer.
   */
  const drillBy: 'loanOfficer' | 'bd' = strategyFilter === 'B2B' ? 'bd' : 'loanOfficer';

  // Etapa 12: SummaryCards siempre necesita un ReportTree válido
  // (tree.total.maps), incluso con groupBy==='loanOfficer' -- por eso `tree`
  // se calcula siempre a partir de filteredRecords, sin importar groupBy;
  // PivotTable no se renderiza con este tree cuando groupBy==='loanOfficer'
  // (ver JSX abajo), pero SummaryCards sí lo usa en los 2 casos. Etapa 2: a
  // diferencia de antes (donde la vista "Por Loan Officer" forzaba
  // view:'main', o sea SIN filtro B2B, porque B2B y Loan Officer eran
  // exclusivos), ahora si strategyFilter/channelFilter están activos SÍ se
  // reflejan acá también -- es la combinación nueva que esta etapa habilita
  // (B2B + Loan Officer + Channel, ver COMPATIBILIDAD caso 8).
  const tree = filteredRecords
    ? buildReportTree({
        records: filteredRecords,
        months: monthsShown,
        measure,
        branchFilter,
        drillBy,
      })
    : null;

  // Etapa 12: agrupación "Por Loan Officer" -- cruza todos los branches, no
  // usa branchFilter (sin cambios). Etapa 2: usa filteredRecords en vez de
  // records sin filtrar -- antes esta combinación (B2B/Channel + Loan
  // Officer) no existía, así que no hay comportamiento previo que preservar.
  const loanOfficerTree =
    filteredRecords && groupBy === 'loanOfficer'
      ? buildLoanOfficerTree({ records: filteredRecords, months: monthsShown, measure })
      : null;

  // Port de showTotal (BRANCHF==='all') del legacy: el nodo Total de
  // ReportTree existe siempre (no está filtrado por branch), así que hay
  // que ocultarlo explícitamente cuando hay un branch específico elegido.
  const showTotal = branchFilter === 'all';

  // Drill-down (Fase 1): loansForCell() filtra sobre filteredRecords -- los
  // mismos records que ya alimentaron tree/loanOfficerTree arriba, con
  // B2B/Channel ya aplicados. No se vuelve a evaluar ninguna regla de
  // negocio acá (ver lib/aggregation/loansForCell.ts).
  const drillDownLoans = drillDown && filteredRecords ? loansForCell(filteredRecords, drillDown) : [];

  // Rótulo del KPI strip: describe qué filtros/agrupación/medida están activos.
  // Micro-etapa (Channel vacío como categoría): 'empty' es sentinel de
  // ChannelFilter, no el label a mostrar -- ver CHANNEL_OPTIONS en
  // Toolbar.tsx para el texto real ('Empty / Unclassified').
  const channelFilterLabel = channelFilter === 'empty' ? 'Empty / Unclassified' : channelFilter;
  const kpiStripLabel =
    'Monthly Totals' +
    (strategyFilter !== 'all' ? ' — ' + strategyLabel(strategyFilter) : '') +
    (channelFilter !== 'all' ? ' — ' + channelFilterLabel : '') +
    (groupBy === 'loanOfficer' ? ' (all branches)' : '') +
    (measure === 'amount' ? ' — Volume ($)' : '');

  return (
    <div className="hub-container">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Commercial Activity Report</h1>
          <p className="page-head__subtitle">
            File Creations · Credit Reports · App Date · Closings — by branch, loan officer and B2B strategy
          </p>
        </div>
        <div className="control-group">
          {/*
            Etapa V2b: acá estaba el CTA "Upload file" con su <input type=file>.
            La fuente es `loan_records_v2`, que se sincroniza desde BigQuery
            cada vez que alguien sube Encompass por la app de cargas; dejar el
            botón invitaba a cargar un archivo que ya no es la fuente y que
            competiría con el sync.

            "Download Excel" queda solo en el grupo y conserva su estilo
            (`primary`, no `cta`): pasó a ser la única acción de la pantalla,
            pero eso no lo convierte en la acción de marca, y nadie pidió
            cambiarle el color.
          */}
          <button className="btn primary" disabled={!records || isExporting} onClick={handleExportExcel}>
            <DownloadIcon />
            {isExporting ? 'Generating…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {/*
       * Etapa UX1: se eliminaron 3 botones muertos que venían del HTML legado
       * ("Guardar", "Exportar JSON", "Importar JSON") -- los tres estaban
       * `disabled` y sin ningún handler desde la migración a Next. Ocupaban la
       * mitad de la barra superior sin hacer nada.
       */}
      {/*
        Etapa V2b: donde estaba el pill "Fuente: <archivo>" ahora va cuándo se
        actualizó el dato. Es la pregunta que reemplaza a "¿qué archivo estoy
        mirando?" cuando nadie carga archivos: lo único que la usuaria necesita
        saber del origen es si está fresco.

        Sigue siendo un pill y no un bloque de texto suelto: al lado quedan Rows
        y Range, y un párrafo entre dos pills se ve como algo que se cayó de
        lugar. La procedencia va debajo, en letra chica, porque es contexto que
        se lee una vez -- no un dato que se consulta.
      */}
      <div className="source-note" style={{ marginBottom: '20px' }}>
        <div className="control-bar__status">
          {lastSync && <span className="pill">{formatLastSync(lastSync)}</span>}
          {records && (
            <>
              <span className="pill">Rows: {records.length.toLocaleString('en-US')}</span>
              {monthRange?.minYM && monthRange?.maxYM && (
                <span className="pill">
                  Range: {ymLabel(monthRange.minYM)} → {ymLabel(monthRange.maxYM)}
                </span>
              )}
            </>
          )}
          {error && <span className="pill warn">{error}</span>}
        </div>
        {records && <p className="source-note__origin">Datos de Encompass y Salesforce, vía BigQuery</p>}
      </div>

      {records === null && isLoadingInitial && (
        <div className="empty">
          <div className="drop-ic">
            <FileSheetIcon size={24} />
          </div>
          <h2>Loading report…</h2>
          <p>Looking for the last saved report.</p>
        </div>
      )}

      {records === null && !isLoadingInitial && (
        /*
          Etapa V2b: este estado vacío pedía subir un .xlsx y ofrecía el botón.
          Ya no hay nada que la usuaria pueda hacer desde acá para llenarlo: si
          está vacío es porque el sync todavía no corrió o falló, y eso se
          arregla subiendo Encompass por la app de cargas, no en esta pantalla.
          El texto dice dónde mirar en vez de ofrecer una acción que no existe.
        */
        <div id="emptyState" className="empty">
          <div className="drop-ic">
            <FileSheetIcon size={24} />
          </div>
          <h2>Todavía no hay datos de actividad</h2>
          <p>
            La actividad se sincroniza desde BigQuery cada vez que se sube Encompass por la app de cargas. Si esta
            pantalla sigue vacía después de una carga, avisá al equipo de datos: el que falló es el sync, no este
            reporte.
          </p>
        </div>
      )}

      {records !== null && tree && (
        <div id="report">
          <div className="section-label">{kpiStripLabel}</div>
          {/*
           * Bug AC1: en la agrupación "Por Loan Officer" el filtro de Branch
           * queda oculto en el Toolbar (cruza todos los branches a propósito,
           * ver comentario de loanOfficerTree más abajo) pero branchFilter en
           * estado puede seguir apuntando a un branch de una agrupación
           * anterior. Se lo neutraliza acá para que las tarjetas no hereden un
           * filtro que en esta agrupación no está ni visible ni aplicado a la
           * tabla. Ajuste de merge con main (Etapa 2): main tenía este check
           * como `view === 'loanOfficer'`; `view` ya no existe en esta rama
           * (reemplazado por `groupBy`), mismo criterio.
           */}
          <SummaryCards
            tree={tree}
            months={monthsShown}
            measure={measure}
            branchFilter={groupBy === 'loanOfficer' ? 'all' : branchFilter}
          />

          <Toolbar
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            strategyFilter={strategyFilter}
            onStrategyFilterChange={setStrategyFilter}
            channelFilter={channelFilter}
            onChannelFilterChange={setChannelFilter}
            measure={measure}
            onMeasureChange={setMeasure}
            branchFilter={branchFilter}
            onBranchFilterChange={setBranchFilter}
            year={year}
            onYearChange={setYear}
            start={start}
            onStartChange={setStart}
            availableBranches={availableBranches}
            availableYears={availableYears}
            months={allMonths}
            onExpandAll={handleExpandAll}
            onCollapseAll={handleCollapseAll}
          />

          {/*
           * Cada tabla trae su propia tarjeta: LoanOfficerTable además tiene
           * controles propios (orden/búsqueda) que NO deben quedar dentro del
           * contenedor de scroll horizontal, así que arma su propio wrapper.
           * .tbl-scroll: si la tabla no entra, scrollea ELLA, nunca el body
           * (spec §6).
           */}
          {groupBy === 'loanOfficer' && loanOfficerTree ? (
            <LoanOfficerTable
              tree={loanOfficerTree}
              months={monthsShown}
              measure={measure}
              collapsed={collapsed}
              onToggleCollapse={handleToggleCollapse}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              onDrillDown={setDrillDown}
            />
          ) : (
            <div className="tbl-card">
              <div className="tbl-scroll">
                <PivotTable
                  tree={tree}
                  months={monthsShown}
                  measure={measure}
                  showTotal={showTotal}
                  collapsed={collapsed}
                  onToggleCollapse={handleToggleCollapse}
                  strategyFilter={strategyFilter}
                  onDrillDown={setDrillDown}
                />
              </div>
            </div>
          )}

          {/*
            Etapa V2: la frase "Dates are read in UTC to avoid month drift"
            describía cómo la app leía las fechas cuando venían del Excel. Ya no
            aplica: `loan_records_v2` las trae como `date` y el mes se toma
            recortando el texto 'YYYY-MM-DD', sin construir ningún Date -- que
            es JUSTAMENTE lo que evita el corrimiento (ver `monthOf()` en
            lib/supabase/loadCurrent.ts). El objetivo es el mismo; el mecanismo
            que la nota describía dejó de existir.
          */}
          <div className="foot-note">
            <b>Closings:</b> the Funding date is used for Banked-Retail, or the Completion date for Brokered.{' '}
            <b>Branch:</b> <i>True OrgID</i> is used; OrgIDs outside the official roster are grouped under “Branch Out of
            Division”. <b>Source:</b> the data is synced from BigQuery; each row is one loan, so the report always
            reflects the current state rather than a single upload.
          </div>
        </div>
      )}

      <LoanDetailModal
        isOpen={drillDown !== null}
        context={drillDown}
        loans={drillDownLoans}
        /*
         * Etapa V3: `drillDownLoans` ya sale de `filteredRecords`, así que el
         * modal muestra exactamente lo que contó la celda -- el filtro de
         * estrategia entra por el mismo camino que los de canal y branch. Esto
         * NO es para filtrar de nuevo: es para que el modal sepa qué columnas
         * valen la pena en cada caso (ver `showStrategy`/`showContext` allá).
         */
        strategyFilter={strategyFilter}
        onClose={() => setDrillDown(null)}
      />
    </div>
  );
}
