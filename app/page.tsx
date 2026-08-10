'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { read } from 'xlsx';
import { readWorkbook } from '@/lib/parsing/workbookReader';
import type { RawLoanRow, YearMonth } from '@/lib/parsing/types';
import { classifyLoan } from '@/lib/domain/classifyLoan';
import type { LoanRecord } from '@/lib/domain/types';
import { buildReportTree } from '@/lib/aggregation/buildReportTree';
import { buildLoanOfficerTree } from '@/lib/aggregation/buildLoanOfficerTree';
import { deriveMonthRange, ymLabel } from '@/lib/aggregation/months';
import type { Measure } from '@/lib/aggregation/types';
import { exportToExcel } from '@/lib/export/exportToExcel';
import { saveUpload } from '@/lib/supabase/saveUpload';
import { loadCurrentReport } from '@/lib/supabase/loadCurrent';
import { BRANCH_ORDER, type Branch } from '@/config/roster';
import { METRICS, type MetricKey } from '@/config/metrics';
import { UploadIcon, DownloadIcon, FileSheetIcon } from '@/components/ui/icons';
import SummaryCards from '@/components/report/SummaryCards';
import PivotTable from '@/components/report/PivotTable';
import LoanOfficerTable from '@/components/report/LoanOfficerTable';
import Toolbar from '@/components/report/Toolbar';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
 * Port de defaultCollapsed() del legacy: al cargar un archivo, los headers
 * de Total/Branch quedan expandidos, pero el desglose de Loan Officer/BD de
 * cada métrica de cada branch empieza colapsado -- mismo esquema de ids
 * ('br::'+branch+'::m::'+metric) que usa PivotTable para togglearlos.
 */
function defaultCollapsed(): Set<string> {
  const s = new Set<string>();
  for (const b of BRANCH_ORDER) {
    for (const { key } of METRICS) {
      s.add('br::' + b + '::m::' + key);
    }
  }
  return s;
}

export default function Home() {
  // Estado equivalente al bloque STATE del legacy.
  const [records, setRecords] = useState<LoanRecord[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [view, setView] = useState<'main' | 'b2b' | 'loanOfficer'>('main');
  // Etapa 12 (agregado): criterio de orden de la vista "Por Loan Officer" -- solo importa cuando view==='loanOfficer'.
  const [sortBy, setSortBy] = useState<MetricKey | 'total'>('total');
  const [measure, setMeasure] = useState<Measure>('count');
  const [year, setYear] = useState<'all' | string>('2026');
  const [start, setStart] = useState<YearMonth | null>(null);
  const [branchFilter, setBranchFilter] = useState<Branch | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsed());
  // No estaba en la lista de estado del brief; se agrega porque el criterio
  // de éxito 6 exige mostrar el error de readWorkbook sin crashear la página.
  const [error, setError] = useState<string | null>(null);
  // Indicador simple de "generando..." para el botón Descargar Excel (Etapa 9b).
  const [isExporting, setIsExporting] = useState(false);
  // Indicador de saveUpload() en curso (Etapa 11) -- no bloquea el render.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  // true mientras se consulta loadCurrentReport() al montar -- evita mostrar
  // el emptyState de "sube tu archivo" antes de saber si hay algo guardado.
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);

  // Deja el estado de filtros/colapso en su valor por defecto, tanto para un
  // archivo recién cargado como para el reporte restaurado desde Supabase.
  function applyLoadedReport(loanRecords: LoanRecord[], name: string) {
    setRecords(loanRecords);
    setFileName(name);
    setView('main');
    setSortBy('total');
    setMeasure('count');
    setYear('2026');
    setStart(null);
    setBranchFilter('all');
    setCollapsed(defaultCollapsed());
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

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = ev.target?.result;
        if (!(result instanceof ArrayBuffer)) throw new Error('No se pudo leer el archivo.');
        const workbook = read(new Uint8Array(result), { type: 'array' });
        const rawRows: RawLoanRow[] = readWorkbook(workbook);
        if (!rawRows.length) throw new Error('El archivo no tiene filas de datos');
        const loanRecords = rawRows.map(classifyLoan);

        applyLoadedReport(loanRecords, file.name);

        // Guardar en Supabase sin bloquear el render -- el reporte ya se ve
        // en pantalla independientemente de cómo salga esto.
        setSaveStatus('saving');
        saveUpload(loanRecords, rawRows, file.name)
          .then(() => setSaveStatus('saved'))
          .catch((err) => {
            console.error('saveUpload failed', err);
            setSaveStatus('error');
          });
      } catch (err) {
        setError(errorMessage(err));
        setRecords(null);
        setFileName(null);
      }
    };
    reader.onerror = () => setError('No se pudo leer el archivo.');
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

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

  // Port de collapseAll del legacy: colapsa 'total' y cada header de branch
  // (lo que también oculta sus metric-groups, sin necesidad de listarlos).
  // Etapa 12: en la vista "Por Loan Officer" no hay 'total' ni branches --
  // colapsa cada Loan Officer visible en su lugar (mismo esquema de id
  // 'lo::'+nombre que usa LoanOfficerTable).
  function handleCollapseAll() {
    const s = new Set<string>();
    if (view === 'loanOfficer') {
      if (loanOfficerTree) {
        for (const officer of loanOfficerTree.officers) s.add('lo::' + officer.name);
      }
    } else {
      s.add('total');
      for (const b of BRANCH_ORDER) s.add('br::' + b);
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
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsExporting(false);
    }
  }

  // Cálculos derivados del estado -- se recalculan en cada render, no son estado.
  const monthRange = records ? deriveMonthRange(records) : null;
  const allMonths = monthRange?.allMonths ?? [];
  const effectiveMonths = start ? allMonths.filter((ym) => ym >= start) : allMonths;
  const monthsShown = year === 'all' ? effectiveMonths : effectiveMonths.filter((ym) => ym.startsWith(year));

  const availableYears = [...new Set(allMonths.map((ym) => ym.split('-')[0]))];
  const availableBranches = records
    ? BRANCH_ORDER.filter((b) => records.some((r) => r.branch === b))
    : [];

  // Etapa 12: SummaryCards siempre necesita un ReportTree válido (tree.total.maps),
  // incluso en la vista "Por Loan Officer" -- ahí se le pasa 'main' como view
  // (no hay restricción B2B en esa vista) solo para ese propósito; PivotTable
  // no se renderiza con este tree cuando view==='loanOfficer' (ver JSX abajo).
  const tree = records
    ? buildReportTree({
        records,
        months: monthsShown,
        measure,
        view: view === 'loanOfficer' ? 'main' : view,
        branchFilter,
        drillBy: view === 'b2b' ? 'bd' : 'loanOfficer',
      })
    : null;

  // Etapa 12: vista "Por Loan Officer" -- cruza todos los branches, no usa
  // branchFilter ni el drillBy de arriba.
  const loanOfficerTree =
    records && view === 'loanOfficer' ? buildLoanOfficerTree({ records, months: monthsShown, measure }) : null;

  // Port de showTotal (BRANCHF==='all') del legacy: el nodo Total de
  // ReportTree existe siempre (no está filtrado por branch), así que hay
  // que ocultarlo explícitamente cuando hay un branch específico elegido.
  const showTotal = branchFilter === 'all';

  // Rótulo del KPI strip: describe qué vista/medida están activas.
  const kpiStripLabel =
    (view === 'b2b' ? 'Monthly Totals — B2B' : 'Monthly Totals') +
    (view === 'loanOfficer' ? ' (all branches)' : '') +
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
          {/* CTA de marca: la carga de archivo es la acción principal de la vista. */}
          <label className="btn cta" htmlFor="fileInput">
            <UploadIcon />
            Upload file
          </label>
          <input type="file" id="fileInput" accept=".xlsx,.xls" onChange={handleFileChange} />
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
      <div className="control-bar__status" style={{ marginBottom: '20px' }}>
        {records && fileName && (
          <>
            <span className="pill">File: {fileName}</span>
            <span className="pill">Rows: {records.length.toLocaleString('en-US')}</span>
            {monthRange?.minYM && monthRange?.maxYM && (
              <span className="pill">
                Range: {ymLabel(monthRange.minYM)} → {ymLabel(monthRange.maxYM)}
              </span>
            )}
          </>
        )}
        {saveStatus === 'saving' && <span className="pill">Saving to the cloud…</span>}
        {saveStatus === 'saved' && <span className="pill ok">Saved</span>}
        {saveStatus === 'error' && <span className="pill warn">Could not save to the cloud</span>}
        {error && <span className="pill warn">{error}</span>}
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
        <div id="emptyState" className="empty">
          <div className="drop-ic">
            <FileSheetIcon size={24} />
          </div>
          <h2>Upload your query file</h2>
          <p>
            Upload the <b>.xlsx</b> with the report columns (True OrgID, fileCreation, CreditReport, App_Date,
            loan_info_channel, milestones, loan_officer, B2B Loans, BD). Everything is computed in your browser — no data
            leaves your machine.
          </p>
          <label className="btn cta" htmlFor="fileInput" style={{ display: 'inline-flex' }}>
            <UploadIcon />
            Select file
          </label>
        </div>
      )}

      {records !== null && tree && (
        <div id="report">
          <div className="section-label">{kpiStripLabel}</div>
          <SummaryCards tree={tree} months={monthsShown} measure={measure} />

          <Toolbar
            view={view}
            onViewChange={setView}
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
          {view === 'loanOfficer' && loanOfficerTree ? (
            <LoanOfficerTable
              tree={loanOfficerTree}
              months={monthsShown}
              measure={measure}
              collapsed={collapsed}
              onToggleCollapse={handleToggleCollapse}
              sortBy={sortBy}
              onSortByChange={setSortBy}
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
                  view={view === 'b2b' ? 'b2b' : 'main'}
                />
              </div>
            </div>
          )}

          <div className="foot-note">
            <b>Closings:</b> the Funding date is used for Banked-Retail, or the Completion date for Brokered.{' '}
            <b>Branch:</b> <i>True OrgID</i> is used; OrgIDs outside the official roster are grouped under “Branch Out of
            Division”. Dates are read in UTC to avoid month drift.
          </div>
        </div>
      )}
    </div>
  );
}
