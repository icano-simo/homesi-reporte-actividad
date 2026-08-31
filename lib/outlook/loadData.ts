'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import { buildAliasIndex, buildExcludedIndex } from '@/lib/business-plan/aliasIndex';
import { classifyBranch } from '@/lib/domain/classifyBranch';
import { addMonths } from '@/lib/business-plan/impact';
import { loadBusinessPlanData } from '@/lib/business-plan/loadData';
import type { BusinessPlanData, LoanOfficerRow } from '@/lib/business-plan/types';
import {
  OUTLOOK_STRATEGIES,
  benchmarkAt,
  type BenchmarkPoint,
  type Cadence,
  type GrowthSegment,
  type OutlookStrategy,
  type ProjectionMode,
  type StrategyPlan,
} from './project';

const PAGE_SIZE = 1000;

/*
 * ============================================================================
 * DE DÓNDE SALE CADA NÚMERO DE OUTLOOK — etapa OL1
 * ============================================================================
 *
 * ⚠ La regla del módulo: LEER, NO RECALCULAR.
 *
 *   YTD  ................ `activity_report.loan_records_v2`, con
 *                         `counts_for_division` -- la misma regla que usa
 *                         Commercial Activity para sus totales de división.
 *   Mes actual .......... `loadBusinessPlanData()`, que ya calcula la
 *                         proyección del mes por Loan Officer a partir del
 *                         snapshot de Forecast.
 *   Funnel .............. el `activePlan` que ese mismo loader ya trae de
 *                         `business_plan.enrollment`.
 *   Benchmark de
 *   Own Production ...... `org.employee_benchmark`, vía el mismo loader.
 *   Los otros cuatro .... `outlook.strategy_benchmark`.
 *   Reglas .............. `outlook.growth_rule`.
 *
 * Reusar el loader del Business Plan en vez de rearmar la proyección del mes es
 * lo que hace que las dos pantallas no puedan discrepar. Si Outlook recalculara,
 * tendría que replicar la cascada de pull-through, el filtro del mes de BP33 y
 * la resolución de alias de BP37 -- y las tres divergirían con el tiempo.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ EL YTD SE LEE ACÁ Y NO SE TOMA DEL BUSINESS PLAN
 * ---------------------------------------------------------------------------
 * El Business Plan guarda cierres por mes POR PERSONA
 * (`activity.closingsByMonth`), no por estrategia. Outlook necesita el corte por
 * estrategia, que es la base de toda su estructura, así que lee las filas.
 *
 * Y usa `counts_for_division`, no `is_closed`: verificado contra los diez YTD de
 * referencia del brief, los diez coinciden con esa regla y dos de ellos (733 y
 * 710) NO coinciden con `is_closed`. Los HELOC de segundo gravamen no le suman
 * a la división, y este módulo es un presupuesto de división.
 */

/*
 * ============================================================================
 * LAS FILAS CRUDAS, ENTERAS — etapa OL2
 * ============================================================================
 *
 * El loader ya no se queda sólo con lo vigente: expone TODAS las filas de las
 * tres tablas en `OutlookData.history`.
 *
 * ⚠ No es un extra del editor, es lo que hace útil al append-only. Guardar la
 * historia y no mostrarla es tener el costo del modelo sin el beneficio: la
 * pregunta que justifica todo esto --"quién puso que Recruitment crecía 20%
 * desde octubre"-- se contesta leyendo estas filas.
 *
 * Son pocas y caben: 185 reglas y una decena de benchmarks. El día que no
 * quepan, se lee por (persona, estrategia) al abrir el editor; hoy paginar
 * sería complejidad sin motivo.
 */
export interface StrategyBenchmarkRow {
  strategy_benchmark_key: number;
  employee_key: number;
  strategy: string;
  monthly_benchmark: number | string;
  effective_from: string;
  set_by: string;
  note: string | null;
  created_at: string;
}

export interface NppmBenchmarkRow {
  nppm_benchmark_key: number;
  nppm_realtor: string;
  monthly_benchmark: number | string;
  effective_from: string;
  set_by: string;
  note: string | null;
  created_at: string;
}

export interface GrowthRuleRow {
  growth_rule_key: number;
  employee_key: number;
  strategy: string;
  revision: number;
  segment_order: number;
  from_month: string;
  cadence: Cadence;
  growth_pct: number | string;
  set_by: string;
  note: string | null;
  created_at: string;
}

/**
 * Una fila de `org.roster_current`, con lo que Outlook necesita — etapa OL7.
 *
 * ⚠ EL ROSTER DECIDE QUIÉN Y DE QUÉ BRANCH. `org.dim_employee` sigue siendo la
 * identidad interna a la que se atan benchmarks, planes y URLs, pero ya no
 * decide la lista: el roster tiene el branch correcto --Johann en el 710 y no en
 * el 716-- y `is_producer` es una decisión registrada, con autor cuando se fijó
 * a mano.
 *
 * El puente entre los dos es el alias `person_code`, y hoy cubre a los 38
 * productores: 38 de 38 resuelven a `employee_key`.
 */
export interface RosterRow {
  person_code: string;
  display_name: string;
  branch_code: string | null;
  is_producer: boolean;
  is_active: boolean;
}

export interface MonthlyTargetRow {
  monthly_target_key: number;
  employee_key: number;
  strategy: string;
  revision: number;
  target_month: string;
  target: number | string;
  set_by: string;
  note: string | null;
  created_at: string;
}

export interface ProjectionModeRow {
  projection_mode_key: number;
  employee_key: number;
  strategy: string;
  mode: ProjectionMode;
  set_by: string;
  note: string | null;
  created_at: string;
}

export interface StrategyYtd {
  strategy: OutlookStrategy;
  /** Cerrados del año. Es la suma de `actualByMonth`, no un conteo aparte. */
  ytd: number;
  /** Cerrados por mes, 'YYYY-MM' → cuántos. Sólo meses con producción — OL3. */
  actualByMonth: Record<string, number>;
  /**
   * Dentro de NPPM, los realtors por nombre. Vacío en las otras cuatro.
   *
   * ⚠ El benchmark es del REALTOR, no del par (realtor, Loan Officer): el mismo
   * realtor trabaja con varias personas y en varias branches -- Laura Delgado
   * está en el 733 con Aimmee Buendía y en el 776 con Silvio Arteaga. Lo que se
   * atribuye al Loan Officer es la producción de cada caso, que es lo que dicen
   * los datos; el compromiso es del realtor.
   */
  byRealtor: {
    realtor: string;
    ytd: number;
    /** Su producción mes a mes — etapa OL3. */
    actualByMonth: Record<string, number>;
    benchmark: number | null;
  }[];
}

/**
 * En qué estado está una persona SEGÚN EL ROSTER, y por qué son cuatro y no dos.
 *
 * ⚠ El rótulo tiene que decir el estado REAL, no "ya no produce", porque el día
 * que aparezca alguien que sigue en la empresa y dejó de originar van a ser dos
 * casos distintos y hay que poder distinguirlos:
 *
 *   'producer'   produce y está activa. Es la lista de arriba.
 *   'left'       ya no está en la empresa (`is_active = false`). Su producción
 *                de enero a julio es real y ya ocurrió; lo que cambió es que no
 *                va a producir de septiembre en adelante. Hoy: Isabel Wagner y
 *                Ludwig Aguillon, bajas que RRHH registró, con 3 cierres de
 *                división en el 716 entre las dos este año (Isabel 2, mayo y
 *                junio; Ludwig 1, febrero).
 *   'not_producing'  sigue en la empresa y no origina. Hoy nadie con cierres,
 *                pero es el caso que obliga a que 'left' no diga "no produce".
 *   'unknown'    cerró en el branch y no aparece en el roster.
 */
export type RosterState = 'producer' | 'left' | 'not_producing' | 'unknown';

export interface OutlookLoanOfficer {
  employeeKey: number;
  fullName: string;
  branchCodes: string[];
  ytd: number;
  /** Cerrados por mes — etapa OL3. La banda real de la tabla. */
  actualByMonth: Record<string, number>;
  /** El PRONÓSTICO del mes en curso, que ya incluye lo cerrado del mes. */
  currentMonth: number;
  /**
   * La parte de `currentMonth` que ya cerró — etapa OL3.
   *
   * ⚠ Está DENTRO de `currentMonth`, no al lado. Sirve para explicar la columna
   * del mes en curso, nunca para sumarse a ella.
   */
  closedToDate: number;
  /** Suma de los benchmarks de sus cinco estrategias. Calculado, no editable. */
  benchmarkTotal: number;
  ownProductionBenchmark: number | null;
  activePlan: LoanOfficerRow['activePlan'];
  /**
   * El branch al que se le carga su MES ACTUAL y sus proyecciones — OL1b.
   *
   * ⚠ No es lo mismo que dónde aparece la persona. Su YTD se reparte por branch
   * del préstamo (puede estar en dos); su proyección no se puede repartir,
   * porque es un número por persona y no por préstamo. Se carga entera al
   * branch de su roster.
   *
   * Sin esto había un doble conteo: alguien con producción en dos branches
   * sumaba su proyección completa en los dos.
   */
  primaryBranch: string | null;
  strategies: StrategyYtd[];
  rulesByStrategy: Partial<Record<OutlookStrategy, GrowthSegment[]>>;
  /**
   * La revisión VIGENTE de la regla de cada estrategia, o 0 si nunca se guardó
   * ninguna — etapa OL2. La próxima edición escribe `revision + 1`.
   */
  ruleRevision: Partial<Record<OutlookStrategy, number>>;
  /** El benchmark que rige el PRIMER mes proyectado. Es el que se muestra. */
  strategyBenchmarks: Partial<Record<OutlookStrategy, number>>;
  /**
   * La serie completa por estrategia — etapa OL2. Cada mes proyectado usa el
   * punto vigente en ese mes, no este valor de portada. Ver `benchmarkAt`.
   */
  benchmarkSchedules: Partial<Record<OutlookStrategy, BenchmarkPoint[]>>;
  /**
   * El modo que RIGE en cada estrategia — etapa OL4. Sin fila guardada,
   * `growth`, que es como se comportaba el módulo antes.
   */
  modeByStrategy: Partial<Record<OutlookStrategy, ProjectionMode>>;
  /** Quién eligió el modo y cuándo. `null` si nadie lo eligió nunca. */
  modeSetBy: Partial<Record<OutlookStrategy, { setBy: string; at: string } | null>>;
  /** Modo `monthly`: los meses fijados de la revisión vigente — etapa OL4. */
  targetsByStrategy: Partial<Record<OutlookStrategy, Record<string, number>>>;
  /** La revisión vigente de los meses fijados, o 0 si no hay ninguna. */
  targetRevision: Partial<Record<OutlookStrategy, number>>;

  /** Estado según el roster. Ver `RosterState`. */
  rosterState: RosterState;
  /**
   * ¿Tiene identidad interna (`employee_key`)?
   *
   * ⚠ `false` significa que el roster dice que produce pero no hay alias
   * `person_code` que la ate a `org.dim_employee`, así que NO puede tener
   * benchmark ni plan --los dos cuelgan de `employee_key`--. Se muestra igual,
   * con su nombre y su branch y sin presupuesto, porque ocultarla dejaría el
   * total del branch sin cuadrar con la suma de sus filas: un descuadre sin
   * explicación es peor que una fila incompleta. Y el pie la cuenta, para que el
   * día que ese número deje de ser cero alguien cree la fila.
   *
   * Hoy son 0 de 38.
   */
  hasIdentity: boolean;
  /**
   * Dirige el branch además de producir. Sale de `dim_employee.is_branch_manager`,
   * que `LoanOfficerRow` ya traía.
   *
   * Son 10 de los 34, y en `org.employee_branch` tienen DOS filas --una 'LO' y
   * una 'BM'-- que es lo que hacía que un conteo ingenuo diera 44 personas en
   * vez de 34.
   */
  isBranchManager: boolean;
}

export interface OutlookBranch {
  branchCode: string;
  ytd: number;
  /** Cerrados por mes — etapa OL3. */
  actualByMonth: Record<string, number>;
  currentMonth: number;
  /** La parte ya cerrada del pronóstico del mes en curso — etapa OL3. */
  closedToDate: number;
  /**
   * Préstamos cerrados EN ESTE BRANCH cuyo originador no pertenece a la
   * división — etapa OL1b.
   *
   * No es un error ni un dato faltante: son personas en
   * `org.source_name_excluded`, excluidas con motivo escrito porque no son Loan
   * Officers de HomeSí. Outlook mide producción ATRIBUIBLE a la división, que
   * es lo que se puede presupuestar; Commercial Activity los cuenta porque mide
   * el branch, no la división.
   *
   * Se expone para que la diferencia con Commercial Activity se explique en la
   * pantalla y no preguntando: 47 (+4 sin atribuir) contra los 51 de allá.
   */
  unattributed: number;
  loanOfficers: OutlookLoanOfficer[];
}

export interface OutlookData {
  /** Los meses que faltan del año, derivados de la fecha del sistema. */
  remainingMonths: string[];
  currentMonth: string;
  /**
   * Los doce meses del año — etapa OL3.
   *
   * ⚠ Las tres bandas de la tabla son exactamente una partición de esta lista:
   * `actualMonths` (real), `currentMonth` (pronóstico) y `remainingMonths`
   * (presupuesto). Cada mes aparece en una sola, y de ahí sale que el total del
   * año no pueda contar nada dos veces.
   */
  monthsOfYear: string[];
  /** Los meses cerrados: anteriores al mes en curso. Vacío en enero. */
  actualMonths: string[];
  branches: OutlookBranch[];
  /** El mes desde el que rige cualquier benchmark editado hoy. */
  effectiveFrom: string;
  /** Las filas crudas de las tres tablas, para historial y edición — OL2. */
  history: {
    strategyBenchmarks: StrategyBenchmarkRow[];
    nppmBenchmarks: NppmBenchmarkRow[];
    growthRules: GrowthRuleRow[];
    monthlyTargets: MonthlyTargetRow[];
    projectionModes: ProjectionModeRow[];
  };
  diagnostics: {
    activityRowsRead: number;
    ytdRowsCounted: number;
    strategyBenchmarkRows: number;
    growthRuleRows: number;
    outlookTablesAvailable: boolean;
    /** Loan officers de actividad que no resolvieron contra el roster. */
    unresolvedOfficers: number;
    /** Cierres con mes posterior al actual. Debería ser 0 — ver el loader. */
    actualsAfterCurrentMonth: number;
    /** Cerrados del mes en curso según `loan_records_v2`. */
    currentMonthClosedRecords: number;
    /** Cerrados del mes en curso según Forecast, que es lo que va en el pronóstico. */
    currentMonthClosedForecast: number;
    /** Productores del roster que no resuelven a `employee_key`. Hoy 0 de 38. */
    producersWithoutIdentity: number;
    /** Filas que aparecen sólo porque cerraron y ya no producen. Hoy 2. */
    closedButNotProducing: number;
    /** Productores activos del roster, la lista de arriba. Hoy 35. */
    activeProducers: number;
    /**
     * ¿Se pudo leer `org.roster_current`?
     *
     * ⚠ `false` significa que la pantalla está mostrando la lista ANTERIOR, la
     * de `org.employee_branch`, y que nadie lo va a notar mirando: sale llena y
     * con números plausibles. La tabla devuelve cero filas **sin error** cuando
     * la policy no aplica --la RLS no rechaza, filtra--, así que este booleano
     * es la única señal.
     */
    rosterAvailable: boolean;
    /**
     * ¿Están las tablas de OL4? — `outlook.monthly_target` y
     * `outlook.projection_mode`.
     *
     * ⚠ Se usa para NO OFRECER el modo mes a mes cuando no se puede guardar.
     * Ofrecerlo igual dejaría a alguien escribiendo cuatro números para
     * descubrir al apretar Guardar que no hay dónde ponerlos.
     */
    monthlyModeAvailable: boolean;
  };
}

/** Los meses que quedan del año DESPUÉS del actual. Vacío en diciembre. */
export function remainingMonthsOf(currentMonth: string): string[] {
  const year = Number(currentMonth.split('-')[0]);
  const out: string[] = [];
  for (let m = addMonths(currentMonth, 1); Number(m.split('-')[0]) === year; m = addMonths(m, 1)) {
    out.push(m);
  }
  return out;
}

/** Mismo criterio que `aliasIndex`: trim, espacios colapsados, mayúsculas. */
function normName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

/*
 * ============================================================================
 * CONTAR POR MES — etapa OL3
 * ============================================================================
 *
 * Un contador de dos niveles: entidad → mes → cuántos. El anual nunca se
 * guarda, se suma con `totalOf`, así que no puede discrepar de los meses.
 *
 * Se usa un mapa anidado y no una clave `entidad|mes` plana porque los meses
 * hay que poder ENUMERAR por entidad, y con clave plana eso obliga a barrer
 * todas las claves buscando un prefijo -- que es justo el patrón que ya dio un
 * problema con los nombres de realtor que contienen el separador.
 */
type MonthCounter = Map<string, Map<string, number>>;

function bump(counter: MonthCounter, key: string, month: string): void {
  const byMonth = counter.get(key) ?? new Map<string, number>();
  byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  counter.set(key, byMonth);
}

function monthsOf(counter: MonthCounter, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [month, n] of counter.get(key) ?? []) out[month] = n;
  return out;
}

function totalOf(counter: MonthCounter, key: string): number {
  let total = 0;
  for (const [, n] of counter.get(key) ?? []) total += n;
  return total;
}

/** Los doce meses de un año, 'YYYY-01' .. 'YYYY-12'. */
export function monthsOfYearFor(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
}

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

interface ActivityYtdRow {
  loan_officer: string | null;
  /* La vía principal de atribución -- ver `resolveOfficer`. */
  loan_officer_person_code: string | null;
  branch: string | null;
  strategy: string | null;
  nppm_realtor: string | null;
  closing_month: string | null;
}

export async function loadOutlookData(reference: Date = new Date()): Promise<OutlookData> {
  const supabase = getSupabaseClient();

  /*
   * El Business Plan primero: de ahí salen el roster canónico, la proyección
   * del mes, el benchmark de Own Production y el funnel activo. Outlook no
   * duplica ninguno de los cuatro.
   */
  /*
   * ==========================================================================
   * ⚠ LAS CUATRO LECTURAS ARRANCAN JUNTAS — etapa OL6
   * ==========================================================================
   *
   * Antes iban en serie: primero se esperaba el Business Plan entero, después
   * las páginas de `loan_records_v2`, después las cinco tablas de `outlook`, y
   * al final las dos de `org`. Cuatro esperas encadenadas para cuatro cosas que
   * no se necesitan entre sí.
   *
   * Verificado antes de tocarlo: NINGUNA de las tres lecturas de abajo usa nada
   * de `bp`. La consulta de actividad no filtra por mes --el filtro del año se
   * hace en JS, más abajo, con `yearPrefix`-- y los bloques de `outlook` y `org`
   * no miran `currentMonth`. Por eso pueden empezar antes de que el Business
   * Plan termine, sin cambiar un solo número.
   *
   * Se lanzan y se esperan todas en un `Promise.all`: si una falla, el error
   * sale por ahí y ninguna promesa queda sin atender.
   */
  const activityPromise = readAll<ActivityYtdRow>((from, to) =>
    supabase
      .from('loan_records_v2')
      .select('loan_officer, loan_officer_person_code, branch, strategy, nppm_realtor, closing_month')
      .eq('counts_for_division', true)
      .not('closing_month', 'is', null)
      .order('loan_number', { ascending: true })
      .range(from, to)
  );

  const outlookPromise = (async () => {
    const ol = supabase.schema('outlook');
    return Promise.all([
      ol.from('strategy_benchmark').select('*'),
      ol.from('growth_rule').select('*'),
      ol.from('nppm_benchmark').select('*'),
      ol.from('monthly_target').select('*'),
      ol.from('projection_mode').select('*'),
    ]);
  })();

  const orgPromise = Promise.all([
    supabase.schema('org').from('employee_alias').select('*'),
    supabase.schema('org').from('source_name_excluded').select('source_system, name_raw'),
    /*
     * El roster, que desde OL7 decide QUIEN aparece y en QUE branch. Va en el
     * mismo lote paralelo: no depende de nada de lo demas.
     */
    supabase
      .schema('org')
      .from('roster_current')
      .select('person_code, display_name, branch_code, is_producer, is_active'),
    /*
     * `dim_employee` sólo por el NOMBRE y el rol de quien cerró en un branch y
     * no está en la lista del Business Plan. El roster no siempre la tiene: las
     * personas que cerraron y no figuran en el roster no tienen `display_name`.
     */
    supabase.schema('org').from('dim_employee').select('employee_key, full_name, is_branch_manager'),
  ]);

  const [bp, rows, outlookTables, orgTables] = await Promise.all([
    loadBusinessPlanData(reference) as Promise<BusinessPlanData>,
    activityPromise,
    outlookPromise,
    orgPromise,
  ]);

  const currentMonth = bp.diagnostics.pipelineMonths.current;
  const remainingMonths = remainingMonthsOf(currentMonth);
  const yearPrefix = currentMonth.split('-')[0] + '-';
  const monthsOfYear = monthsOfYearFor(Number(currentMonth.split('-')[0]));

  /*
   * Las tablas de `outlook` pueden no existir todavía -- el SQL lo aplica el
   * revisor. Si faltan, el módulo se dibuja con benchmarks en 0 y sin reglas, y
   * lo dice en el diagnóstico. Mismo criterio que el Business Plan usa con sus
   * tablas opcionales: una tabla ausente no debe romper la pantalla.
   */
  let outlookTablesAvailable = false;
  /*
   * ⚠ Ya no es `Map<clave, número>` sino `Map<clave, serie>`: el benchmark
   * vigente depende del MES que se esté proyectando. Ver `benchmarkAt` en
   * `project.ts`.
   */
  const benchmarkScheduleByKey = new Map<string, BenchmarkPoint[]>();
  const rulesByKey = new Map<string, GrowthSegment[]>();
  const nppmScheduleByRealtor = new Map<string, BenchmarkPoint[]>();
  const revisionByKey = new Map<string, number>();
  /* Etapa OL4 — el modo vigente y los meses fijados, por (persona, estrategia). */
  const modeByKey = new Map<string, ProjectionMode>();
  const modeSetByKey = new Map<string, { setBy: string; at: string }>();
  const targetsByKey = new Map<string, Record<string, number>>();
  const targetRevisionByKey = new Map<string, number>();
  let strategyBenchmarkRows = 0;
  let growthRuleRows = 0;
  /* ¿Se pueden leer las dos tablas de OL4? Si no, el modo mes a mes no se ofrece. */
  let monthlyModeAvailable = false;
  const history: OutlookData['history'] = {
    strategyBenchmarks: [],
    nppmBenchmarks: [],
    growthRules: [],
    monthlyTargets: [],
    projectionModes: [],
  };

  /*
   * Una serie desde filas append-only. Dos cosas que parecen detalle y no lo son:
   *
   *   1. Se ordena por `created_at` y la última escrita GANA sobre las anteriores
   *      del mismo `effective_from`. Sin eso, dos ediciones para el mismo mes
   *      --que el modelo permite y no puede evitar, porque no hay UPDATE-- dejan
   *      el resultado a merced del orden en que PostgREST devolvió las filas.
   *   2. NO se filtra por mes: una fila que arranca en noviembre tiene que
   *      quedar en la serie para que noviembre y diciembre la usen. El filtro
   *      viejo (`effective_from > currentMonth -> descartar`) habría tirado
   *      justamente todo lo que escribe el editor, porque todo rige desde el mes
   *      siguiente.
   */
  function scheduleFrom(rows: { effective_from: string; monthly_benchmark: number | string; created_at: string }[]): BenchmarkPoint[] {
    const byMonth = new Map<string, number>();
    for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      byMonth.set(r.effective_from.slice(0, 7), Number(r.monthly_benchmark));
    }
    return [...byMonth.entries()].map(([fromMonth, value]) => ({ fromMonth, value }));
  }

  try {
    /* Ya pedidas arriba, en paralelo con el resto -- ver el bloque de OL6. */
    const [benchRes, ruleRes, nppmRes, targetRes, modeRes] = outlookTables;

    /*
     * ⚠ Las dos tablas de OL4 se leen APARTE de las de OL1, y su error no
     * apaga el módulo.
     *
     * El SQL de esta etapa lo aplica el revisor, así que puede no estar puesto
     * todavía. Si faltara y esto compartiera el `if` con las otras, un 404 acá
     * dejaría la pantalla sin benchmarks NI reglas -- todo el presupuesto en
     * cero por una tabla que sólo hace falta para el segundo modo. Sin fila de
     * modo el módulo se comporta exactamente como en OL3, que es la definición
     * de una etapa que se puede aplicar en dos momentos.
     */
    if (!targetRes.error && !modeRes.error) {
      monthlyModeAvailable = true;
      const modes = (modeRes.data ?? []) as ProjectionModeRow[];
      history.projectionModes = modes;
      /* Vale la fila de `projection_mode_key` más alto -- ver el SQL de OL4. */
      for (const m of [...modes].sort((a, b) => a.projection_mode_key - b.projection_mode_key)) {
        const k = m.employee_key + '|' + m.strategy;
        modeByKey.set(k, m.mode);
        modeSetByKey.set(k, { setBy: m.set_by, at: m.created_at });
      }

      const targets = (targetRes.data ?? []) as MonthlyTargetRow[];
      history.monthlyTargets = targets;
      /* Sólo la revisión más alta de cada par, entera -- igual que las reglas. */
      const maxTargetRev = new Map<string, number>();
      for (const t of targets) {
        const k = t.employee_key + '|' + t.strategy;
        maxTargetRev.set(k, Math.max(maxTargetRev.get(k) ?? 0, t.revision));
      }
      for (const [k, rev] of maxTargetRev) targetRevisionByKey.set(k, rev);
      for (const t of targets) {
        const k = t.employee_key + '|' + t.strategy;
        if (t.revision !== maxTargetRev.get(k)) continue;
        const byMonth = targetsByKey.get(k) ?? {};
        byMonth[t.target_month.slice(0, 7)] = Number(t.target);
        targetsByKey.set(k, byMonth);
      }
    }
    if (!nppmRes.error) {
      const nppmRows = (nppmRes.data ?? []) as NppmBenchmarkRow[];
      history.nppmBenchmarks = nppmRows;
      /* Por nombre normalizado: los datos traen 'FRED A GOMEZ' y 'Fred A Gomez'
         para la misma persona, y el benchmark es uno. */
      const byRealtor = new Map<string, NppmBenchmarkRow[]>();
      for (const n of nppmRows) {
        const k = normName(n.nppm_realtor);
        byRealtor.set(k, [...(byRealtor.get(k) ?? []), n]);
      }
      for (const [k, rows2] of byRealtor) nppmScheduleByRealtor.set(k, scheduleFrom(rows2));
    }
    if (!benchRes.error && !ruleRes.error) {
      outlookTablesAvailable = true;
      const benches = (benchRes.data ?? []) as StrategyBenchmarkRow[];
      history.strategyBenchmarks = benches;
      strategyBenchmarkRows = benches.length;
      /*
       * ⚠ ESTO ESTABA MAL Y NO SE VEÍA PORQUE LA TABLA ESTABA VACÍA.
       *
       * La versión anterior hacía `Math.max(prev, valor)`: se quedaba con el
       * benchmark MÁS ALTO de la historia, no con el más reciente. Con 0 filas
       * daba lo mismo; con el editor puesto, bajar un benchmark de 6 a 4 no
       * habría tenido ningún efecto y la pantalla habría seguido mostrando 6
       * para siempre, sin error, sin aviso y con la fila nueva guardada.
       *
       * Un presupuesto que sólo puede subir no es un presupuesto.
       */
      const benchByKey = new Map<string, StrategyBenchmarkRow[]>();
      for (const b of benches) {
        const k = b.employee_key + '|' + b.strategy;
        benchByKey.set(k, [...(benchByKey.get(k) ?? []), b]);
      }
      for (const [k, rows2] of benchByKey) benchmarkScheduleByKey.set(k, scheduleFrom(rows2));

      const rules = (ruleRes.data ?? []) as GrowthRuleRow[];
      history.growthRules = rules;
      growthRuleRows = rules.length;
      /* Sólo la revisión más alta de cada (empleado, estrategia) -- ver el SQL. */
      const maxRevision = new Map<string, number>();
      for (const r of rules) {
        const k = r.employee_key + '|' + r.strategy;
        maxRevision.set(k, Math.max(maxRevision.get(k) ?? 0, r.revision));
      }
      for (const [k, rev] of maxRevision) revisionByKey.set(k, rev);
      for (const r of [...rules].sort((a, b) => a.segment_order - b.segment_order)) {
        const k = r.employee_key + '|' + r.strategy;
        if (r.revision !== maxRevision.get(k)) continue;
        const list = rulesByKey.get(k) ?? [];
        list.push({
          fromMonth: r.from_month.slice(0, 7),
          cadence: r.cadence,
          growthPct: Number(r.growth_pct),
        });
        rulesByKey.set(k, list);
      }
    }
  } catch {
    /* schema ausente: se dice en el diagnóstico, no se rompe la pantalla. */
  }

  /*
   * Atribución de cada fila a una persona del roster. Se reusa el mismo criterio
   * que BP37 --código de persona primero, nombre después-- pero sin repetir su
   * código: se arma un índice desde los alias que el propio loader ya resolvió.
   *
   * ⚠ El índice se construye por NOMBRE NORMALIZADO y por CÓDIGO a partir de lo
   * que el Business Plan ya sabe de cada persona, así que si mañana cambia la
   * forma de atar, cambia allá y esto la hereda.
   */
  /*
   * ⚠ NO se puede atar por igualdad de nombre contra el roster.
   *
   * `loan_records_v2.loan_officer` trae el nombre de la FUENTE, y el roster
   * tiene el canónico: la misma persona es "Ana Zegarra" en la actividad y
   * "Ana Peña" en `dim_employee`. Comparar los dos nombres habría dejado sin
   * atribuir a todos los que cambiaron de apellido, y el YTD por branch habría
   * salido mal sin que nada fallara.
   *
   * Se usa el mismo índice de alias que el Business Plan, con el mismo orden que
   * fijó BP37: exclusión primero, después el CÓDIGO de persona, y el nombre
   * como respaldo. No se comparte la función porque vive dentro de
   * `loadBusinessPlanData` y sacarla de ahí es refactorizar un archivo que esta
   * etapa no debe tocar -- pero se reusan `buildAliasIndex` y
   * `buildExcludedIndex`, que son las piezas que de verdad importan.
   */
  /* Ya pedidas arriba, en paralelo con el resto -- ver el bloque de OL6. */
  const [aliasRes, excludedRes, rosterRes, employeeRes] = orgTables;
  if (aliasRes.error) throw new Error('org.employee_alias: ' + aliasRes.error.message);
  const aliasIndex = buildAliasIndex((aliasRes.data ?? []) as never[]);
  const excludedIndex = buildExcludedIndex((excludedRes.data ?? []) as never[]);
  const loByKey = new Map<number, LoanOfficerRow>();
  for (const lo of bp.loanOfficers) loByKey.set(lo.employeeKey, lo);

  /*
   * ==========================================================================
   * EL ROSTER, INDEXADO — etapa OL7
   * ==========================================================================
   *
   * ⚠ Si `org.roster_current` no se puede leer, el modulo NO se queda sin
   * lista: cae al comportamiento anterior (los Loan Officers de
   * `dim_employee`). Mismo criterio que las tablas de `outlook` -- una fuente
   * ausente no debe vaciar la pantalla, y queda dicho en el diagnostico.
   */
  const rosterRows = rosterRes.error ? [] : ((rosterRes.data ?? []) as RosterRow[]);
  const rosterAvailable = !rosterRes.error && rosterRows.length > 0;

  const rosterByKey = new Map<number, RosterRow>();
  /* Productores que el roster afirma y que no tienen identidad interna. */
  const producersWithoutIdentity: RosterRow[] = [];
  for (const r of rosterRows) {
    const key = aliasIndex.lookup('person_code', r.person_code).employeeKey;
    if (key === null) {
      if (r.is_producer && r.is_active) producersWithoutIdentity.push(r);
      continue;
    }
    rosterByKey.set(key, r);
  }

  /** El estado de una persona segun el roster. Ver `RosterState`. */
  function rosterStateOf(employeeKey: number): RosterState {
    const r = rosterByKey.get(employeeKey);
    if (!r) return 'unknown';
    if (!r.is_active) return 'left';
    return r.is_producer ? 'producer' : 'not_producing';
  }

  /**
   * A quién pertenece un préstamo. Devuelve la IDENTIDAD, no la fila del
   * Business Plan.
   *
   * ⚠ HASTA OL7 DEVOLVÍA `loByKey.get(...) ?? null`, y eso mezclaba dos
   * preguntas distintas: "¿de quién es este préstamo?" y "¿está esa persona en
   * la lista del Business Plan?". Un `null` por la segunda razón se contaba como
   * préstamo SIN RESOLVER, indistinguible de un nombre desconocido.
   *
   * Lo que eso tapaba, medido: los 3 cierres de Isabel Wagner y Ludwig Aguillon
   * en el 716 resolvían perfecto por `person_code` --alias 21 y 27-- y se
   * descartaban porque las dos son bajas y el Business Plan filtra por
   * `is_active`. Con sus filas afuera el branch 716 no existía en el módulo.
   *
   * Las exclusiones deliberadas siguen intactas: `org.source_name_excluded` se
   * consulta ANTES que cualquier alias, así que la gente de fuera de la división
   * sigue sin resolver y sigue contada en el pie.
   */
  function resolveOfficerKey(row: ActivityYtdRow): number | null {
    const nameRaw = row.loan_officer?.trim() ? row.loan_officer : '(blank)';
    if (nameRaw !== '(blank)' && excludedIndex.has('slquery', nameRaw)) return null;
    const code = row.loan_officer_person_code?.trim();
    if (code) {
      const byCode = aliasIndex.lookup('person_code', code).employeeKey;
      if (byCode !== null) return byCode;
    }
    return aliasIndex.lookup('slquery', nameRaw).employeeKey;
  }

  /*
   * ⚠ EL BRANCH DE UN PRÉSTAMO ES EL DEL PRÉSTAMO, NO EL DE LA PERSONA.
   *
   * La primera versión de este loader agrupaba por `lo.branchCodes` --el branch
   * asignado en el roster-- y los diez YTD de referencia no dieron: 716 marcaba
   * 84 contra 44, Affinity no aparecía, y la suma de las filas excedía el total
   * porque una persona con dos branches sumaba su YTD entero en las dos.
   *
   * La regla correcta ya estaba escrita en el Business Plan
   * (`lib/business-plan/types.ts`): un préstamo se atribuye al branch DEL
   * PRÉSTAMO. Y 'AFFINITY' sólo existe a nivel de préstamo -- nadie lo tiene
   * asignado en el roster, que es por qué esa fila faltaba entera.
   *
   * `classifyBranch` normaliza igual que Commercial Activity: 'Affinity' pasa a
   * 'AFFINITY' y los códigos fuera del roster se agrupan en 'Branch Out of
   * Division'. Sin eso, las mismas 32 filas que ese módulo agrupa quedarían
   * dispersas en cinco branches que la división no tiene.
   */
  /*
   * ==========================================================================
   * ⚠ TODO SE CUENTA POR MES, Y EL AÑO ES LA SUMA — etapa OL3
   * ==========================================================================
   *
   * Hasta OL2 estos contadores eran anuales y el año era el número que se
   * mostraba. Ahora la tabla tiene los doce meses, así que se cuenta por mes y
   * el anual se DERIVA sumando.
   *
   * No es lo mismo que guardar los dos: si el anual se contara aparte, habría
   * dos fórmulas para el mismo dato y la de arriba podría no dar la suma de la
   * de abajo. Contando una sola vez, un total que no cuadra con sus meses es
   * imposible por construcción -- que es el mismo criterio del rollup
   * (estrategia → persona → branch → total).
   */
  const actualByBranch: MonthCounter = new Map();
  const unattributedByBranch = new Map<string, number>();
  const actualByBranchLo: MonthCounter = new Map();
  const actualByLo: MonthCounter = new Map();
  const actualByLoStrategy: MonthCounter = new Map();
  const actualByLoStrategyRealtor: MonthCounter = new Map();
  /*
   * Qué realtors tiene cada (branch, persona, NPPM). Se lleva aparte en vez de
   * barrer las claves con `startsWith`, que es lo que hacía OL1: un nombre de
   * realtor con una barra vertical rompía el corte de la clave y el realtor
   * aparecía con el nombre mutilado. Enumerar desde un conjunto no depende de
   * cómo esté escrito el nombre.
   */
  const realtorsByStrategyKey = new Map<string, Set<string>>();
  let ytdRowsCounted = 0;
  let unresolvedOfficers = 0;
  /*
   * Cierres con mes POSTERIOR al mes en curso. Hoy son cero --`closing_month` es
   * el mes en que un préstamo efectivamente cerró-- y por eso la tabla pinta los
   * meses futuros con el presupuesto y no con lo cerrado. Si algún día dejara de
   * ser cierto, la pantalla estaría tapando producción real con una proyección:
   * se cuenta para poder avisar en vez de descubrirlo por una diferencia.
   */
  let actualsAfterCurrentMonth = 0;

  for (const row of rows) {
    if (!row.closing_month || !row.closing_month.startsWith(yearPrefix)) continue;
    const officerKey = resolveOfficerKey(row);
    if (officerKey === null) {
      unresolvedOfficers += 1;
      const b = classifyBranch(row.branch ?? '');
      unattributedByBranch.set(b, (unattributedByBranch.get(b) ?? 0) + 1);
      continue;
    }
    ytdRowsCounted += 1;
    const month = row.closing_month.slice(0, 7);
    if (month > currentMonth) actualsAfterCurrentMonth += 1;
    const branch = classifyBranch(row.branch ?? '');
    bump(actualByBranch, branch, month);
    bump(actualByBranchLo, branch + '|' + officerKey, month);
    bump(actualByLo, String(officerKey), month);

    const strategy = (OUTLOOK_STRATEGIES as readonly string[]).includes(row.strategy ?? '')
      ? (row.strategy as OutlookStrategy)
      : 'Own Production';
    /*
     * ⚠ La clave lleva el BRANCH. Sin él, el desglose por estrategia de una
     * persona sumaba sus filas de TODOS los branches mientras su fila de LO
     * mostraba sólo las de este -- y las estrategias no daban su total.
     * Medido: Aimmee Buendía cerraba 30 en el 733 y sus estrategias sumaban 31,
     * porque una fila de Own Production de otro branch se colaba.
     */
    const sk = branch + '|' + officerKey + '|' + strategy;
    bump(actualByLoStrategy, sk, month);

    if (strategy === 'NPPM') {
      const realtor = row.nppm_realtor?.trim() || '(no name)';
      bump(actualByLoStrategyRealtor, sk + '|' + realtor, month);
      const set = realtorsByStrategyKey.get(sk) ?? new Set<string>();
      set.add(realtor);
      realtorsByStrategyKey.set(sk, set);
    }
  }

  /*
   * Armado por branch DESDE LAS FILAS. Una persona aparece en un branch si
   * cerró algo en ese branch, no porque el roster la liste ahí -- por eso el
   * YTD de la fila coincide con el de Commercial Activity.
   *
   * Consecuencia buscada: alguien con producción en dos branches aparece en los
   * dos, con la parte que le corresponde a cada uno, y la suma sigue dando su
   * total. Antes aparecía en los dos con el total completo.
   */
  const branchMap = new Map<string, OutlookLoanOfficer[]>();

  /* El desglose de UNA persona EN UN branch. La clave lleva los tres. */
  /*
   * Toma la CLAVE y no la fila del Business Plan --etapa OL7-- porque ahora hay
   * filas que no tienen fila del Business Plan. Sólo usaba `lo.employeeKey`.
   */
  function strategiesOf(employeeKey: number, branchCode: string): StrategyYtd[] {
    return OUTLOOK_STRATEGIES.map((s) => {
      const sk = branchCode + '|' + employeeKey + '|' + s;
      const byRealtor =
        s === 'NPPM'
          ? [...(realtorsByStrategyKey.get(sk) ?? [])]
              .map((realtor) => {
                const schedule = nppmScheduleByRealtor.get(normName(realtor)) ?? [];
                const at = benchmarkAt(schedule, displayMonth);
                return {
                  realtor,
                  ytd: totalOf(actualByLoStrategyRealtor, sk + '|' + realtor),
                  actualByMonth: monthsOf(actualByLoStrategyRealtor, sk + '|' + realtor),
                  benchmark: schedule.length === 0 ? null : at,
                };
              })
              .sort((a, b) => b.ytd - a.ytd || a.realtor.localeCompare(b.realtor))
          : [];
      return {
        strategy: s,
        ytd: totalOf(actualByLoStrategy, sk),
        actualByMonth: monthsOf(actualByLoStrategy, sk),
        byRealtor,
      };
    });
  }

  /*
   * El mes que manda para MOSTRAR un benchmark en la columna: el primero
   * proyectado. Es el que gobierna las celdas proyectadas de esa fila, así que
   * la columna 'Benchmark' y las columnas de meses hablan del mismo número. En
   * diciembre no queda ninguno por proyectar y se cae al mes en curso.
   */
  const displayMonth = remainingMonths[0] ?? currentMonth;

  for (const lo of bp.loanOfficers) {
    const benchmarkSchedules: Partial<Record<OutlookStrategy, BenchmarkPoint[]>> = {};
    const strategyBenchmarks: Partial<Record<OutlookStrategy, number>> = {};
    for (const s of OUTLOOK_STRATEGIES) {
      /*
       * Own Production NO se lee de outlook: viene de org.employee_benchmark.
       * Su serie es de un solo punto que rige desde siempre --el valor vigente
       * que ya resolvió el Business Plan-- para que el motor trate a las cinco
       * estrategias igual y no haya un caso especial dentro del cálculo.
       */
      const schedule: BenchmarkPoint[] =
        s === 'Own Production'
          ? [{ fromMonth: '0000-01', value: lo.monthlyBenchmark ?? 0 }]
          : (benchmarkScheduleByKey.get(lo.employeeKey + '|' + s) ?? []);
      benchmarkSchedules[s] = schedule;
      strategyBenchmarks[s] = benchmarkAt(schedule, displayMonth);
    }

    const rulesByStrategy: Partial<Record<OutlookStrategy, GrowthSegment[]>> = {};
    const ruleRevision: Partial<Record<OutlookStrategy, number>> = {};
    const modeByStrategy: Partial<Record<OutlookStrategy, ProjectionMode>> = {};
    const modeSetBy: Partial<Record<OutlookStrategy, { setBy: string; at: string } | null>> = {};
    const targetsByStrategy: Partial<Record<OutlookStrategy, Record<string, number>>> = {};
    const targetRevision: Partial<Record<OutlookStrategy, number>> = {};
    for (const s of OUTLOOK_STRATEGIES) {
      const k = lo.employeeKey + '|' + s;
      rulesByStrategy[s] = rulesByKey.get(k) ?? [];
      ruleRevision[s] = revisionByKey.get(k) ?? 0;
      /* Sin fila de modo, `growth`: es como se comportaba el módulo antes. */
      modeByStrategy[s] = modeByKey.get(k) ?? 'growth';
      modeSetBy[s] = modeSetByKey.get(k) ?? null;
      targetsByStrategy[s] = targetsByKey.get(k) ?? {};
      targetRevision[s] = targetRevisionByKey.get(k) ?? 0;
    }

    const row: OutlookLoanOfficer = {
      employeeKey: lo.employeeKey,
      fullName: lo.fullName,
      branchCodes: lo.branchCodes,
      ytd: totalOf(actualByLo, String(lo.employeeKey)),
      actualByMonth: monthsOf(actualByLo, String(lo.employeeKey)),
      currentMonth: lo.projection.projectedTotal,
      /*
       * ⚠ Lo que YA CERRÓ del mes en curso, y que va DENTRO de `currentMonth`.
       *
       * `projectedTotal = closedToDate + CTC + Closing + tasa` (ver
       * `projectCurrentMonth` en el Business Plan). O sea que el pronóstico del
       * mes ya incluye lo cerrado del mes: por eso la columna del mes en curso
       * no se puede sumar con lo real del mes, y por eso este número está acá --
       * para poder decirlo en el tooltip en vez de que alguien lo deduzca.
       */
      closedToDate: lo.projection.closedToDate,
      /*
       * ⚠ Sólo las estrategias en modo `growth` — etapa OL4.
       *
       * El benchmark es la BASE de un cálculo. Una estrategia fijada mes a mes
       * no tiene base: sus meses son el resultado directo. Sumar su benchmark
       * guardado --que sigue ahí, sin aplicarse-- daría un total que no es la
       * base de nada y que no explica ninguna celda de la fila.
       */
      benchmarkTotal: OUTLOOK_STRATEGIES.reduce(
        (a, s) => a + (modeByStrategy[s] === 'monthly' ? 0 : (strategyBenchmarks[s] ?? 0)),
        0
      ),
      ownProductionBenchmark: lo.monthlyBenchmark,
      activePlan: lo.activePlan,
      /*
       * ⚠ El branch al que se le carga el pronostico y el presupuesto sale del
       * ROSTER cuando el roster conoce a la persona — etapa OL7.
       *
       * Antes salia de `lo.branchCodes[0]`, de `org.employee_branch`. El roster
       * tiene el branch correcto: Johann Otiniano figura en el 716 por
       * `employee_branch` y en el 710 por el roster, que es la licencia
       * prestada. Y da UN branch por persona, asi que nadie puede aparecer en
       * dos listas.
       */
      primaryBranch: rosterByKey.get(lo.employeeKey)?.branch_code ?? lo.branchCodes[0] ?? null,
      rosterState: rosterStateOf(lo.employeeKey),
      hasIdentity: true,
      isBranchManager: lo.isBranchManager,
      /* Placeholder: se reemplaza por branch al armar el mapa, abajo. */
      strategies: [],
      rulesByStrategy,
      ruleRevision,
      strategyBenchmarks,
      benchmarkSchedules,
      modeByStrategy,
      modeSetBy,
      targetsByStrategy,
      targetRevision,
    };
    /*
     * En qué branches aparece: donde CERRÓ algo este año, más los del roster si
     * no cerró en ninguno (para que alguien sin producción todavía se vea en su
     * branch en vez de desaparecer del módulo).
     */
    const branchesWithProduction = [...actualByBranchLo.keys()]
      .filter((k) => k.endsWith('|' + lo.employeeKey))
      .map((k) => k.slice(0, k.length - ('|' + lo.employeeKey).length));

    /*
     * ==========================================================================
     * ⚠ EN QUE BRANCHES APARECE — la regla cambio en OL7
     * ==========================================================================
     *
     * Aparece en:
     *   - el branch que le da el ROSTER, si el roster dice que produce y esta
     *     activa. Asi un productor nuevo se ve en su branch desde el primer dia,
     *     sin haber cerrado nada todavia.
     *   - los branches donde CERRO este anio, cualquiera sea su estado.
     *
     * Lo segundo es lo que hace que el total del branch cuadre con la suma de
     * sus filas. Isabel Wagner y Ludwig Aguillon son bajas de RRHH con 3
     * cierres de division entre las dos en el 716 este anio: su produccion es
     * real y ya ocurrio. Sin su fila, el YTD del branch tendria 3 prestamos sin
     * dueno visible -- un descuadre sin explicacion, peor que una fila
     * incompleta.
     *
     * ⚠ Rene Perez (733) es el TERCER productor inactivo del roster y NO
     * aparece: no cerro nada este anio, asi que no hay produccion huerfana que
     * explicar. Que la regla lo deje afuera solo es la prueba de que la fila la
     * trae la produccion y no el estado.
     *
     * El fallback a `lo.branchCodes` es para cuando el roster no se puede leer:
     * ver el bloque del roster indexado, mas arriba.
     */
    const rosterEntry = rosterByKey.get(lo.employeeKey);
    const belongsByRoster =
      rosterEntry && rosterEntry.is_producer && rosterEntry.is_active && rosterEntry.branch_code
        ? [rosterEntry.branch_code]
        : [];
    /*
     * ⚠ SIN ROSTER, LA REGLA ANTERIOR EXACTA -- no la union.
     *
     * Esto no es cosmetico: `branchesWithProduction` y `lo.branchCodes` eran
     * alternativos ("donde cerro, y si no cerro, donde figura"), y unirlos
     * duplica filas. Medido con el roster ilegible: Gian Laino aparecia en 710
     * (por `employee_branch`), 760 y AFFINITY (por produccion) -- tres filas
     * para una persona, y el total de la division contandola tres veces.
     */
    const codes = rosterAvailable
      ? [...new Set([...belongsByRoster, ...branchesWithProduction])]
      : branchesWithProduction.length > 0
        ? branchesWithProduction
        : lo.branchCodes;

    for (const code of codes) {
      const list = branchMap.get(code) ?? [];
      /* El YTD y el desglose de la persona EN ESE BRANCH, no sus totales. */
      list.push({
        ...row,
        ytd: totalOf(actualByBranchLo, code + '|' + lo.employeeKey),
        actualByMonth: monthsOf(actualByBranchLo, code + '|' + lo.employeeKey),
        strategies: strategiesOf(lo.employeeKey, code),
      });
      branchMap.set(code, list);
    }
  }

  /*
   * ==========================================================================
   * ⚠ LAS PERSONAS QUE EL BUSINESS PLAN NO TRAE — etapa OL7
   * ==========================================================================
   *
   * `bp.loanOfficers` NO es la lista de Outlook, y confundirlas fue el error que
   * hizo falta medir para ver. Esa lista está filtrada dos veces:
   *
   *   - `org.employee_branch.role_in_branch = 'LO'`, que deja afuera a quien
   *     sólo tiene fila 'BM'  →  Abel Berrocal (728), productor activo. Es
   *     literalmente "el BM que se pierde".
   *   - `org.dim_employee.is_active`, que deja afuera a las bajas  →  Isabel
   *     Wagner y Ludwig Aguillon (716), con 3 cierres reales entre las dos. Con
   *     ellas afuera el branch 716 desaparecía ENTERO del módulo.
   *
   * Y quien no tiene ninguna fila en `employee_branch` tampoco entra: Lucio
   * Romero (703), productor activo del roster.
   *
   * Estas filas NO PROYECTAN, y es deliberado: el benchmark de Own Production y
   * el pronóstico del mes en curso los resuelve el loader del Business Plan
   * --una regla, un solo lugar-- y copiar esa resolución acá crearía una segunda
   * versión que se desincroniza sin que nadie lo note. Muestran lo que sí es
   * verdad: los meses REALES, el nombre, el branch y el rol.
   *
   * ⚠ LÍMITE CONOCIDO, medido y hoy sin costo: si alguna de estas personas
   * tuviera benchmark en `org.employee_benchmark`, no se mostraría. Hoy Abel y
   * Lucio tienen 0 benchmarks y 0 reglas, así que no se pierde nada; Isabel y
   * Ludwig tienen 1 benchmark y 5 reglas cada una, pero son bajas y proyectar su
   * producción futura sería inventarla. El arreglo de fondo es ensanchar el
   * filtro del Business Plan, que cambia SU pantalla y no entra acá.
   */
  const employeeRows = employeeRes.error
    ? []
    : ((employeeRes.data ?? []) as { employee_key: number; full_name: string; is_branch_manager: boolean }[]);
  const employeeByKey = new Map(employeeRows.map((e) => [e.employee_key, e]));

  const bpKeys = new Set(bp.loanOfficers.map((lo) => lo.employeeKey));

  /* Quien cerró este año, y en qué branches. */
  const productionByKey = new Map<number, Set<string>>();
  for (const k of actualByBranchLo.keys()) {
    const sep = k.lastIndexOf('|');
    const code = k.slice(0, sep);
    const key = Number(k.slice(sep + 1));
    if (!Number.isFinite(key)) continue;
    const set = productionByKey.get(key) ?? new Set<string>();
    set.add(code);
    productionByKey.set(key, set);
  }

  /*
   * Las claves que faltan: quien cerró, más los productores activos del roster,
   * menos quien ya vino del Business Plan.
   *
   * ⚠ LOS DOS ORÍGENES SE TRATAN DISTINTO CUANDO EL ROSTER NO SE PUEDE LEER, y
   * la diferencia no es teórica:
   *
   *   - Quien CERRÓ entra SIEMPRE. Su préstamo ya está sumado en el total del
   *     branch, así que sin su fila el branch muestra un total que no es la suma
   *     de sus filas. Medido en el fallback: los 3 cierres de Isabel y Ludwig se
   *     contaban en el 716 y no había ninguna fila que los explicara.
   *   - Los productores SIN producción entran sólo si el roster se pudo leer,
   *     porque es el roster el que dice que producen. Sin él no hay nada que
   *     afirmarlo, y la lista se queda con el comportamiento anterior.
   */
  const missingKeys = new Set<number>();
  for (const key of productionByKey.keys()) if (!bpKeys.has(key)) missingKeys.add(key);
  if (rosterAvailable) {
    for (const [key, r] of rosterByKey) {
      if (r.is_producer && r.is_active && !bpKeys.has(key)) missingKeys.add(key);
    }
  }

  for (const key of missingKeys) {
    const r = rosterByKey.get(key);
    const name = r?.display_name ?? employeeByKey.get(key)?.full_name ?? null;
    /* Sin nombre no hay fila que mostrar: sería un renglón anónimo. */
    if (!name) continue;

    const belongsByRoster = r && r.is_producer && r.is_active && r.branch_code ? [r.branch_code] : [];
    const codes = [...new Set([...belongsByRoster, ...(productionByKey.get(key) ?? [])])];

    for (const code of codes) {
      const list = branchMap.get(code) ?? [];
      const months = monthsOf(actualByBranchLo, code + '|' + key);
      list.push({
        employeeKey: key,
        fullName: name,
        branchCodes: codes,
        ytd: totalOf(actualByBranchLo, code + '|' + key),
        actualByMonth: months,
        /*
         * El mes en curso es lo REAL cerrado, no un pronóstico: el pronóstico lo
         * calcula el Business Plan y esta persona no está en su lista. Mismo
         * criterio que AFFINITY -- pronóstico si proyecta, y si no, lo cerrado.
         */
        currentMonth: months[currentMonth] ?? 0,
        closedToDate: months[currentMonth] ?? 0,
        benchmarkTotal: 0,
        ownProductionBenchmark: null,
        activePlan: null,
        primaryBranch: r?.branch_code ?? codes[0] ?? null,
        strategies: strategiesOf(key, code),
        rulesByStrategy: {},
        ruleRevision: {},
        strategyBenchmarks: {},
        benchmarkSchedules: {},
        modeByStrategy: {},
        modeSetBy: {},
        targetsByStrategy: {},
        targetRevision: {},
        rosterState: rosterStateOf(key),
        hasIdentity: true,
        isBranchManager: employeeByKey.get(key)?.is_branch_manager ?? false,
      });
      branchMap.set(code, list);
    }
  }

  /*
   * Los productores que el roster afirma y que no tienen `employee_key`.
   *
   * Se muestran con su nombre y su branch, sin benchmark, sin plan y sin
   * proyeccion: los tres cuelgan de `employee_key`. Hoy son 0 de 38, y ese cero
   * esta en el diagnostico justamente para que se note el dia que cambie.
   *
   * ⚠ `employeeKey` va en negativo para no colisionar con ninguno real: es una
   * clave de render, no una identidad. Nada la persiste ni la busca en la base.
   */
  producersWithoutIdentity.forEach((r, i) => {
    if (!r.branch_code) return;
    const list = branchMap.get(r.branch_code) ?? [];
    list.push({
      employeeKey: -(i + 1),
      fullName: r.display_name,
      branchCodes: [r.branch_code],
      ytd: 0,
      actualByMonth: {},
      currentMonth: 0,
      closedToDate: 0,
      benchmarkTotal: 0,
      ownProductionBenchmark: null,
      activePlan: null,
      primaryBranch: r.branch_code,
      strategies: OUTLOOK_STRATEGIES.map((st) => ({ strategy: st, ytd: 0, actualByMonth: {}, byRealtor: [] })),
      rulesByStrategy: {},
      ruleRevision: {},
      strategyBenchmarks: {},
      benchmarkSchedules: {},
      modeByStrategy: {},
      modeSetBy: {},
      targetsByStrategy: {},
      targetRevision: {},
      rosterState: 'producer',
      hasIdentity: false,
      isBranchManager: false,
    });
    branchMap.set(r.branch_code, list);
  });

  const branches: OutlookBranch[] = [...branchMap.entries()]
    .map(([branchCode, los]) => ({
      branchCode,
      /* El YTD del branch sale de las FILAS, no de sumar personas: así no
         depende de que la atribución por persona esté completa. */
      ytd: totalOf(actualByBranch, branchCode),
      actualByMonth: monthsOf(actualByBranch, branchCode),
      /*
       * Sólo de quienes tienen ESTE branch como primario: la proyección de una
       * persona es un número por persona y no se puede repartir entre branches.
       * Sumar `l.currentMonth` de todos los que aparecen acá contaría dos veces
       * a quien produce en dos branches.
       */
      currentMonth: los
        .filter((l) => l.primaryBranch === branchCode)
        .reduce((a, l) => a + l.currentMonth, 0),
      /* La parte ya cerrada de ese pronóstico, con el mismo filtro. */
      closedToDate: los
        .filter((l) => l.primaryBranch === branchCode)
        .reduce((a, l) => a + l.closedToDate, 0),
      unattributed: unattributedByBranch.get(branchCode) ?? 0,
      loanOfficers: los.sort((a, b) => b.ytd - a.ytd || a.fullName.localeCompare(b.fullName)),
    }))
    .sort((a, b) => b.ytd - a.ytd || a.branchCode.localeCompare(b.branchCode));

  return {
    remainingMonths,
    currentMonth,
    monthsOfYear,
    actualMonths: monthsOfYear.filter((m) => m < currentMonth),
    branches,
    effectiveFrom: addMonths(currentMonth, 1) + '-01',
    history,
    diagnostics: {
      activityRowsRead: rows.length,
      ytdRowsCounted,
      strategyBenchmarkRows,
      growthRuleRows,
      outlookTablesAvailable,
      unresolvedOfficers,
      actualsAfterCurrentMonth,
      /*
       * Las DOS lecturas de "cuánto cerró el mes en curso", que salen de dos
       * sistemas distintos y no tienen por qué coincidir:
       *   - `closedRecords`  cierres del mes en `loan_records_v2` (la fuente de
       *                      la banda real)
       *   - `closedForecast` `closedToDate` de Forecast, sobre
       *                      `pipeline_resolved_loans` (lo que está DENTRO del
       *                      pronóstico del mes)
       * Se exponen las dos para que una diferencia se pueda explicar en la
       * pantalla en vez de aparecer como un descuadre. Es el mismo caso que los
       * 57 contra 59 de julio en Commercial Activity: dos criterios legítimos.
       */
      currentMonthClosedRecords: branches.reduce((a, b) => a + (b.actualByMonth[currentMonth] ?? 0), 0),
      currentMonthClosedForecast: branches.reduce((a, b) => a + b.closedToDate, 0),
      producersWithoutIdentity: producersWithoutIdentity.length,
      closedButNotProducing: branches.reduce(
        (a, b) =>
          a + b.loanOfficers.filter((l) => l.rosterState === 'left' || l.rosterState === 'not_producing').length,
        0
      ),
      activeProducers: rosterRows.filter((r) => r.is_producer && r.is_active).length,
      /*
       * ⚠ Va a la pantalla porque un roster ilegible NO se nota mirando: la
       * lista sigue llena, con la gente de `employee_branch`, y los numeros son
       * plausibles. Asi se descubrio -- la pantalla parecia bien y estaba dando
       * la lista vieja. Ademas `org.roster_current` devuelve cero filas SIN
       * error cuando la policy no aplica: la RLS no rechaza, filtra.
       */
      rosterAvailable,
      monthlyModeAvailable,
    },
  };
}



/*
 * ============================================================================
 * EL ROLLUP — de estrategia a Loan Officer a branch (etapa OL1)
 * ============================================================================
 *
 * ⚠ El número se construye DESDE LA ESTRATEGIA hacia arriba, nunca al revés:
 *
 *     estrategia → Loan Officer → branch → total
 *
 * Cada nivel es la SUMA del de abajo, sin ningún cálculo propio. Por eso un
 * total no puede discrepar de sus partes: no hay una segunda fórmula que pueda
 * divergir, hay una suma.
 */

import { projectPlan, type ProjectionStep } from './project';

/**
 * El plan de una estrategia: el modo que rige y los datos de los DOS modos.
 *
 * ⚠ Vive acá y no en `project.ts` a propósito. `project.ts` es aritmética pura y
 * no conoce al Loan Officer ni a la base; si importara `OutlookLoanOfficer` para
 * escribir esta función, el motor pasaría a depender del loader y dejaría de
 * poder probarse solo. Esto es la traducción entre los dos, y es de este lado.
 */
export function planOf(lo: OutlookLoanOfficer, strategy: OutlookStrategy): StrategyPlan {
  return {
    mode: lo.modeByStrategy[strategy] ?? 'growth',
    benchmarks: lo.benchmarkSchedules[strategy] ?? [],
    segments: lo.rulesByStrategy[strategy] ?? [],
    targets: lo.targetsByStrategy[strategy] ?? {},
  };
}

/** La proyección de un Loan Officer: la suma de sus cinco estrategias. */
export function projectLoanOfficer(
  lo: OutlookLoanOfficer,
  months: string[]
): { byMonth: Record<string, number>; stepsByStrategy: Partial<Record<OutlookStrategy, ProjectionStep[]>> } {
  const byMonth: Record<string, number> = {};
  const stepsByStrategy: Partial<Record<OutlookStrategy, ProjectionStep[]>> = {};

  for (const s of OUTLOOK_STRATEGIES) {
    /*
     * ⚠ UNA SOLA PUERTA. `projectPlan` decide si los meses se calculan (modo
     * `growth`, benchmark resuelto mes por mes con `benchmarkAt`) o se leen del
     * número fijado (modo `monthly`). La vista previa del editor llama a la
     * misma función con el plan del formulario, así que no puede mostrar algo
     * que después la tabla no muestre.
     */
    const steps = projectPlan(months, planOf(lo, s));
    stepsByStrategy[s] = steps;
    for (const step of steps) {
      byMonth[step.month] = (byMonth[step.month] ?? 0) + step.value;
    }
  }
  return { byMonth, stepsByStrategy };
}

/** La de un branch: la suma de sus Loan Officers. */
export function projectBranch(branch: OutlookBranch, months: string[]): Record<string, number> {
  const byMonth: Record<string, number> = {};
  for (const m of months) byMonth[m] = 0;
  for (const lo of branch.loanOfficers) {
    /* Mismo criterio que el mes actual: la proyección de una persona se carga
       a su branch de roster, una sola vez. Ver `primaryBranch`. */
    if (lo.primaryBranch !== branch.branchCode) continue;
    const { byMonth: loMonths } = projectLoanOfficer(lo, months);
    for (const m of months) byMonth[m] += loMonths[m] ?? 0;
  }
  return byMonth;
}

/*
 * ============================================================================
 * LOS DOCE MESES DE UNA FILA — etapa OL3
 * ============================================================================
 *
 * Una fila del año se arma de tres pedazos que NO se solapan:
 *
 *     ene … jul   real         cerrado, de `loan_records_v2`
 *     ago         pronóstico   de Forecast, vía el Business Plan
 *     sep … dic   presupuesto  benchmark × regla de crecimiento
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL DOBLE CONTEO QUE ESTO ELIMINA, Y QUE LA VERSIÓN ANTERIOR TENÍA
 * ---------------------------------------------------------------------------
 * Hasta OL2 la fila era `YTD | mes en curso | sep..dic | total`, y el total era
 * `yearTotal = ytd + mesEnCurso + proyectados`.
 *
 * Las dos primeras se SOLAPAN. `YTD` son los cerrados del año --agosto
 * incluido-- y el pronóstico del mes es `closedToDate + CTC + Closing + tasa`,
 * o sea que TAMBIÉN incluye lo cerrado de agosto. Medido: 30 préstamos cerrados
 * en agosto estaban contados en las dos columnas, y el total del año salía
 * ~30 alto sobre 650. Nada fallaba, los dos números eran correctos por
 * separado, y la suma estaba mal.
 *
 * Con los doce meses el error no se puede cometer: cada mes es UNA columna y el
 * total es la suma de las doce. Que agosto sea "pronóstico que ya incluye lo
 * cerrado" pasa de ser una trampa a ser el contenido de una celda.
 *
 * ---------------------------------------------------------------------------
 * `null` NO ES CERO
 * ---------------------------------------------------------------------------
 * Una celda en `null` es "no se puede saber" y sale como `—`; un 0 es "cero" y
 * sale como `–`. La diferencia importa en las filas de estrategia, donde el mes
 * en curso es `null` porque Forecast no lo abre por estrategia. Un 0 ahí diría
 * que la estrategia no va a cerrar nada en agosto, que es una afirmación que
 * nadie hizo.
 *
 * Y por eso el total devuelve además `hasUnknown`: un total al que le falta un
 * mes tiene que poder decirlo, o se lee como comparable con el de al lado.
 */
export interface YearRow {
  byMonth: Record<string, number | null>;
  /** La suma de las celdas conocidas. */
  total: number;
  /** Hay algún mes en `null`, así que el total no cubre el año entero. */
  hasUnknown: boolean;
}

export function composeYear(
  monthsOfYear: string[],
  currentMonth: string,
  actualByMonth: Record<string, number>,
  /** El pronóstico del mes en curso, o `null` si no se puede abrir así. */
  forecast: number | null,
  projected: Record<string, number | null>
): YearRow {
  const byMonth: Record<string, number | null> = {};
  let total = 0;
  let hasUnknown = false;

  for (const m of monthsOfYear) {
    const value = m < currentMonth ? (actualByMonth[m] ?? 0) : m === currentMonth ? forecast : (projected[m] ?? null);
    byMonth[m] = value;
    if (value === null) hasUnknown = true;
    else total += value;
  }
  return { byMonth, total, hasUnknown };
}
