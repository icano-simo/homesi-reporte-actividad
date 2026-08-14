import { getSupabaseClient } from '@/lib/supabase/client';
import { buildAliasIndex, buildExcludedIndex } from './aliasIndex';
import { lastCompleteMonths, currentWindowMonths, currentYearMonth } from './months';
import { combineVerdict, evaluateQualifier1, evaluateQualifier2, projectCurrentMonth } from './qualifiers';
import { DEFAULT_RATES, toRateSettings, type RateKey, type RateSettings } from './rates';
import { branchStatus } from './intervention';
import type {
  ActivePlanSummary,
  ActivityLoan,
  ActivityMetrics,
  AttributionOverride,
  BranchRow,
  BusinessPlanData,
  DimBranch,
  DimEmployee,
  EmployeeAlias,
  EmployeeBenchmark,
  EmployeeBranch,
  InterventionRow,
  LoanOfficerRow,
  MilestoneBucket,
  OpenLoan,
  PipelineMetrics,
  ResolvedLoan,
  SourceSystem,
} from './types';

/**
 * ============================================================================
 * CARGA Y RESOLUCIÓN DE DATOS DEL MÓDULO
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO. Ampliado en BP5 con el motor de veredicto.
 *
 * Todo corre en el navegador con la sesión del usuario, igual que el resto de
 * la app: `org` y `business_plan` tienen RLS por el claim `commercial_activity`.
 * No hay API routes ni service_role acá.
 *
 * ---------------------------------------------------------------------------
 * ⚠ CUADRATURA CON FORECAST — ESTO NO ES UN BUG
 * ---------------------------------------------------------------------------
 * La suma de las proyecciones de los Loan Officers de un branch NO va a
 * coincidir con el forecast de ese branch en Forecast & Pipeline. Alguien lo va
 * a reportar como error; no lo es.
 *
 * Son dos atribuciones distintas sobre los mismos préstamos:
 *   - Forecast atribuye por el branch DEL PRÉSTAMO (`pipeline_loans.branch`).
 *   - Business Plan atribuye por PERSONA, y hay gente con producción repartida
 *     en varios branches (Gian Laino tiene préstamos en 747, 716, 710 y 707).
 *
 * Además la proyección de una persona es un PRONÓSTICO, no un conteo: puede dar
 * 2.4 y está bien. No se redondea ni se reparte proporcionalmente para que
 * "cierre" -- redondear inventaría precisión y el reparto proporcional
 * inventaría una atribución que el negocio no pidió.
 */

/** PostgREST corta en 1000 filas por respuesta; hay que paginar explícitamente. */
const PAGE_SIZE = 1000;

/** Cuántos meses entran en cada ventana (2 cerrados + el actual proyectado). */
const WINDOW_MONTHS = 3;

/**
 * Centinela que produce NUESTRO propio parser, no un nombre de la fuente:
 * `classifyLoan()` normaliza un loan officer vacío a '(blank)'.
 *
 * Se reconoce explícitamente para no listarlo como "nombre sin clasificar" --
 * nadie va a agregar '(blank)' a `org.employee_alias`, y dejarlo en el
 * diagnóstico enterraría los nombres que sí hay que revisar.
 */
const BLANK_OFFICER = '(blank)';

interface ActivityRow {
  loan_officer: string | null;
  file_creation_month: string | null;
  credit_report_month: string | null;
  app_date_month: string | null;
  closing_month: string | null;
  branch: string | null;
  total_loan_amount: number | string | null;
  loan_number: string | null;
  /* Etapa BP9. NULL en los lotes cargados antes de que se persistieran. */
  loan_program: string | null;
  loan_folder_name: string | null;
  loan_info_channel_raw: string | null;
}

interface PipelineLoanRow {
  loan_officer: string | null;
  source_loan_id: string | null;
  borrower_name: string | null;
  milestone: MilestoneBucket;
  raw_milestone: string | null;
  healthy: boolean | null;
  channel: string | null;
  close_month: string | null;
  est_closing_date: string | null;
  amount: number | null;
  milestone_date: string | null;
  branch: string | null;
}

function emptyActivity(): ActivityMetrics {
  return {
    closingsByMonth: {},
    filesByMonth: {},
    creditReportsByMonth: {},
    applicationsByMonth: {},
    closingsRowsByMonth: {},
    currentMonthFiles: [],
    currentMonthCreditReports: [],
    currentMonthApplications: [],
    creditApplications: 0,
    preApprovals: 0,
    filesCreated: 0,
  };
}

function emptyPipeline(): PipelineMetrics {
  return { openLoans: 0, resolvedFunded: 0 };
}

/** Lee una tabla completa paginando. */
async function readAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

const bump = (bucket: Record<string, number>, key: string | null) => {
  if (key) bucket[key] = (bucket[key] ?? 0) + 1;
};

const sumOver = (byMonth: Record<string, number>, months: string[]) =>
  months.reduce((sum, m) => sum + (byMonth[m] ?? 0), 0);

export async function loadBusinessPlanData(reference: Date = new Date()): Promise<BusinessPlanData> {
  const supabase = getSupabaseClient();
  const org = supabase.schema('org');
  const bp = supabase.schema('business_plan');

  const windowMonths = currentWindowMonths(reference, WINDOW_MONTHS);
  const closedMonths = lastCompleteMonths(reference, WINDOW_MONTHS);
  const thisMonth = currentYearMonth(reference);
  const yearPrefix = String(reference.getFullYear()) + '-';

  // ── 1. Roster canónico ───────────────────────────────────────────────────
  const [branchesRes, employeesRes, employeeBranchRes, aliasRes, excludedRes] = await Promise.all([
    org.from('dim_branch').select('*'),
    org.from('dim_employee').select('*'),
    org.from('employee_branch').select('*'),
    org.from('employee_alias').select('*'),
    org.from('source_name_excluded').select('source_system, name_raw'),
  ]);
  for (const res of [branchesRes, employeesRes, employeeBranchRes, aliasRes, excludedRes]) {
    if (res.error) throw new Error('org: ' + res.error.message);
  }

  const branches = (branchesRes.data ?? []) as DimBranch[];
  const employees = (employeesRes.data ?? []) as DimEmployee[];
  const employeeBranch = (employeeBranchRes.data ?? []) as EmployeeBranch[];
  const aliasIndex = buildAliasIndex((aliasRes.data ?? []) as EmployeeAlias[]);
  const excludedIndex = buildExcludedIndex((excludedRes.data ?? []) as { source_system: SourceSystem; name_raw: string }[]);

  const branchByKey = new Map(branches.map((b) => [b.branch_key, b]));
  const employeeByKey = new Map(employees.map((e) => [e.employee_key, e]));

  // ── 2. Tablas opcionales ─────────────────────────────────────────────────
  /*
   * Las cuatro se leen con tolerancia a que no existan todavía: son migraciones
   * que aplica el revisor. Que falte una NO puede dejar el módulo inutilizable
   * -- se degrada a un estado visible y el pie de página lo dice.
   */
  const benchmarkByEmployee = new Map<number, EmployeeBenchmark>();
  const benchmarkHistoryByEmployee = new Map<number, EmployeeBenchmark[]>();
  let benchmarkTableAvailable = false;
  try {
    const { data, error } = await org
      .from('employee_benchmark')
      .select('employee_key, monthly_benchmark, effective_from, set_by, set_at, note')
      .order('effective_from', { ascending: true });
    if (!error && data) {
      benchmarkTableAvailable = true;
      const today = reference.toISOString().slice(0, 10);
      for (const r of data as EmployeeBenchmark[]) {
        // El historial guarda TODO, incluidos los que rigen a futuro.
        benchmarkHistoryByEmployee.set(r.employee_key, [...(benchmarkHistoryByEmployee.get(r.employee_key) ?? []), r]);
        // El vigente es el más reciente que YA entró en vigencia.
        if (r.effective_from <= today) benchmarkByEmployee.set(r.employee_key, r);
      }
    }
  } catch {
    /* tabla ausente: sin benchmark no hay veredicto, que es lo correcto */
  }

  const rateByKey: Record<RateKey, number> = { ...DEFAULT_RATES };
  let settingsTableAvailable = false;
  try {
    const { data, error } = await bp.from('settings').select('key, value');
    if (!error && data) {
      settingsTableAvailable = true;
      for (const r of data as { key: string; value: number }[]) {
        if (r.key in rateByKey) rateByKey[r.key as RateKey] = Number(r.value);
      }
    }
  } catch {
    /* esquema no expuesto todavía: se usan los defaults del código */
  }
  const rates: RateSettings = toRateSettings(rateByKey);

  const interventionByEmployee = new Map<number, InterventionRow>();
  let interventionTableAvailable = false;
  try {
    const { data, error } = await bp.from('intervention').select('*').order('created_at', { ascending: true });
    if (!error && data) {
      interventionTableAvailable = true;
      // La vigente es la última no cerrada.
      for (const r of data as InterventionRow[]) {
        if (r.status === 'closed') interventionByEmployee.delete(r.employee_key);
        else interventionByEmployee.set(r.employee_key, r);
      }
    }
  } catch {
    /* sin tabla, todos los que estén en riesgo cuentan como pendientes */
  }

  /*
   * Plan activo por persona. Se leen las tres tablas enteras: hoy son unos
   * pocos enrolamientos, y hacer una consulta por Loan Officer serían 37
   * viajes para mostrar una línea en cada fila.
   */
  const activePlanByEmployee = new Map<number, ActivePlanSummary>();
  let enrollmentTableAvailable = false;
  try {
    const { data: enrRows, error: enrErr } = await bp
      .from('enrollment')
      .select('enrollment_key, employee_key, funnel_key, funnel_name, activated_at')
      .eq('status', 'active');
    if (!enrErr && enrRows) {
      enrollmentTableAvailable = true;
      const enrollments = enrRows as {
        enrollment_key: number;
        employee_key: number;
        funnel_key: number;
        funnel_name: string;
        activated_at: string;
      }[];
      if (enrollments.length > 0) {
        const [{ data: nodeRows }, { data: msRows }] = await Promise.all([
          bp.from('enrollment_node').select('enrollment_node_key, enrollment_key'),
          bp.from('enrollment_milestone').select('enrollment_node_key, status'),
        ]);
        const enrollmentOfNode = new Map<number, number>();
        for (const n of (nodeRows ?? []) as { enrollment_node_key: number; enrollment_key: number }[]) {
          enrollmentOfNode.set(n.enrollment_node_key, n.enrollment_key);
        }
        const tally = new Map<number, { done: number; total: number }>();
        for (const m of (msRows ?? []) as { enrollment_node_key: number; status: string }[]) {
          const key = enrollmentOfNode.get(m.enrollment_node_key);
          if (key === undefined) continue;
          const t = tally.get(key) ?? { done: 0, total: 0 };
          t.total += 1;
          if (m.status === 'done') t.done += 1;
          tally.set(key, t);
        }
        for (const e of enrollments) {
          const t = tally.get(e.enrollment_key) ?? { done: 0, total: 0 };
          activePlanByEmployee.set(e.employee_key, {
            enrollmentKey: e.enrollment_key,
            funnelKey: e.funnel_key,
            funnelName: e.funnel_name,
            activatedAt: e.activated_at,
            doneMilestones: t.done,
            totalMilestones: t.total,
          });
        }
      }
    }
  } catch {
    /* tablas de funnels sin aplicar: nadie tiene plan y se dice en el pie */
  }

  const forcedBranchByEmployee = new Map<number, { branchKey: number; reason: string | null }>();
  let attributionOverrideTableAvailable = false;
  try {
    const { data, error } = await org.from('attribution_override').select('*');
    if (!error && data) {
      attributionOverrideTableAvailable = true;
      for (const r of data as AttributionOverride[]) {
        forcedBranchByEmployee.set(r.employee_key, { branchKey: r.force_branch_key, reason: r.reason });
      }
    }
  } catch {
    /* tabla ausente: rige la regla general */
  }

  // ── 3. Commercial Activity: lote activo ──────────────────────────────────
  const { data: batches, error: batchError } = await supabase
    .from('upload_batches')
    .select('id')
    .eq('is_current', true)
    .limit(1);
  if (batchError) throw new Error('upload_batches: ' + batchError.message);
  const batchId = batches?.[0]?.id as string | undefined;

  const activityRows: ActivityRow[] = batchId
    ? await readAll<ActivityRow>((from, to) =>
        supabase
          .from('loan_records')
          .select(
            'loan_officer, file_creation_month, credit_report_month, app_date_month, closing_month, branch, total_loan_amount, loan_number, loan_program, loan_folder_name, loan_info_channel_raw'
          )
          .eq('upload_batch_id', batchId)
          .range(from, to)
      )
    : [];

  // ── 4. Forecast: snapshot activo ─────────────────────────────────────────
  const pf = supabase.schema('pipeline_forecast');
  const { data: snapshots } = await pf
    .from('pipeline_snapshots')
    .select('id')
    .eq('is_active', true)
    .order('uploaded_at', { ascending: false })
    .limit(1);
  const snapshotId = snapshots?.[0]?.id as number | undefined;

  const openLoanRows: PipelineLoanRow[] = snapshotId
    ? await readAll<PipelineLoanRow>((from, to) =>
        pf
          .from('pipeline_loans')
          .select(
            'loan_officer, source_loan_id, borrower_name, milestone, raw_milestone, healthy, channel, close_month, est_closing_date, amount, milestone_date, branch'
          )
          .eq('snapshot_id', snapshotId)
          .range(from, to)
      )
    : [];
  const resolvedRows: {
    loan_officer: string | null;
    status: string | null;
    disbursement_date: string | null;
    source_loan_id: string | null;
    borrower_name: string | null;
    amount: number | string | null;
    raw_loan_folder: string | null;
    est_closing_date: string | null;
  }[] =
    snapshotId
      ? await readAll((from, to) =>
          pf
            .from('pipeline_resolved_loans')
            .select('loan_officer, status, disbursement_date, source_loan_id, borrower_name, amount, raw_loan_folder, est_closing_date')
            .eq('snapshot_id', snapshotId)
            .range(from, to)
        )
      : [];

  // ── 5. Atribución por alias ──────────────────────────────────────────────
  const activityByEmployee = new Map<number, ActivityMetrics>();
  const pipelineByEmployee = new Map<number, PipelineMetrics>();
  const openLoansByEmployee = new Map<number, OpenLoan[]>();
  const unmapped = new Map<string, { source: SourceSystem; nameRaw: string; rows: number }>();
  let excludedNamesSeen = 0;
  let rowsWithoutOfficer = 0;

  function resolve(source: SourceSystem, nameRaw: string | null): number | null {
    const { employeeKey } = aliasIndex.lookup(source, nameRaw);
    if (employeeKey !== null) return employeeKey;
    if (!nameRaw) return null;
    if (nameRaw.trim().toLowerCase() === BLANK_OFFICER) {
      rowsWithoutOfficer += 1;
      return null;
    }
    if (excludedIndex.has(source, nameRaw)) {
      excludedNamesSeen += 1;
      return null;
    }
    const k = source + ' ' + nameRaw;
    const prev = unmapped.get(k);
    if (prev) prev.rows += 1;
    else unmapped.set(k, { source, nameRaw, rows: 1 });
    return null;
  }

  for (const row of activityRows) {
    const key = resolve('slquery', row.loan_officer);
    if (key === null) continue;
    let m = activityByEmployee.get(key);
    if (!m) {
      m = emptyActivity();
      activityByEmployee.set(key, m);
    }
    if (row.file_creation_month) m.filesCreated += 1;
    if (row.credit_report_month) m.preApprovals += 1;
    if (row.app_date_month) m.creditApplications += 1;
    bump(m.closingsByMonth, row.closing_month);
    bump(m.filesByMonth, row.file_creation_month);
    bump(m.creditReportsByMonth, row.credit_report_month);
    bump(m.applicationsByMonth, row.app_date_month);

    /*
     * Filas para los modales de detalle. Se guardan los cierres de TODOS los
     * meses (una barra del gráfico se puede abrir) pero de las otras tres
     * métricas sólo el mes en curso, que es lo único que las tarjetas del
     * Qualifier 2 comparan. Guardar el año de las cuatro cuadruplicaría la
     * memoria por un detalle que ninguna pantalla muestra.
     */
    const loan: ActivityLoan = {
      loanNumber: row.loan_number,
      branch: row.branch,
      amount: Number(row.total_loan_amount) || 0,
      loanProgram: row.loan_program,
      loanFolderName: row.loan_folder_name,
      channel: row.loan_info_channel_raw,
    };
    if (row.closing_month) {
      m.closingsRowsByMonth[row.closing_month] = [...(m.closingsRowsByMonth[row.closing_month] ?? []), loan];
    }
    if (row.file_creation_month === thisMonth) m.currentMonthFiles.push(loan);
    if (row.credit_report_month === thisMonth) m.currentMonthCreditReports.push(loan);
    if (row.app_date_month === thisMonth) m.currentMonthApplications.push(loan);
  }

  for (const row of openLoanRows) {
    const key = resolve('salesforce', row.loan_officer);
    if (key === null) continue;
    const m = pipelineByEmployee.get(key) ?? emptyPipeline();
    m.openLoans += 1;
    pipelineByEmployee.set(key, m);
    const list = openLoansByEmployee.get(key) ?? [];
    list.push({
      sourceLoanId: row.source_loan_id,
      borrowerName: row.borrower_name,
      milestone: row.milestone,
      rawMilestone: row.raw_milestone,
      healthy: row.healthy === true,
      channel: row.channel,
      closeMonth: row.close_month,
      estClosingDate: row.est_closing_date,
      amount: row.amount === null ? null : Number(row.amount),
      milestoneDate: row.milestone_date,
      branch: row.branch,
    });
    openLoansByEmployee.set(key, list);
  }
  /*
   * ── DE DÓNDE SALEN LOS "CERRADOS A LA FECHA" DEL MES EN CURSO ──────────
   *
   * De acá, `pipeline_resolved_loans`, y NO de Commercial Activity. Son dos
   * fuentes para el mismo concepto y la elección es deliberada (etapa BP6):
   *
   * La proyección del mes es "lo que ya cerró + lo que sigue abierto". Las dos
   * mitades tienen que venir del MISMO sistema. Cuando un préstamo cierra, sale
   * de `pipeline_loans` y entra en `pipeline_resolved_loans` en el mismo
   * snapshot; Commercial Activity se carga por separado y puede ir atrasada.
   *
   * Con activity_report, un préstamo que ya fundeó pero que el SLQuery todavía
   * no trajo desaparece de las dos mitades y la proyección lo pierde. Pasa hoy:
   * Gian Laino tiene 3 cerrados en agosto según el pipeline y 2 según
   * Commercial Activity.
   *
   * ⚠ CONTRAPARTIDA, que hay que tener presente: las barras de los meses
   * ANTERIORES del gráfico sí salen de Commercial Activity, porque es la única
   * fuente con la serie mensual completa del año. O sea que la barra del mes en
   * curso y las demás no vienen del mismo lado. Es aceptable porque la del mes
   * en curso es un pronóstico y las otras son hechos cerrados, pero si algún
   * día los totales no cuadran al mirar hacia atrás, la explicación está acá.
   */
  const closedThisMonthByEmployee = new Map<number, number>();
  const resolvedThisMonthByEmployee = new Map<number, ResolvedLoan[]>();
  for (const row of resolvedRows) {
    if (row.status !== 'funded') continue;
    const key = resolve('salesforce', row.loan_officer);
    if (key === null) continue;
    const m = pipelineByEmployee.get(key) ?? emptyPipeline();
    m.resolvedFunded += 1;
    pipelineByEmployee.set(key, m);
    if ((row.disbursement_date ?? '').slice(0, 7) === thisMonth) {
      closedThisMonthByEmployee.set(key, (closedThisMonthByEmployee.get(key) ?? 0) + 1);
      resolvedThisMonthByEmployee.set(key, [
        ...(resolvedThisMonthByEmployee.get(key) ?? []),
        {
          sourceLoanId: row.source_loan_id,
          borrowerName: row.borrower_name,
          amount: row.amount === null ? null : Number(row.amount),
          loanFolder: row.raw_loan_folder,
          disbursementDate: row.disbursement_date,
          estClosingDate: row.est_closing_date,
        },
      ]);
    }
  }

  // ── 6. Filas de Loan Officer ─────────────────────────────────────────────
  /*
   * Salen de `employee_branch` con role_in_branch='LO'. Un "Producing BM"
   * (Ana Peña, Galo Rizzo...) tiene fila LO además de la BM y aparece en las
   * dos listas: es correcto.
   */
  /*
   * ── SÓLO GENTE ACTIVA (etapa BP7b) ──────────────────────────────────────
   *
   * Se filtra por `is_active`, el booleano, y NO por el texto de
   * `roster_status`. El booleano ya cubre los dos motivos por los que alguien
   * no está trabajando hoy -- 'Inactive' y 'Supreme Hiring Process' -- y
   * parsear la cadena obligaría a mantener una lista de estados válidos que se
   * desactualiza cada vez que RRHH inventa uno nuevo.
   *
   * No es cosmético: evaluar a alguien que ya no está infla el riesgo del
   * branch. Sergio Vermejo (716) aparecía sin benchmark y contaba como On
   * Risk, cuando el problema era que no debía estar en la lista.
   *
   * El conteo de excluidos viaja en `diagnostics` para que se note si mañana
   * desaparece medio equipo por un cambio de roster.
   */
  let inactiveExcluded = 0;
  const loBranchCodes = new Map<number, string[]>();
  for (const row of employeeBranch) {
    if (row.role_in_branch !== 'LO') continue;
    const code = branchByKey.get(row.branch_key)?.branch_code;
    if (!code) continue;
    const employee = employeeByKey.get(row.employee_key);
    if (!employee?.is_active) {
      if (employee) inactiveExcluded += 1;
      continue;
    }
    loBranchCodes.set(row.employee_key, [...(loBranchCodes.get(row.employee_key) ?? []), code]);
  }

  /*
   * La excepción de atribución REEMPLAZA la lista, no la amplía: "toda su
   * producción va al 777" significa que no queda nada contándose en otro lado.
   * Si sólo se agregara, la persona aparecería en los dos branches y sus
   * totales se contarían dos veces.
   */
  const overrideDetail = new Map<number, { forcedBranchCode: string; reason: string | null }>();
  for (const [employeeKey, forced] of forcedBranchByEmployee) {
    const code = branchByKey.get(forced.branchKey)?.branch_code;
    if (!code) continue;
    // La excepción de atribución no resucita a nadie: si está inactivo, no entra.
    if (!employeeByKey.get(employeeKey)?.is_active) continue;
    loBranchCodes.set(employeeKey, [code]);
    overrideDetail.set(employeeKey, { forcedBranchCode: code, reason: forced.reason });
  }

  const loanOfficers: LoanOfficerRow[] = [];
  for (const [employeeKey, branchCodes] of loBranchCodes) {
    const employee = employeeByKey.get(employeeKey);
    if (!employee) continue;

    const activity = activityByEmployee.get(employeeKey) ?? emptyActivity();
    const openLoanDetail = openLoansByEmployee.get(employeeKey) ?? [];
    const benchmarkRow = benchmarkByEmployee.get(employeeKey) ?? null;
    const benchmark = benchmarkRow === null ? null : Number(benchmarkRow.monthly_benchmark);

    const projection = projectCurrentMonth(
      closedThisMonthByEmployee.get(employeeKey) ?? 0,
      openLoanDetail,
      rates,
      thisMonth
    );
    const q1 = evaluateQualifier1(activity.closingsByMonth, windowMonths, projection, benchmark);

    /*
     * El "actual" del Qualifier 2 es el MES EN CURSO, coherente con que el
     * requerido se deriva de un benchmark mensual.
     *
     * ⚠ Consecuencia conocida: a principio de mes casi nadie llega al
     * requerido, porque se compara un mes incompleto contra un objetivo de mes
     * entero. Por eso al lado va siempre el promedio de los 3 meses cerrados,
     * que es lo que esa persona suele producir. Si el negocio prefiere evaluar
     * sobre el promedio en vez del mes en curso, se cambia el argumento de acá
     * y nada más.
     */
    const q2 = evaluateQualifier2(
      {
        fileCreations: activity.filesByMonth[thisMonth] ?? 0,
        creditReports: activity.creditReportsByMonth[thisMonth] ?? 0,
        applications: activity.applicationsByMonth[thisMonth] ?? 0,
      },
      {
        fileCreations: sumOver(activity.filesByMonth, closedMonths) / WINDOW_MONTHS,
        creditReports: sumOver(activity.creditReportsByMonth, closedMonths) / WINDOW_MONTHS,
        applications: sumOver(activity.applicationsByMonth, closedMonths) / WINDOW_MONTHS,
      },
      benchmark,
      rates
    );

    loanOfficers.push({
      employeeKey,
      fullName: employee.full_name,
      branchCodes: branchCodes.sort(),
      attributionOverride: overrideDetail.get(employeeKey) ?? null,
      tier: employee.tier,
      rosterStatus: employee.roster_status,
      isBranchManager: employee.is_branch_manager,
      isProducing: employee.is_producing,
      activity,
      pipeline: pipelineByEmployee.get(employeeKey) ?? emptyPipeline(),
      openLoanDetail,
      resolvedLoanDetail: resolvedThisMonthByEmployee.get(employeeKey) ?? [],
      monthlyBenchmark: benchmark,
      benchmarkSetBy: benchmarkRow?.set_by ?? null,
      benchmarkEffectiveFrom: benchmarkRow?.effective_from ?? null,
      benchmarkNote: benchmarkRow?.note ?? null,
      benchmarkHistory: benchmarkHistoryByEmployee.get(employeeKey) ?? [],
      projection,
      avgClosedMonths: sumOver(activity.closingsByMonth, closedMonths) / WINDOW_MONTHS,
      ytdClosings: Object.entries(activity.closingsByMonth)
        .filter(([m]) => m.startsWith(yearPrefix))
        .reduce((sum, [, n]) => sum + n, 0),
      q1,
      q2,
      verdict: combineVerdict(q1, q2),
      intervention: interventionByEmployee.get(employeeKey) ?? null,
      activePlan: activePlanByEmployee.get(employeeKey) ?? null,
    });
  }
  loanOfficers.sort((a, b) => a.fullName.localeCompare(b.fullName));

  // ── 7. Filas de branch ───────────────────────────────────────────────────
  const bmByBranchKey = new Map<number, string[]>();
  for (const row of employeeBranch) {
    if (row.role_in_branch !== 'BM') continue;
    // Mismo criterio que con los Loan Officers: un manager dado de baja no se
    // muestra al frente de un branch. Hoy no hay ninguno, pero el roster cambia.
    const employee = employeeByKey.get(row.employee_key);
    if (!employee?.is_active) continue;
    const name = employee.full_name;
    bmByBranchKey.set(row.branch_key, [...(bmByBranchKey.get(row.branch_key) ?? []), name]);
  }

  const branchRows: BranchRow[] = branches
    .filter((b) => b.is_division_branch)
    .map((b) => {
      const los = loanOfficers.filter((lo) => lo.branchCodes.includes(b.branch_code));
      const atRisk = los.filter((lo) => lo.verdict === 'on_risk');
      const { status, pendingCount } = branchStatus(atRisk);
      return {
        branchKey: b.branch_key,
        branchCode: b.branch_code,
        isDivisionBranch: b.is_division_branch,
        branchManagers: (bmByBranchKey.get(b.branch_key) ?? []).sort(),
        loanOfficers: los,
        totalLoanOfficers: los.length,
        atRiskCount: atRisk.length,
        status,
        pendingCount,
        // Ritmo de cierres del branch: la suma de los promedios de su gente.
        avgClosings3m: los.reduce((sum, lo) => sum + lo.q1.avgWithCurrent, 0),
      };
    })
    .sort((a, b) => a.branchCode.localeCompare(b.branchCode, undefined, { numeric: true }));

  return {
    branches: branchRows,
    loanOfficers,
    diagnostics: {
      activityRowsRead: activityRows.length,
      pipelineRowsRead: openLoanRows.length + resolvedRows.length,
      excludedNamesSeen,
      rowsWithoutOfficer,
      unmappedNames: [...unmapped.values()].sort((a, b) => b.rows - a.rows),
      benchmarkTableAvailable,
      windowMonths,
      closedMonths,
      attributionOverrides: [...overrideDetail.entries()]
        .map(([employeeKey, d]) => ({
          fullName: employeeByKey.get(employeeKey)?.full_name ?? 'employee_key ' + employeeKey,
          forcedBranchCode: d.forcedBranchCode,
          reason: d.reason,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      attributionOverrideTableAvailable,
      settingsTableAvailable,
      interventionTableAvailable,
      enrollmentTableAvailable,
      rates,
      inactiveExcluded,
    },
  };
}
