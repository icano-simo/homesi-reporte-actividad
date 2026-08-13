/**
 * ============================================================================
 * BUSINESS PLAN OS — contrato de datos
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 *
 * Tipos del esquema `org` (roster canónico) más las filas ya derivadas que
 * consumen las 3 pantallas. `org` es de SOLO LECTURA para la app: lo puebla y
 * lo mantiene quien administra la base, acá nunca se escribe.
 */

/* ─────────────────────────── Esquema `org` ─────────────────────────────── */

export interface DimBranch {
  branch_key: number;
  branch_code: string;
  is_division_branch: boolean;
  is_active: boolean;
  notes: string | null;
}

export interface DimEmployee {
  employee_key: number;
  full_name: string;
  email: string | null;
  nmls: string | null;
  tier: string | null;
  roster_status: string | null;
  role_raw: string | null;
  is_loan_officer: boolean;
  is_branch_manager: boolean;
  is_producing: boolean;
  staff_type: string | null;
  is_active: boolean;
}

/** Rol de una persona EN un branch. Una persona puede tener varias filas. */
export type RoleInBranch = 'LO' | 'BM' | 'BD' | 'BDR' | 'NPPM';

export interface EmployeeBranch {
  employee_key: number;
  branch_key: number;
  role_in_branch: RoleInBranch;
}

/**
 * De qué sistema viene un nombre crudo.
 *   roster      -> el canónico, el que se muestra en pantalla
 *   salesforce  -> pipeline_forecast.pipeline_loans / pipeline_resolved_loans
 *   slquery     -> activity_report.loan_records
 */
export type SourceSystem = 'roster' | 'salesforce' | 'slquery';

export interface EmployeeAlias {
  source_system: SourceSystem;
  name_raw: string;
  employee_key: number;
  match_method: string | null;
}

/* ─────────────────────── Filas derivadas para la UI ────────────────────── */

/**
 * Métricas de actividad de una persona. Vienen de Commercial Activity
 * (`activity_report.loan_records`, vía alias `slquery`).
 *
 * OJO CON LA ATRIBUCIÓN: son el total de la PERSONA, no de un branch. Un LO
 * puede tener producción en branches distintos al suyo -- el préstamo se
 * atribuye al branch del préstamo, no al branch asignado a la persona. Está
 * decidido así por el negocio; ver la nota en app/business-plan/branch/[code].
 */
export interface ActivityMetrics {
  /** Cierres por mes ('YYYY-MM' -> cantidad). */
  closingsByMonth: Record<string, number>;
  /** Promedio de cierres de los últimos 3 meses completos. */
  avgClosings3m: number;
  /** Credit Applications (App Date). */
  creditApplications: number;
  /** Pre-Approvals. Mapea a Credit Reports -- confirmado por el negocio. */
  preApprovals: number;
  /** Files Created. */
  filesCreated: number;
}

/** Presencia en Forecast (`pipeline_forecast`, vía alias `salesforce`). */
export interface PipelineMetrics {
  /** Préstamos abiertos del snapshot activo atribuidos a la persona. */
  openLoans: number;
  /** Cerrados (funded) históricos atribuidos a la persona. */
  resolvedFunded: number;
}

/**
 * Estado de triage.
 *
 * ⚠ `not_evaluable` es hoy el único estado que la app produce de verdad: el
 * motor de triage NO está implementado (sus reglas tienen contradicciones
 * abiertas, ver docs/ARQUITECTURA.md). Los otros tres existen para que el
 * lenguaje visual y los filtros estén construidos, y se activan cuando el
 * negocio cierre las fórmulas.
 */
export type TriageState = 'on_track' | 'need_attention' | 'on_risk' | 'not_evaluable';

/** Un Loan Officer, ya resuelto y con sus métricas. */
export interface LoanOfficerRow {
  employeeKey: number;
  /** Nombre canónico del roster. Es SIEMPRE lo que se muestra. */
  fullName: string;
  /** Branches donde la persona está asignada como LO. */
  branchCodes: string[];
  tier: string | null;
  rosterStatus: string | null;
  isBranchManager: boolean;
  isProducing: boolean;
  activity: ActivityMetrics;
  pipeline: PipelineMetrics;
  /** null mientras no exista `org.employee_benchmark` poblada. */
  monthlyBenchmark: number | null;
  /** avgClosings3m - benchmark. null si no hay benchmark. */
  gap: number | null;
  triage: TriageState;
}

/** Un branch con su resumen, para la Pantalla 1. */
export interface BranchRow {
  branchKey: number;
  branchCode: string;
  isDivisionBranch: boolean;
  /** Puede ser más de uno: el 716 tiene dos. Nunca asumir uno solo. */
  branchManagers: string[];
  loanOfficers: LoanOfficerRow[];
  totalLoanOfficers: number;
  atRiskCount: number;
  triage: TriageState;
}

/** Todo lo que las pantallas necesitan, ya resuelto. */
export interface BusinessPlanData {
  branches: BranchRow[];
  loanOfficers: LoanOfficerRow[];
  /** Diagnóstico de la resolución de alias -- se muestra en el pie de página. */
  diagnostics: {
    activityRowsRead: number;
    pipelineRowsRead: number;
    /** Nombres crudos ignorados por estar en `source_name_excluded`. */
    excludedNamesSeen: number;
    /** Filas cuyo loan officer venía vacío ('(blank)' del parser propio). */
    rowsWithoutOfficer: number;
    /** Nombres crudos sin alias NI exclusión: hay que revisarlos. */
    unmappedNames: { source: SourceSystem; nameRaw: string; rows: number }[];
    benchmarkTableAvailable: boolean;
    /** Los 3 meses completos usados para el promedio de cierres. */
    monthsUsedForAverage: string[];
  };
}
