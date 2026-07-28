'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { read } from 'xlsx';
import { readWorkbook } from '@/lib/parsing/workbookReader';
import type { RawLoanRow, YearMonth } from '@/lib/parsing/types';
import { classifyLoan } from '@/lib/domain/classifyLoan';
import type { LoanRecord } from '@/lib/domain/types';
import { buildReportTree } from '@/lib/aggregation/buildReportTree';
import { deriveMonthRange, ymLabel } from '@/lib/aggregation/months';
import type { Measure } from '@/lib/aggregation/types';
import { exportToExcel } from '@/lib/export/exportToExcel';
import { saveUpload } from '@/lib/supabase/saveUpload';
import { loadCurrentReport } from '@/lib/supabase/loadCurrent';
import { BRANCH_ORDER, type Branch } from '@/config/roster';
import { METRICS } from '@/config/metrics';
import SummaryCards from '@/components/report/SummaryCards';
import PivotTable from '@/components/report/PivotTable';
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
  const [view, setView] = useState<'main' | 'b2b'>('main');
  const [measure, setMeasure] = useState<Measure>('count');
  const [year, setYear] = useState<'all' | string>('all');
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
    setMeasure('count');
    setYear('all');
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
  function handleCollapseAll() {
    const s = new Set<string>();
    s.add('total');
    for (const b of BRANCH_ORDER) s.add('br::' + b);
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

  const tree = records
    ? buildReportTree({
        records,
        months: monthsShown,
        measure,
        view,
        branchFilter,
        drillBy: view === 'b2b' ? 'bd' : 'loanOfficer',
      })
    : null;
  // Port de showTotal (BRANCHF==='all') del legacy: el nodo Total de
  // ReportTree existe siempre (no está filtrado por branch), así que hay
  // que ocultarlo explícitamente cuando hay un branch específico elegido.
  const showTotal = branchFilter === 'all';

  return (
    <div className="app">
      {/* Sidebar (decorativo, marca Homesí) */}
      <aside className="sidebar">
        <div className="logo">H</div>
        <div className="nav-ic">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <div className="nav-ic active">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M3 3v18h18" />
            <rect x="7" y="10" width="3" height="7" />
            <rect x="12" y="6" width="3" height="11" />
            <rect x="17" y="13" width="3" height="4" />
          </svg>
        </div>
        <div className="nav-ic">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M3 17l6-6 4 4 8-8" />
            <path d="M17 7h4v4" />
          </svg>
        </div>
        <div className="nav-ic">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M9 20V9" />
          </svg>
        </div>
        <div className="nav-ic">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" />
          </svg>
        </div>
        <div className="nav-ic">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M12 20l7-4V8l-7-4-7 4v8z" />
            <path d="M12 12l7-4M12 12v8M12 12L5 8" />
          </svg>
        </div>
        <div className="nav-ic" style={{ marginTop: "auto", marginBottom: "14px" }}>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 6 8.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.1a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
          </svg>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="toolbar-row">
            <span className="label-chip">Datos</span>
            <label className="btn primary" htmlFor="fileInput">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v12M7 8l5-5 5 5M5 21h14" />
              </svg>
              Cargar archivo
            </label>
            <input type="file" id="fileInput" accept=".xlsx,.xls" onChange={handleFileChange} />

            <span style={{ width: "1px", height: "26px", background: "var(--border)", margin: "0 4px" }}></span>

            <span style={{ flex: "1" }}></span>

            <button className="btn" id="btnSave" disabled title="Guarda el archivo cargado en este navegador (solo al abrir el HTML localmente)">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 3h11l4 4v14H5z" />
                <path d="M8 3v6h7M8 21v-6h8v6" />
              </svg>
              Guardar
            </button>
            <button className="btn ghost" id="btnExportJson" disabled>Exportar JSON</button>
            <label className="btn ghost" htmlFor="jsonInput">Importar JSON</label>
            <input type="file" id="jsonInput" accept=".json" />
            <button
              className="btn primary"
              id="btnExcel"
              disabled={!records || isExporting}
              onClick={handleExportExcel}
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M14 3v5h5" />
                <path d="M14 3H6v18h12V8z" />
                <path d="M9 13l3 4m0-4l-3 4" />
              </svg>
              {isExporting ? 'Generando…' : 'Descargar Excel'}
            </button>
          </div>
          <div className="loaded-row" id="loadedRow">
            {records && fileName && (
              <>
                <span className="pill">Archivo: {fileName}</span>
                <span className="pill">Filas: {records.length.toLocaleString('en-US')}</span>
                {monthRange?.minYM && monthRange?.maxYM && (
                  <span className="pill">
                    Rango: {ymLabel(monthRange.minYM)} → {ymLabel(monthRange.maxYM)}
                  </span>
                )}
              </>
            )}
            {saveStatus === 'saving' && <span className="pill">Guardando en la nube…</span>}
            {saveStatus === 'saved' && <span className="pill">Guardado</span>}
            {saveStatus === 'error' && <span className="pill warn">No se pudo guardar en la nube</span>}
            {error && <span className="pill warn">{error}</span>}
          </div>
        </div>

        <div className="content">
          <h1 className="title">Reporte de Actividad</h1>
          <div className="subtitle">File Creations · Credit Reports · Applications · Closings — por branch, loan officer y estrategia B2B</div>

          {records === null && isLoadingInitial && (
            <div className="empty">
              <div className="drop-ic">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M14 3v5h5" />
                  <path d="M14 3H6v18h12V8z" />
                  <path d="M9 15h6M9 11h6" />
                </svg>
              </div>
              <h2>Cargando reporte…</h2>
              <p>Buscando el último reporte guardado.</p>
            </div>
          )}

          {records === null && !isLoadingInitial && (
            <div id="emptyState" className="empty">
              <div className="drop-ic">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M14 3v5h5" />
                  <path d="M14 3H6v18h12V8z" />
                  <path d="M9 15h6M9 11h6" />
                </svg>
              </div>
              <h2>Carga tu archivo de query</h2>
              <p>Sube el <b>.xlsx</b> con las columnas del reporte (True OrgID, fileCreation, CreditReport, App_Date, loan_info_channel, milestones, loan_officer, B2B Loans, BD). La app calcula todo en tu navegador — nada sale de tu equipo.</p>
              <label className="btn primary" htmlFor="fileInput" style={{ display: "inline-flex" }}>Seleccionar archivo</label>
            </div>
          )}

          {records !== null && tree && (
            <div id="report">
              <div className="cards-wrap">
                <div className="cards-head">
                  {(view === 'b2b' ? 'Totales B2B por mes' : 'Totales por mes') +
                    (measure === 'amount' ? ' — Monto ($)' : '')}
                </div>
                <SummaryCards tree={tree} months={monthsShown} measure={measure} />
              </div>

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

              <div className="tbl-card">
                <PivotTable
                  tree={tree}
                  months={monthsShown}
                  measure={measure}
                  showTotal={showTotal}
                  collapsed={collapsed}
                  onToggleCollapse={handleToggleCollapse}
                  view={view}
                />
              </div>

              <div className="foot-note">
                <b>Closings:</b> se cuenta la fecha de Funding si el canal es Banked-Retail, o de Completion si es Brokered.{' '}
                <b>Branch:</b> se usa <i>True OrgID</i>; OrgIDs fuera del roster oficial se agrupan en “Branch Out of Division”.
                Las fechas se leen en UTC para evitar corrimiento de mes.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
