import { getSupabaseClient } from '@/lib/supabase/client';
import { buildAliasIndex, buildExcludedIndex } from './aliasIndex';
import { lastCompleteMonths } from './months';
import { triageFor, branchTriage } from './triage';
import type {
  ActivityMetrics,
  AttributionOverride,
  BranchRow,
  BusinessPlanData,
  DimBranch,
  DimEmployee,
  EmployeeAlias,
  EmployeeBranch,
  LoanOfficerRow,
  PipelineMetrics,
  SourceSystem,
} from './types';

/**
 * ============================================================================
 * CARGA Y RESOLUCIÓN DE DATOS DEL MÓDULO
 * ============================================================================
 *
 * Etapa BP1 — ARCHIVO NUEVO.
 *
 * Todo corre en el navegador con la sesión del usuario, igual que el resto de
 * la app: el esquema `org` tiene RLS por el claim `commercial_activity` y es de
 * solo lectura para `authenticated`. No hay API routes ni service_role acá.
 *
 * VOLUMEN: `activity_report.loan_records` tiene ~53k filas históricas, pero
 * sólo se leen las del lote ACTIVO (~4.6k), y sólo 5 columnas. Es el mismo
 * orden de magnitud que ya carga Commercial Activity al abrirse.
 */

/** PostgREST corta en 1000 filas por respuesta; hay que paginar explícitamente. */
const PAGE_SIZE = 1000;

/** Cuántos meses completos entran en el promedio de cierres. */
const AVERAGE_WINDOW_MONTHS = 3;

/**
 * Centinela que produce NUESTRO propio parser, no un nombre de la fuente:
 * `classifyLoan()` normaliza un loan officer vacío a '(blank)'. Son 210 filas
 * del lote actual.
 *
 * Se reconoce explícitamente para no listarlo como "nombre sin clasificar" --
 * nadie va a agregar '(blank)' a `org.employee_alias`, y dejarlo en el
 * diagnóstico enterraría los nombres que sí hay que revisar. Se cuenta aparte:
 * es producción sin LO asignado, un dato de calidad de la fuente.
 */
const BLANK_OFFICER = '(blank)';

interface ActivityRow {
  loan_officer: string | null;
  file_creation_month: string | null;
  credit_report_month: string | null;
  app_date_month: string | null;
  closing_month: string | null;
}

function emptyActivity(): ActivityMetrics {
  return { closingsByMonth: {}, avgClosings3m: 0, creditApplications: 0, preApprovals: 0, filesCreated: 0 };
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

export async function loadBusinessPlanData(): Promise<BusinessPlanData> {
  const supabase = getSupabaseClient();
  const org = supabase.schema('org');

  // ── 1. Roster canónico (tablas chicas, se leen enteras) ──────────────────
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
  const aliases = (aliasRes.data ?? []) as EmployeeAlias[];

  const aliasIndex = buildAliasIndex(aliases);
  const excludedIndex = buildExcludedIndex((excludedRes.data ?? []) as { source_system: SourceSystem; name_raw: string }[]);

  const branchByKey = new Map(branches.map((b) => [b.branch_key, b]));
  const employeeByKey = new Map(employees.map((e) => [e.employee_key, e]));

  // ── 2. Benchmarks (la tabla puede no existir todavía) ────────────────────
  /*
   * `org.employee_benchmark` se entrega como migración en docs/sql/ y la aplica
   * el revisor. Hasta entonces la consulta falla, y eso NO debe romper la
   * página: sin benchmark el triage es "no evaluable", que es exactamente lo
   * que el negocio pidió -- nada de defaults silenciosos a 2.0.
   */
  let benchmarkByEmployee = new Map<number, number>();
  let benchmarkTableAvailable = false;
  try {
    const { data, error } = await org
      .from('employee_benchmark')
      .select('employee_key, monthly_benchmark, effective_from')
      .order('effective_from', { ascending: true });
    if (!error && data) {
      benchmarkTableAvailable = true;
      // Versionado por fecha: gana el más reciente que ya entró en vigencia.
      const today = new Date().toISOString().slice(0, 10);
      const latest = new Map<number, number>();
      for (const r of data as { employee_key: number; monthly_benchmark: number; effective_from: string }[]) {
        if (r.effective_from <= today) latest.set(r.employee_key, Number(r.monthly_benchmark));
      }
      benchmarkByEmployee = latest;
    }
  } catch {
    /* tabla ausente: se sigue sin benchmarks */
  }

  // ── 2b. Excepciones de atribución ────────────────────────────────────────
  /*
   * `org.attribution_override` lista a las personas cuya producción se fuerza a
   * un branch, contra lo que digan las fuentes. Se CONSULTA, no se codifica:
   * agregar a alguien tiene que ser un INSERT, no un deploy, y la excepción
   * tiene que poder verse mirando la base.
   *
   * Igual que con los benchmarks, que la tabla falte no puede romper la página:
   * sin ella rige la regla general y listo.
   */
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
          .select('loan_officer, file_creation_month, credit_report_month, app_date_month, closing_month')
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

  const openLoanRows: { loan_officer: string | null }[] = snapshotId
    ? await readAll((from, to) =>
        pf.from('pipeline_loans').select('loan_officer').eq('snapshot_id', snapshotId).range(from, to)
      )
    : [];
  const resolvedRows: { loan_officer: string | null; status: string | null }[] = snapshotId
    ? await readAll((from, to) =>
        pf
          .from('pipeline_resolved_loans')
          .select('loan_officer, status')
          .eq('snapshot_id', snapshotId)
          .range(from, to)
      )
    : [];

  // ── 5. Atribución por alias ──────────────────────────────────────────────
  const activityByEmployee = new Map<number, ActivityMetrics>();
  const pipelineByEmployee = new Map<number, PipelineMetrics>();
  const unmapped = new Map<string, { source: SourceSystem; nameRaw: string; rows: number }>();
  let excludedNamesSeen = 0;
  let rowsWithoutOfficer = 0;

  /** Resuelve un nombre crudo, o cuenta por qué no se pudo. */
  function resolve(source: SourceSystem, nameRaw: string | null): number | null {
    const { employeeKey } = aliasIndex.lookup(source, nameRaw);
    if (employeeKey !== null) return employeeKey;
    if (!nameRaw) return null;
    // Centinela propio, no un nombre a clasificar (ver BLANK_OFFICER).
    if (nameRaw.trim().toLowerCase() === BLANK_OFFICER) {
      rowsWithoutOfficer += 1;
      return null;
    }
    // Excluido a propósito: se ignora en silencio, sin contarlo en ningún lado.
    if (excludedIndex.has(source, nameRaw)) {
      excludedNamesSeen += 1;
      return null;
    }
    // Ni mapeado ni excluido: alguien tiene que clasificarlo.
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
    if (row.closing_month) m.closingsByMonth[row.closing_month] = (m.closingsByMonth[row.closing_month] ?? 0) + 1;
  }

  for (const row of openLoanRows) {
    const key = resolve('salesforce', row.loan_officer);
    if (key === null) continue;
    const m = pipelineByEmployee.get(key) ?? emptyPipeline();
    m.openLoans += 1;
    pipelineByEmployee.set(key, m);
  }
  for (const row of resolvedRows) {
    if (row.status !== 'funded') continue;
    const key = resolve('salesforce', row.loan_officer);
    if (key === null) continue;
    const m = pipelineByEmployee.get(key) ?? emptyPipeline();
    m.resolvedFunded += 1;
    pipelineByEmployee.set(key, m);
  }

  // ── 6. Promedio de cierres ───────────────────────────────────────────────
  const monthsUsedForAverage = lastCompleteMonths(new Date(), AVERAGE_WINDOW_MONTHS);
  for (const m of activityByEmployee.values()) {
    const total = monthsUsedForAverage.reduce((sum, month) => sum + (m.closingsByMonth[month] ?? 0), 0);
    m.avgClosings3m = total / AVERAGE_WINDOW_MONTHS;
  }

  // ── 7. Filas de LO ───────────────────────────────────────────────────────
  /*
   * Los LOs salen de `employee_branch` con role_in_branch='LO'. Esto es lo que
   * deja fuera del directorio a Pier Laino: es BM de 710 y 716 pero no tiene
   * ninguna fila con rol LO, así que no aparece por ningún lado como LO.
   *
   * Al revés, un "Producing BM" (Ana Peña, Galo Rizzo, Mariano Claudio...)
   * SÍ tiene fila LO además de la BM, y aparece en las dos listas. Es correcto.
   */
  const loBranchCodes = new Map<number, string[]>();
  for (const row of employeeBranch) {
    if (row.role_in_branch !== 'LO') continue;
    const code = branchByKey.get(row.branch_key)?.branch_code;
    if (!code) continue;
    const list = loBranchCodes.get(row.employee_key) ?? [];
    list.push(code);
    loBranchCodes.set(row.employee_key, list);
  }

  /*
   * La excepción de atribución se aplica DESPUÉS y REEMPLAZA la lista, no la
   * amplía: "toda su producción va al 777" quiere decir que no queda nada
   * contándose en otro lado. Si sólo se agregara el branch forzado, la persona
   * aparecería en los dos y sus totales se contarían dos veces.
   *
   * Se aplica aunque `employee_branch` ya coincida con el override -- que hoy
   * coincida (Jonathan Valenzuela ya figura con rol LO en el 777) es una
   * casualidad del roster actual, no algo en lo que apoyarse: el día que el
   * roster lo mueva al 710, esta línea es lo que mantiene su producción en 777.
   */
  const overrideDetail = new Map<number, { forcedBranchCode: string; reason: string | null }>();
  for (const [employeeKey, forced] of forcedBranchByEmployee) {
    const code = branchByKey.get(forced.branchKey)?.branch_code;
    if (!code) continue; // override apuntando a un branch inexistente: se ignora
    loBranchCodes.set(employeeKey, [code]);
    overrideDetail.set(employeeKey, { forcedBranchCode: code, reason: forced.reason });
  }

  const loanOfficers: LoanOfficerRow[] = [];
  for (const [employeeKey, branchCodes] of loBranchCodes) {
    const employee = employeeByKey.get(employeeKey);
    if (!employee) continue;

    const activity = activityByEmployee.get(employeeKey) ?? emptyActivity();
    const monthlyBenchmark = benchmarkByEmployee.get(employeeKey) ?? null;
    const gap = monthlyBenchmark === null ? null : activity.avgClosings3m - monthlyBenchmark;

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
      monthlyBenchmark,
      gap,
      triage: triageFor(monthlyBenchmark),
    });
  }
  loanOfficers.sort((a, b) => a.fullName.localeCompare(b.fullName));

  // ── 8. Filas de branch ───────────────────────────────────────────────────
  const bmByBranchKey = new Map<number, string[]>();
  for (const row of employeeBranch) {
    if (row.role_in_branch !== 'BM') continue;
    const name = employeeByKey.get(row.employee_key)?.full_name;
    if (!name) continue;
    const list = bmByBranchKey.get(row.branch_key) ?? [];
    list.push(name);
    bmByBranchKey.set(row.branch_key, list);
  }

  const branchRows: BranchRow[] = branches
    .filter((b) => b.is_division_branch)
    .map((b) => {
      const los = loanOfficers.filter((lo) => lo.branchCodes.includes(b.branch_code));
      const atRiskCount = los.filter((lo) => lo.triage === 'on_risk').length;
      return {
        branchKey: b.branch_key,
        branchCode: b.branch_code,
        isDivisionBranch: b.is_division_branch,
        branchManagers: (bmByBranchKey.get(b.branch_key) ?? []).sort(),
        loanOfficers: los,
        totalLoanOfficers: los.length,
        atRiskCount,
        triage: branchTriage(los),
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
      monthsUsedForAverage,
      attributionOverrides: [...overrideDetail.entries()]
        .map(([employeeKey, d]) => ({
          fullName: employeeByKey.get(employeeKey)?.full_name ?? ('employee_key ' + employeeKey),
          forcedBranchCode: d.forcedBranchCode,
          reason: d.reason,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      attributionOverrideTableAvailable,
    },
  };
}
