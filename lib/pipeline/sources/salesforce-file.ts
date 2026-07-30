import { read, utils } from 'xlsx';
import type { PipelineLoan, ResolvedLoan } from '../types';

// ============================================================
// Config
// ============================================================

/** Columnas que deben existir en cualquiera de los dos formatos. */
const REQUIRED_COLUMNS = [
  'Branch',
  'Loan Channel',
  'Opportunity Name',
  'Healthiness',
  'Current Milestone',
  'Amount',
  'Loan Officers',
  'Stage',
  'Est. Closing Date',
  'Loan Folder',
  'Current Milestone Date',
  'Branch Transfer',
] as const;

/** Current Milestone (Stage=Negotiation) -> bucket de PipelineLoan.milestone. */
const MILESTONE_BUCKET: Record<string, PipelineLoan['milestone']> = {
  Started: 'Started',
  Processing: 'Processing',
  Submittal: 'Underwriting',
  'Initial Decision': 'Underwriting',
  Resubmittal: 'Underwriting',
  'Clear To Close': 'Closing',
  Closing: 'Closing',
};

/** Valores conocidos de Loan Folder -- solo para no generar warning de ruido; nunca decide clasificación. */
const KNOWN_LOAN_FOLDERS = new Set([
  'Brokered',
  'Current Prospects',
  'Funded',
  'My Pipeline',
  'Underwriting',
  'Adverse Loans',
]);

const MONTH_NAME_TO_NUM: Record<string, string> = {
  January: '01',
  February: '02',
  March: '03',
  April: '04',
  May: '05',
  June: '06',
  July: '07',
  August: '08',
  September: '09',
  October: '10',
  November: '11',
  December: '12',
};

// ============================================================
// Helpers de bajo nivel
// ============================================================

/**
 * Los headers de Salesforce Report Builder (Formato A) traen un indicador
 * de orden (↑/↓) pegado al nombre de columna, p.ej. "Branch  ↑". .trim()
 * NO lo saca porque no es whitespace -- hay que quitarlo explícitamente
 * antes de matchear nombres de columna.
 */
function normalizeHeaderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[↑↓]/g, '')
    .trim();
}

function findHeaderRowIndex(aoa: unknown[][], searchLimit = 25): number {
  const limit = Math.min(searchLimit, aoa.length);
  for (let i = 0; i < limit; i++) {
    const row = aoa[i];
    if (!row) continue;
    if (row.map(normalizeHeaderCell).includes('Opportunity Name')) return i;
  }
  throw new Error(
    'No se encontró la fila de encabezado (columna "Opportunity Name") en las primeras ' + searchLimit + ' filas.'
  );
}

/**
 * Formato A si la palabra literal "Subtotal" aparece en alguna celda de las
 * primeras 20 filas; si no, Formato B.
 */
function detectFormat(aoa: unknown[][]): 'A' | 'B' {
  const limit = Math.min(20, aoa.length);
  for (let i = 0; i < limit; i++) {
    const row = aoa[i];
    if (!row) continue;
    for (const cell of row) {
      if (typeof cell === 'string' && cell.trim() === 'Subtotal') return 'A';
    }
  }
  return 'B';
}

function resolveColumnIndexes(headerRow: unknown[]): Record<string, number> {
  const normalized = headerRow.map(normalizeHeaderCell);
  const idx: Record<string, number> = {};
  for (const col of REQUIRED_COLUMNS) idx[col] = normalized.indexOf(col);
  idx['Close Month'] = normalized.indexOf('Close Month'); // solo existe en Formato A
  idx['Disbursement Date'] = normalized.indexOf('Disbursement Date'); // Etapa F4e -- no en reportes viejos, ver fallback en classifyRow

  const missing = REQUIRED_COLUMNS.filter((col) => idx[col] === -1);
  if (missing.length) {
    throw new Error('Faltan columnas requeridas en el archivo: ' + missing.join(', '));
  }
  return idx;
}

/** Excel serial number o string de fecha ("M/D/YYYY", ISO, etc.) -> Date en UTC. */
function parseDateCell(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const ms = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    return new Date(ms);
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function toYearMonth(date: Date | null): string | null {
  if (!date) return null;
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
}

function toISODate(date: Date | null): string | null {
  if (!date) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/** "July 2026" -> "2026-07". null si no matchea el patrón. */
function parseCloseMonthLabel(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const num = MONTH_NAME_TO_NUM[m[1]];
  if (!num) return null;
  return m[2] + '-' + num;
}

function classifyHealthy(rawHealthiness: string): boolean {
  const v = rawHealthiness.trim();
  return v === 'On Track' || v === '';
}

function extractSourceLoanId(opportunityName: string, warnings: string[]): string {
  const match = opportunityName.match(/(\d{9,})$/);
  if (match) return match[1];
  warnings.push(
    'No se pudo extraer sourceLoanId de "Opportunity Name" con la regex esperada; se usó el nombre completo: "' +
      opportunityName +
      '"'
  );
  return opportunityName;
}

/**
 * Etapa F4d: "Opportunity Name" trae "Nombre del prestatario - id" (verificado
 * contra los 2 archivos reales: 796/796 filas matchean este patrón). Se
 * separa el texto antes de " - <mismo id que ya extrae extractSourceLoanId>".
 * Si no matchea, se usa el nombre completo y se deja warning -- no se
 * inventa un nombre parcial.
 */
function extractBorrowerName(opportunityName: string, warnings: string[], sourceLoanId: string): string {
  const match = opportunityName.match(/^(.*?)\s*-\s*\d{9,}$/);
  if (match && match[1].trim()) return match[1].trim();
  warnings.push(
    'Loan ' +
      sourceLoanId +
      ': no se pudo separar el nombre del prestatario de "Opportunity Name" ("' +
      opportunityName +
      '"); se usó el nombre completo.'
  );
  return opportunityName;
}

/** "Branch Transfer" viene como boolean nativo en Formato A y como '0'/'1' en Formato B -- se normaliza acá. */
function parseBranchTransfer(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true';
  }
  return false;
}

// ============================================================
// Fila intermedia común a los dos formatos
// ============================================================

interface RawRow {
  branch: string;
  channel: string;
  opportunityName: string;
  healthiness: string;
  currentMilestone: string;
  amount: number;
  loanOfficers: string;
  stage: string;
  estClosingDateRaw: unknown;
  loanFolder: string;
  /** Solo Formato A -- el valor crudo de la columna "Close Month" (forward-filled). */
  closeMonthRaw: unknown;
  /** Etapa F4d. */
  milestoneDateRaw: unknown;
  branchTransferRaw: unknown;
  /** Etapa F4e -- undefined si el archivo no trae la columna (reportes viejos). */
  disbursementDateRaw: unknown;
}

function readAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

/**
 * Formato A: Branch / Close Month / Loan Channel solo vienen en la primera
 * fila de cada grupo -> forward-fill. Filas "Subtotal" (y la fila "Count"
 * que las sigue inmediatamente) se descartan explícitamente; además, el
 * chequeo de "Opportunity Name es texto" (no null, no número, no
 * "Subtotal") vuelve a filtrar cualquier fila de agregación que se cuele.
 */
function extractRowsFormatA(aoa: unknown[][], idx: Record<string, number>, headerRowIdx: number): RawRow[] {
  const rows: RawRow[] = [];
  let curBranch: unknown = null;
  let curCloseMonth: unknown = null;
  let curChannel: unknown = null;

  let i = headerRowIdx + 1;
  while (i < aoa.length) {
    const row = aoa[i];
    if (!row || !row.length) {
      i++;
      continue;
    }

    const isSubtotalRow = row.some((c) => typeof c === 'string' && c.trim() === 'Subtotal');
    if (isSubtotalRow) {
      i += 2; // descarta la fila Subtotal y la fila Count que la sigue
      continue;
    }

    if (row[idx['Branch']] !== null && row[idx['Branch']] !== undefined) curBranch = row[idx['Branch']];
    if (row[idx['Close Month']] !== null && row[idx['Close Month']] !== undefined) curCloseMonth = row[idx['Close Month']];
    if (row[idx['Loan Channel']] !== null && row[idx['Loan Channel']] !== undefined) curChannel = row[idx['Loan Channel']];

    const opp = row[idx['Opportunity Name']];
    const isRealLoanRow = typeof opp === 'string' && opp.trim() !== '' && opp.trim() !== 'Subtotal';
    if (isRealLoanRow) {
      rows.push({
        branch: String(curBranch ?? ''),
        channel: String(curChannel ?? ''),
        opportunityName: (opp as string).trim(),
        healthiness: String(row[idx['Healthiness']] ?? ''),
        currentMilestone: String(row[idx['Current Milestone']] ?? ''),
        amount: readAmount(row[idx['Amount']]),
        loanOfficers: String(row[idx['Loan Officers']] ?? ''),
        stage: String(row[idx['Stage']] ?? ''),
        estClosingDateRaw: row[idx['Est. Closing Date']],
        loanFolder: String(row[idx['Loan Folder']] ?? ''),
        closeMonthRaw: curCloseMonth,
        milestoneDateRaw: row[idx['Current Milestone Date']],
        branchTransferRaw: row[idx['Branch Transfer']],
        disbursementDateRaw: row[idx['Disbursement Date']],
      });
    }
    i++;
  }
  return rows;
}

/** Formato B: cada fila es un préstamo completo, sin forward-fill ni subtotales. */
function extractRowsFormatB(aoa: unknown[][], idx: Record<string, number>, headerRowIdx: number): RawRow[] {
  const rows: RawRow[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || !row.length) continue;
    const opp = row[idx['Opportunity Name']];
    if (typeof opp !== 'string' || opp.trim() === '') continue;

    rows.push({
      branch: String(row[idx['Branch']] ?? ''),
      channel: String(row[idx['Loan Channel']] ?? ''),
      opportunityName: opp.trim(),
      healthiness: String(row[idx['Healthiness']] ?? ''),
      currentMilestone: String(row[idx['Current Milestone']] ?? ''),
      amount: readAmount(row[idx['Amount']]),
      loanOfficers: String(row[idx['Loan Officers']] ?? ''),
      stage: String(row[idx['Stage']] ?? ''),
      estClosingDateRaw: row[idx['Est. Closing Date']],
      loanFolder: String(row[idx['Loan Folder']] ?? ''),
      closeMonthRaw: undefined,
      milestoneDateRaw: row[idx['Current Milestone Date']],
      branchTransferRaw: row[idx['Branch Transfer']],
      disbursementDateRaw: row[idx['Disbursement Date']],
    });
  }
  return rows;
}

/**
 * Formato A: si hay "Close Month" forward-filled, se usa esa ("July 2026"
 * -> "2026-07"). Formato B no tiene esa columna -- y si Formato A la trajera
 * vacía por algún motivo -- se deriva de "Est. Closing Date".
 */
function deriveCloseMonth(row: RawRow, warnings: string[], sourceLoanId: string): string {
  if (row.closeMonthRaw !== undefined && row.closeMonthRaw !== null) {
    const label = String(row.closeMonthRaw).trim();
    const parsed = parseCloseMonthLabel(label);
    if (parsed) return parsed;
    warnings.push('Loan ' + sourceLoanId + ': no se pudo interpretar Close Month "' + label + '".');
  }
  const ym = toYearMonth(parseDateCell(row.estClosingDateRaw));
  if (ym) return ym;
  warnings.push('Loan ' + sourceLoanId + ': no se pudo derivar closeMonth (sin Close Month ni Est. Closing Date válida); quedó vacío.');
  return '';
}

// ============================================================
// Clasificación por Stage (Loan Folder NUNCA decide esto)
// ============================================================

function classifyRow(
  row: RawRow,
  warnings: string[]
): { openLoan?: PipelineLoan; resolvedLoan?: ResolvedLoan } {
  const sourceLoanId = extractSourceLoanId(row.opportunityName, warnings);
  const borrowerName = extractBorrowerName(row.opportunityName, warnings, sourceLoanId);
  const milestoneDate = toISODate(parseDateCell(row.milestoneDateRaw));
  const branchTransferred = parseBranchTransfer(row.branchTransferRaw);

  if (row.loanFolder && !KNOWN_LOAN_FOLDERS.has(row.loanFolder)) {
    warnings.push(
      'Loan ' + sourceLoanId + ': Loan Folder inesperado "' + row.loanFolder + '" (no afecta la clasificación, que siempre la da Stage).'
    );
  }

  if (row.channel !== 'Banked - Retail' && row.channel !== 'Brokered') {
    warnings.push('Loan ' + sourceLoanId + ': Loan Channel desconocido "' + row.channel + '" -- fila descartada.');
    return {};
  }
  // Seguro: recién se validó arriba que row.channel es uno de los 2 valores de la unión.
  const channel = row.channel as PipelineLoan['channel'];

  if (row.stage === 'Negotiation') {
    const bucket = MILESTONE_BUCKET[row.currentMilestone.trim()];
    if (!bucket) {
      warnings.push(
        'Loan ' + sourceLoanId + ': Current Milestone desconocido "' + row.currentMilestone + '" con Stage=Negotiation -- no se contó en ningún bucket.'
      );
      return {};
    }
    const openLoan: PipelineLoan = {
      sourceLoanId,
      branch: row.branch,
      channel,
      milestone: bucket,
      healthy: classifyHealthy(row.healthiness),
      closeMonth: deriveCloseMonth(row, warnings, sourceLoanId),
      amount: row.amount,
      loanOfficer: row.loanOfficers,
      rawMilestone: row.currentMilestone,
      rawHealthiness: row.healthiness,
      estClosingDate: toISODate(parseDateCell(row.estClosingDateRaw)),
      borrowerName,
      milestoneDate,
      branchTransferred,
    };
    return { openLoan };
  }

  if (row.stage === 'Closed Won' || row.stage === 'Closed Lost') {
    const resolvedLoan: ResolvedLoan = {
      sourceLoanId,
      branch: row.branch,
      channel,
      status: row.stage === 'Closed Won' ? 'funded' : 'adverse',
      disbursementDate:
        toISODate(parseDateCell(row.disbursementDateRaw)) ?? toISODate(parseDateCell(row.estClosingDateRaw)) ?? '',
      amount: row.amount,
      loanOfficer: row.loanOfficers,
      borrowerName,
      milestoneDate,
      branchTransferred,
    };
    return { resolvedLoan };
  }

  warnings.push('Loan ' + sourceLoanId + ': Stage desconocido "' + row.stage + '" -- fila descartada.');
  return {};
}

// ============================================================
// Entry point
// ============================================================

/**
 * Parsea el reporte de pipeline de Salesforce (Formato A "agrupado" con
 * Report Builder, o Formato B "plano" tipo Printable View -- se detecta
 * solo). No calcula forecast ni toca aggregate.ts: solo produce
 * PipelineLoan[]/ResolvedLoan[] a partir del buffer del archivo.
 */
export function parseSalesforcePipelineFile(buffer: Buffer): {
  openLoans: PipelineLoan[];
  resolvedLoans: ResolvedLoan[];
  warnings: string[];
  formatDetected: 'A' | 'B';
} {
  const warnings: string[] = [];
  const workbook = read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const aoa = utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    blankrows: false,
  });

  const formatDetected = detectFormat(aoa);
  const headerRowIdx = findHeaderRowIndex(aoa);
  const idx = resolveColumnIndexes(aoa[headerRowIdx]);

  if (idx['Disbursement Date'] === -1) {
    warnings.push(
      'Disbursement Date no disponible en este archivo, usando Est. Closing Date como aproximación -- fecha menos precisa.'
    );
  }

  const rawRows =
    formatDetected === 'A' ? extractRowsFormatA(aoa, idx, headerRowIdx) : extractRowsFormatB(aoa, idx, headerRowIdx);

  const openLoans: PipelineLoan[] = [];
  const resolvedLoans: ResolvedLoan[] = [];

  for (const row of rawRows) {
    const { openLoan, resolvedLoan } = classifyRow(row, warnings);
    if (openLoan) openLoans.push(openLoan);
    if (resolvedLoan) resolvedLoans.push(resolvedLoan);
  }

  return { openLoans, resolvedLoans, warnings, formatDetected };
}
