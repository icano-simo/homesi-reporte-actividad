import type { RateSettings } from './rates';

/**
 * ============================================================================
 * BUSINESS PLAN OS — contrato de datos
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 * Etapa BP5 — el triage dejó de estar pendiente: `TriageState` (que sólo sabía
 *             decir "no evaluable") se reemplazó por el veredicto real, con sus
 *             dos qualifiers. Ver `lib/business-plan/qualifiers.ts`.
 *
 * Tipos del esquema `org` (roster canónico), del esquema `business_plan`
 * (propio del módulo) y de las filas ya derivadas que consumen las pantallas.
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

/**
 * EXCEPCIÓN DE ATRIBUCIÓN — `org.attribution_override`.
 *
 * Etapa BP3.
 *
 * La regla general es que un préstamo se atribuye al branch DEL PRÉSTAMO
 * (`loan_records.branch` / `pipeline_loans.branch`), no al branch asignado a la
 * persona. Esta tabla es la lista, confirmada por el negocio, de las personas
 * cuya producción se fuerza a un branch sin importar lo que digan las fuentes.
 *
 * La tabla existe para que la excepción SEA VISIBLE: si esto viviera en un `if`
 * dentro del código, sumar una persona nueva sería un deploy, y nadie sabría
 * mirando la base que la excepción existe. Acá es un INSERT, y el módulo la
 * muestra en su panel de diagnóstico.
 */
export interface AttributionOverride {
  employee_key: number;
  /** Branch al que se fuerza TODA la producción de esa persona. */
  force_branch_key: number;
  reason: string | null;
  confirmed_by: string | null;
  confirmed_on: string | null;
}

/** Fila de `org.employee_benchmark`. Versionada: cada cambio inserta una. */
export interface EmployeeBenchmark {
  employee_key: number;
  monthly_benchmark: number;
  effective_from: string;
  set_by: string;
  set_at: string;
  /** Por qué se fijó ese número. Columna agregada en BP7. */
  note: string | null;
}

/* ──────────────────────── Esquema `business_plan` ──────────────────────── */

export type InterventionStatus = 'reviewed' | 'active' | 'closed';

export interface InterventionRow {
  id: number;
  employee_key: number;
  status: InterventionStatus;
  funnel_key: number | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  activated_at: string | null;
  activated_by: string | null;
  notes: string | null;
  created_at: string;
}

/* ────────────────────────── Pipeline y actividad ───────────────────────── */

export type MilestoneBucket = 'Started' | 'Processing' | 'Underwriting' | 'Closing';

/**
 * Un préstamo de Commercial Activity, a nivel fila.
 *
 * Etapa BP9. Hace falta para los modales de detalle: hasta ahora el módulo
 * sólo guardaba conteos por mes.
 *
 * ⚠ `loan_records` NO tiene nombre de prestatario: el export de Commercial
 * Activity no lo trae. El NÚMERO de préstamo sí (está en REQUIRED_COLUMNS);
 * en BP9 se reportó lo contrario por error y se corrigió en BP11.
 */
export interface ActivityLoan {
  /** Etapa BP11: está en REQUIRED_COLUMNS, siempre viene en el archivo. */
  loanNumber: string | null;
  branch: string | null;
  amount: number;
  /** Nulos en los lotes cargados antes de BP9; ver `saveUpload.ts`. */
  loanProgram: string | null;
  loanFolderName: string | null;
  channel: string | null;
}

/** Un préstamo ya resuelto (funded) del snapshot activo. */
export interface ResolvedLoan {
  sourceLoanId: string | null;
  borrowerName: string | null;
  amount: number | null;
  loanFolder: string | null;
  disbursementDate: string | null;
  estClosingDate: string | null;
}

/** Un préstamo abierto del snapshot activo, ya atribuido a una persona. */
export interface OpenLoan {
  sourceLoanId: string | null;
  borrowerName: string | null;
  milestone: MilestoneBucket;
  /** Milestone crudo de Salesforce. Distingue Clear To Close de Closing. */
  rawMilestone: string | null;
  healthy: boolean;
  channel: string | null;
  closeMonth: string | null;
  estClosingDate: string | null;
  amount: number | null;
  milestoneDate: string | null;
  branch: string | null;
}

/**
 * Métricas de actividad de una persona. Vienen de Commercial Activity
 * (`activity_report.loan_records`, vía alias `slquery`).
 *
 * OJO CON LA ATRIBUCIÓN: son el total de la PERSONA, no de un branch. Un Loan
 * Officer puede tener producción en branches distintos al suyo -- el préstamo
 * se atribuye al branch del préstamo, no al branch asignado a la persona.
 */
export interface ActivityMetrics {
  /** Cierres por mes ('YYYY-MM' -> cantidad). */
  closingsByMonth: Record<string, number>;
  /** Ídem para las tres métricas del Qualifier 2. */
  filesByMonth: Record<string, number>;
  creditReportsByMonth: Record<string, number>;
  applicationsByMonth: Record<string, number>;
  /**
   * Filas, no conteos: es lo que consumen los modales de detalle. Se guardan
   * sólo los cierres por mes (para las barras del gráfico) y las tres métricas
   * del mes en curso (para las tarjetas del Qualifier 2) -- guardar el año
   * entero de las tres multiplicaría la memoria sin que nada lo use.
   */
  closingsRowsByMonth: Record<string, ActivityLoan[]>;
  currentMonthFiles: ActivityLoan[];
  currentMonthCreditReports: ActivityLoan[];
  currentMonthApplications: ActivityLoan[];
  /** Totales del lote activo, para las tablas. */
  creditApplications: number;
  preApprovals: number;
  filesCreated: number;
}

/** Presencia en Forecast (`pipeline_forecast`, vía alias `salesforce`). */
export interface PipelineMetrics {
  openLoans: number;
  resolvedFunded: number;
}

/* ─────────────────────────── Qualifiers ────────────────────────────────── */

/**
 * Aporte de un canal a la proyección del mes.
 *
 * Etapa BP7: la proyección combina DOS modelos distintos -- Banked va por
 * cascada de milestone sobre los healthy, Brokered por tasa plana sobre el
 * total. Un número que suma los dos es imposible de explicar si no se puede
 * abrir, así que cada canal reporta por separado cuántos préstamos aporta y
 * cuánto proyecta.
 */
export interface ChannelBreakdown {
  /** Préstamos del canal que entran al cálculo (cierran este mes). */
  loans: number;
  /** Cuánto de la proyección aporta este canal. */
  projected: number;
}

export interface CurrentMonthProjection {
  closedToDate: number;
  totalPipeline: number;
  healthyPipeline: number;
  inCtc: number;
  inClosing: number;
  /** Aporte de los healthy que NO están en CTC/Closing, ya con su tasa. */
  projectedFromHealthy: number;
  /** cerrados + CTC + Closing + aporte con tasa. Es un pronóstico, no un conteo. */
  projectedTotal: number;
  byMilestone: Record<MilestoneBucket, number>;
  banked: ChannelBreakdown;
  brokered: ChannelBreakdown;
}

export interface Qualifier1 {
  /** Los 3 meses de la ventana; el último es el actual, proyectado. */
  windowMonths: string[];
  avgWithCurrent: number;
  /** null si la persona no tiene benchmark cargado. */
  gap: number | null;
  state: 'on_target' | 'on_risk' | 'need_attention' | null;
  passes: boolean | null;
}

export interface Qualifier2Metric {
  key: 'fileCreations' | 'creditReports' | 'applications';
  label: string;
  rate: number;
  required: number;
  actual: number;
  /** Promedio de los 3 meses cerrados: lo que esa persona suele producir. */
  trailingAvg: number;
  meets: boolean;
}

export interface Qualifier2 {
  metrics: Qualifier2Metric[];
  belowCount: number;
  passes: boolean | null;
}

export type Verdict = 'on_track' | 'watch' | 'on_risk' | 'not_evaluable';

/* ─────────────────────── Filas derivadas para la UI ────────────────────── */

export interface LoanOfficerRow {
  employeeKey: number;
  /** Nombre canónico del roster. Es SIEMPRE lo que se muestra. */
  fullName: string;
  /**
   * Branches bajo los que se lista a la persona. Normalmente sus asignaciones
   * con rol LO; si tiene fila en `org.attribution_override`, el branch forzado.
   */
  branchCodes: string[];
  attributionOverride: { forcedBranchCode: string; reason: string | null } | null;
  tier: string | null;
  rosterStatus: string | null;
  isBranchManager: boolean;
  isProducing: boolean;

  activity: ActivityMetrics;
  pipeline: PipelineMetrics;
  openLoanDetail: OpenLoan[];
  /** Los funded del snapshot; el modal de Forecast Total los marca como cerrados. */
  resolvedLoanDetail: ResolvedLoan[];

  /** null mientras la persona no tenga fila en `org.employee_benchmark`. */
  monthlyBenchmark: number | null;
  benchmarkSetBy: string | null;
  benchmarkEffectiveFrom: string | null;
  benchmarkNote: string | null;
  /**
   * TODAS las versiones del benchmark de la persona, en orden cronológico.
   * La tabla es append-only, así que esto es el registro completo de cómo se
   * fue moviendo su objetivo y quién lo movió.
   */
  benchmarkHistory: EmployeeBenchmark[];

  projection: CurrentMonthProjection;
  /** Promedio de los 3 meses CERRADOS. Contexto: no entra en el GAP. */
  avgClosedMonths: number;
  /**
   * Promedio mensual de las tres métricas de actividad sobre los 3 meses
   * cerrados.
   *
   * Etapa BP17. Vive acá y no dentro de `q2` porque el directorio del branch
   * las muestra SIEMPRE, y `q2.metrics` queda vacío cuando la persona no tiene
   * benchmark -- la tabla se quedaría sin números por una razón que no tiene
   * nada que ver con su actividad.
   */
  trailingActivityAvg: { fileCreations: number; creditReports: number; applications: number };
  /** Cierres del año en curso. */
  ytdClosings: number;
  q1: Qualifier1;
  q2: Qualifier2;
  verdict: Verdict;
  intervention: InterventionRow | null;
  /**
   * Resumen del plan activo, si tiene uno.
   *
   * Etapa BP15. Viaja con cada Loan Officer para que el perfil y las listas
   * puedan mostrarlo sin una consulta aparte por persona -- son pocos
   * enrolamientos y ya se leen enteros para el Status de intervención.
   *
   * `null` significa "no tiene plan activo", que es distinto de "no se pudo
   * leer": eso último se refleja en `diagnostics.enrollmentTableAvailable`.
   */
  activePlan: ActivePlanSummary | null;
}

export interface ActivePlanSummary {
  enrollmentKey: number;
  funnelKey: number;
  /** Nombre copiado al activar, no el actual de la plantilla. */
  funnelName: string;
  activatedAt: string;
  doneMilestones: number;
  totalMilestones: number;
}

/**
 * Estado de INTERVENCIÓN de un branch — etapa BP5.
 *
 * Ya no mide rendimiento. Un branch con gente en riesgo y gente bien no tiene
 * un rendimiento único, así que promediarlo no significaba nada. Ahora responde
 * una pregunta operativa: ¿los que están en riesgo ya están atendidos?
 */
export type BranchStatus = 'no_risk' | 'handled' | 'reviewed' | 'pending';

export interface BranchRow {
  branchKey: number;
  branchCode: string;
  isDivisionBranch: boolean;
  branchManagers: string[];
  loanOfficers: LoanOfficerRow[];
  totalLoanOfficers: number;
  atRiskCount: number;
  status: BranchStatus;
  /** Cuántos en riesgo siguen sin revisar ni plan. Alimenta "Pendiente (N)". */
  pendingCount: number;
  /** Suma de los promedios de sus Loan Officers, misma ventana que el Q1. */
  avgClosings3m: number;
}

export interface BusinessPlanData {
  branches: BranchRow[];
  loanOfficers: LoanOfficerRow[];
  diagnostics: {
    activityRowsRead: number;
    pipelineRowsRead: number;
    excludedNamesSeen: number;
    rowsWithoutOfficer: number;
    unmappedNames: { source: SourceSystem; nameRaw: string; rows: number }[];
    benchmarkTableAvailable: boolean;
    /** Los 3 meses de la ventana del Qualifier 1 (el último, proyectado). */
    windowMonths: string[];
    /** Los 3 meses cerrados del promedio de contexto. */
    closedMonths: string[];
    attributionOverrides: { fullName: string; forcedBranchCode: string; reason: string | null }[];
    attributionOverrideTableAvailable: boolean;
    /** false = las tasas salen de los defaults del código, no de la base. */
    settingsTableAvailable: boolean;
    /**
     * Las tasas REALMENTE usadas en esta corrida. La nota de cálculo las lee de
     * acá y no de los defaults del código: si alguien edita una en Settings, la
     * nota al pie tiene que mostrar la que se aplicó, no la de fábrica.
     */
    rates: RateSettings;
    /**
     * Personas con rol LO en un branch de división pero `is_active = false`.
     * Se excluyen del módulo entero; se cuentan acá para que un cambio de
     * roster que saque a media división no pase inadvertido.
     */
    inactiveExcluded: number;
    interventionTableAvailable: boolean;
    /** false = las tablas de funnels todavía no están aplicadas. */
    enrollmentTableAvailable: boolean;
  };
}
