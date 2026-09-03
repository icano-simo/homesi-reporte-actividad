'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import { buildAliasIndex, buildExcludedIndex } from '@/lib/business-plan/aliasIndex';
import {
  DEFAULT_RAMP,
  classifyRecruit,
  defaultProducingFrom,
  notProjectingReason,
  projectRecruit,
  type NotProjectingReason,
  type Ramp,
  type RecruitStage,
} from '@/lib/outlook/recruitment';
import { classifyBranch } from '@/lib/domain/classifyBranch';
import { classifyStrategy } from '@/lib/pipeline/strategy';
import { apportionByWeight } from '@/lib/pipeline/aggregate';
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
  employee_key: number | null;
  branch_code: string | null;
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
  employee_key: number | null;
  branch_code: string | null;
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
  employee_key: number | null;
  branch_code: string | null;
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
  employee_key: number | null;
  branch_code: string | null;
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

  /**
   * El pronóstico del mes de esta persona, repartido por estrategia — OL12.
   * Suma exactamente `currentMonth`. Ver `currentMonthRaw` en `BranchStrategy`.
   */
  currentMonthByStrategy: Partial<Record<OutlookStrategy, number>>;
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

/**
 * Un realtor NPPM en UN branch — etapa OL8.
 *
 * ⚠ LA PRODUCCIÓN ES POR BRANCH Y EL BENCHMARK ES GLOBAL, y la asimetría es
 * real, no un descuido. `outlook.nppm_benchmark` tiene una fila por realtor, sin
 * branch: el mismo realtor trabaja con varias personas y en varios branches, y
 * el negocio decidió un número por realtor. Pero su producción sí es de un
 * branch, así que el DEFAULT --el promedio de sus 3 meses cerrados-- se calcula
 * por branch.
 *
 * Consecuencia medida, que hay que saber antes de editar: Laura Delgado tiene 4
 * cierres en el 733 (promedio 1,33) y 5 en el 776 (promedio 0,67, porque sólo 2
 * caen en la ventana). Sus defaults difieren; el día que alguien le fije un
 * benchmark, ese valor único rige en los dos branches. La pantalla lo dice en el
 * tooltip.
 */
/**
 * El realtor de un préstamo NPPM al que nadie le cargó el realtor.
 *
 * ⚠ SE MUESTRA, no se oculta: sin esta fila el total de NPPM del branch no daría
 * la suma de sus realtors, y un descuadre sin explicación es peor que una fila
 * incompleta. Dice `unassigned realtor` y no `(no name)` para que se lea como lo
 * que es --un dato que falta en el origen-- y no como una categoría de realtor.
 *
 * Hoy es uno: un préstamo NPPM de Aimmee Buendía en el 733.
 */
export const UNASSIGNED_REALTOR = 'unassigned realtor';

/** Ídem para el dueño de una oportunidad Affinity que no es una persona. */
export const UNASSIGNED_OWNER = 'unassigned owner';

export interface BranchRealtor {
  realtor: string;
  ytd: number;
  actualByMonth: Record<string, number>;
  /**
   * El promedio de cierres de los 3 meses CERRADOS -- mayo, junio y julio hoy.
   * Es el benchmark por defecto y sale del dato, no de una decisión.
   */
  avg3m: number;
  /** El benchmark vigente: el guardado si hay, y si no `avg3m`. */
  benchmark: number;
  /** `true` si nadie lo fijó y el que rige es `avg3m`. */
  benchmarkIsDefault: boolean;
}

/**
 * Una estrategia EN UN BRANCH, y por quién se abre.
 *
 * ==========================================================================
 * POR QUÉ SE ABRE CADA UNA — el estado actual
 * ==========================================================================
 *
 *   Own Production   por LOAN OFFICER. Es producción propia: la pregunta es
 *                    cuánto hace cada uno.
 *   Recruitment      por LOAN OFFICER, desde OL12. En el 710 la producción ES
 *                    Recruitment --27 de sus cierres del año-- y ahí la
 *                    pregunta vuelve a ser quién trae cuánto.
 *   NPPM             por REALTOR. El préstamo lo trae el realtor; qué Loan
 *                    Officer lo procesó no es la unidad de decisión.
 *   Affinity         por DUEÑO DE LA OPORTUNIDAD, que acá es un Account
 *                    Executive (OL13, presupuesto propio en OL14).
 *   B2B              por DUEÑO DE LA OPORTUNIDAD, que acá es un Business
 *                    Developer (OL15). Es la misma `opportunity_owner` que
 *                    Affinity y comparten mecanismo: `opensBy: 'owner'`.
 *
 * ⚠ NINGUNA ES YA `'branch'`. La variante existe en el tipo y hoy no la usa
 * ninguna estrategia -- ver `esDelBranch` en la vista. Se conserva porque
 * quedan dos presupuestos guardados con `branch_code` que no se pueden
 * reasignar (ver docs/sql/2026-09-outlook-retire-branch-code.sql).
 *
 * ---------------------------------------------------------------------------
 * ⚠ ESTE BLOQUE DECÍA LO CONTRARIO Y SE CORRIGIÓ
 * ---------------------------------------------------------------------------
 * Hasta esta corrección afirmaba que B2B, Recruitment y Affinity "NO SE ABREN,
 * son del branch". Era cierto en OL8 y dejó de serlo en OL12, OL13 y OL15, una
 * por una, sin que nadie volviera acá. Tres de cinco líneas mentían, y el
 * comentario que las contradecía estaba a mil trescientas líneas de distancia.
 *
 * ---------------------------------------------------------------------------
 * ⚠ QUIÉNES APARECEN AL ABRIR, Y QUÉ NO SE FILTRA TODAVÍA
 * ---------------------------------------------------------------------------
 * Una estrategia que se abre por Loan Officer muestra a TODOS los del branch,
 * tengan o no producción en ella. Medido en el 710: Recruitment abre las 7
 * filas y dos --Johann Otiniano y Jose Arango-- están enteras en cero.
 *
 * No está filtrado a propósito: el filtro correcto necesita saber QUIÉN
 * participa del programa de reclutamiento, y ese dato llega con el pipeline de
 * RC1. Filtrar hoy por "tiene producción" escondería a alguien que participa y
 * todavía no cerró, que es justo a quien hay que fijarle un presupuesto.
 *
 * ⚠ `actualByMonth` cuenta TODOS los cierres del branch en esa estrategia,
 * incluidos los de gente que no tiene fila. Por eso el total del branch cuadra
 * con la suma de sus estrategias aunque una estrategia no cuadre con la suma de
 * sus filas: en el 710, los 3 cierres de Recruitment de Jonathan Valenzuela
 * están en la estrategia y él no tiene fila --su branch de roster es el 777--.
 */
/**
 * ============================================================================
 * EL DUEÑO DE LA OPORTUNIDAD — un mecanismo, dos estrategias (etapa OL15)
 * ============================================================================
 *
 * `opportunity_owner` de `loan_records_v2`. Quién procesó el préstamo --el Loan
 * Officer-- no es la unidad de decisión de estas estrategias:
 *
 *   Affinity   el dueño es un ACCOUNT EXECUTIVE. Hoy Shirley Camargo y David
 *              Alvarez, más el usuario de sistema.
 *   B2B        el dueño es un BUSINESS DEVELOPER, que es exactamente cómo
 *              `classifyStrategy` de Forecast define B2B: `Opportunity Owner:
 *              Title = 'Business Developer'`. Hoy son siete con cierres, y los
 *              siete resuelven a `employee_key`.
 *
 * ⚠ ESTO ES LA SIMPLIFICACIÓN, no un caso más. Antes B2B era la única estrategia
 * cuyo presupuesto colgaba de un BRANCH y no de una persona, así que el modelo
 * tenía DOS formas de pertenencia y cada consulta tenía que preguntarse cuál
 * aplicaba. Ahora las cinco cuelgan de personas: Loan Officers, realtors o
 * dueños de oportunidad. La única diferencia entre ellas es el cargo.
 *
 * ⚠ Los dueños trabajan CRUZANDO BRANCHES --Annie Garrido cierra en el 716 y en
 * el 747, Josue Toro en el 150 y el 733-- así que su fila es por (branch, dueño)
 * y no por dueño: la tabla mide un branch.
 */
export interface BranchOwner {
  /** El nombre tal como viene, o el rótulo del usuario de sistema. */
  owner: string;
  ytd: number;
  actualByMonth: Record<string, number>;
  /**
   * ⚠ Su identidad interna, o `null` si no es una persona.
   *
   * Los dos Account Executives ya estaban en `org.dim_employee` con sus alias
   * --Shirley Camargo 109, David Alvarez 82-- así que las cuatro tablas de
   * `outlook` los soportan sin ningún cambio: cuelgan de `employee_key` y el
   * CHECK XOR ya admite persona o branch. No hizo falta SQL.
   */
  employeeKey: number | null;
  /**
   * ⚠ SU PRESUPUESTO, igual que el de un Loan Officer — etapa OL14.
   *
   * Affinity dejó de presupuestarse a nivel branch: cada AE tiene su benchmark,
   * su regla de crecimiento y su modo mes a mes. Son los mismos siete campos que
   * `OutlookLoanOfficer`, así que el editor los toma sin distinguir de qué sujeto
   * vienen.
   *
   * Vacíos en el usuario de sistema: no hay a quién pedirle un presupuesto.
   */
  benchmarkSchedule: BenchmarkPoint[];
  benchmarkAtDisplay: number;
  rules: GrowthSegment[];
  ruleRevision: number;
  mode: ProjectionMode;
  modeSetBy: { setBy: string; at: string } | null;
  targets: Record<string, number>;
  targetRevision: number;
  /**
   * ⚠ `false` = no es una persona: es un usuario de sistema.
   *
   * Sus cierres son REALES y se muestran --sin fila, el total de la estrategia no
   * daría la suma de sus filas-- pero no se le puede pedir un presupuesto ni
   * atribuirle desempeño. Se rotula `unassigned owner` para que se lea como un
   * dato que falta en el origen y no como una persona con un nombre raro.
   */
  isPerson: boolean;
}

/** Una fila de `activity_report.future_loan_officer`, tal como llega. */
interface FutureLoRow {
  nombre: string;
  origen: string;
  confianza: string;
  branch_code: string | null;
  cargo: string | null;
  fecha_inicio: string | null;
  close_date: string | null;
  nmls_number: string | null;
  es_nppm: boolean;
  id_fuente: string | null;
}

/** Una fila de `outlook.recruitment_projection`. La vigente es la de `revision` más alta. */
interface RecruitProjectionRow {
  identity: string;
  revision: number;
  source: string;
  person_name: string;
  role: string;
  branch_code: string;
  start_date: string | null;
  producing_from: string;
  monthly_benchmark: number | string | null;
  nmls: string | null;
}

interface RecruitRampRow {
  revision: number;
  month_1_pct: number | string;
  month_2_pct: number | string;
  month_3_plus_pct: number | string;
}

/** Una fila de `outlook.recruitment_link`. La vigente es la más reciente por `identity`. */
interface RecruitLinkRow {
  identity: string;
  employee_key: number | null;
  created_at: string;
}

/**
 * ============================================================================
 * UNA PERSONA EN PROCESO DE CONTRATACIÓN — etapa OL20
 * ============================================================================
 *
 * No está en el roster todavía. Sale de `activity_report.future_loan_officer`
 * --filtrada por `producira`, NO por `confianza`: de los 6 con
 * `confianza = 'confirmado'` hay 4 que no producen-- y de las tres tablas de
 * `outlook` que guardan lo que se editó encima.
 *
 * ⚠ NO ES UN `OutlookLoanOfficer` Y NO DEBE SERLO. Un Loan Officer del roster
 * tiene `employee_key`, producción real por mes y cinco estrategias; esto tiene
 * un nombre, una fecha y una expectativa. Forzarlos al mismo tipo haría que
 * cualquier código que recorra `loanOfficers` empezara a sumar proyecciones sin
 * saberlo -- que es exactamente el doble conteo que la etapa evita.
 */
export interface BranchRecruit {
  /** La clave estable: `future:<id_fuente>` o `manual:<uuid>`. Nunca el nombre. */
  identity: string;
  personName: string;
  role: 'loan_officer' | 'nppm';
  /**
   * El branch VIGENTE, que puede ser el editado y no el de la fuente. Va en la
   * fila --y no se deduce de en qué branch aparece-- porque el editor lo
   * necesita para precargarlo.
   */
  branchCodeActual: string;
  /** Su NMLS, si lo trae. Se conserva al guardar para no perder el único enlace exacto. */
  nmls: string | null;
  stage: RecruitStage;
  /** Cuándo entra. `null` en los 13 de Salesforce, que no traen ninguna. */
  startDate: string | null;
  /** Cuándo se cerró el reclutamiento. Se muestra en las etapas que no proyectan. */
  closeDate: string | null;
  /** Desde qué mes cuenta, 'YYYY-MM'. */
  producingFrom: string;
  /**
   * Su producción mensual esperada. `null` = nadie la fijó.
   *
   * ⚠ VACÍO Y CERO NO SON LO MISMO. Cero afirmaría que no se espera producción;
   * vacío dice que nadie lo decidió. Hoy es `null` en los 15: medido,
   * `outlook.strategy_benchmark` tiene dos filas en toda la tabla y las dos son
   * de B2B, así que no hay ni un benchmark de Recruitment del cual precargar.
   */
  monthlyBenchmark: number | null;
  /** El `employee_key` al que se vinculó, si alguien lo confirmó. */
  linkedEmployeeKey: number | null;
  /** `nmls` cuando calzó automáticamente contra `org.dim_employee`. */
  linkedByNmls: boolean;
  /** Lo que aporta al presupuesto, mes por mes. Todo cero si no proyecta. */
  byMonth: Record<string, number>;
  /** Por qué no suma, cuando no suma. `null` = sí suma. */
  notProjecting: NotProjectingReason | null;
}

export interface BranchStrategy {
  strategy: OutlookStrategy;
  ytd: number;
  actualByMonth: Record<string, number>;
  /** Cómo se abre esta estrategia. Ver la nota de arriba. */
  opensBy: 'loanOfficer' | 'realtor' | 'owner' | 'branch';
  /** Sólo en NPPM: los realtors del branch, de mayor a menor. */
  realtors: BranchRealtor[];
  /**
   * Los dueños de la oportunidad, de mayor a menor. En Affinity son Account
   * Executives y en B2B Business Developers --desde OL15 son las dos, no sólo
   * Affinity--. Vacío en las otras tres.
   */
  owners: BranchOwner[];
  /**
   * ⚠ LA GENTE EN PROCESO DE CONTRATACIÓN — etapa OL20.
   *
   * Sólo en Recruitment, y en TODOS los branches: la decisión del negocio es que
   * cualquiera que venga del proceso de reclutamiento se proyecta bajo esa
   * estrategia sin importar a qué branch se lo asigne. No en Own Production.
   *
   * Vacío en las otras cuatro estrategias.
   */
  recruits: BranchRecruit[];
  /**
   * ⚠ LA DECISIÓN DEL BRANCH, para las estrategias que son suyas — etapa OL11.
   *
   * Mismos campos que tiene una persona en `OutlookLoanOfficer`, y a propósito:
   * el editor y el motor de proyección no distinguen quién decide, sólo leen la
   * decisión. Un branch y una persona son dos SUJETOS de la misma estructura.
   *
   * Own Production y NPPM no los usan: la primera decide por persona y la
   * segunda por realtor.
   */
  /**
   * ⚠ EL PRONÓSTICO DEL MES EN CURSO, DE ESTA ESTRATEGIA — etapa OL12.
   *
   * Sin redondear: la vista lo reparte contra el entero del branch para que las
   * cinco sumen exactamente lo que muestra la lista. Sale de dos mitades que ya
   * existen y no se recalculan acá:
   *
   *   lo ya cerrado   los préstamos fondeados del mes, clasificados uno por uno
   *   el pipeline     `projection.pipelineByStrategy`, que sale del MISMO bucle
   *                   que el total del mes en `projectCurrentMonth`
   *
   * Por eso la suma de las cinco es el pronóstico del branch, y no una segunda
   * cuenta que podría no darlo. Antes esto no existía y el mes en curso quedaba
   * sin repartir: de ahí venía la fila `Aug pipeline, no strategy yet`.
   */
  currentMonthRaw: number;
  benchmarkSchedule: BenchmarkPoint[];
  benchmarkAtDisplay: number;
  rules: GrowthSegment[];
  ruleRevision: number;
  mode: ProjectionMode;
  modeSetBy: { setBy: string; at: string } | null;
  targets: Record<string, number>;
  targetRevision: number;
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
   * ⚠ Y DESDE OL21 YA NO SON UNA DIFERENCIA CON COMMERCIAL ACTIVITY: se cuentan
   * en `actualByMonth` y en `ytd`, así que los dos módulos dan el mismo número
   * --355 de enero a agosto, verificado mes por mes contra la pantalla de
   * Commercial Activity--. Este contador sobrevive porque sigue diciendo algo
   * que ningún otro dice: cuánto del total del branch NO le suma a ninguna
   * persona, estrategia ni realtor. Es exactamente el hueco entre el total y la
   * suma de las estrategias, y `outOfDivision` dice de quién es.
   */
  unattributed: number;
  /**
   * QUIÉNES son esos cierres sin atribuir, con nombre — etapa OL21.
   *
   * Mismo criterio y mismo formato que `outsiders`: el hueco ya tenía número y
   * lo que faltaba era el nombre. La diferencia entre los dos es de quién es la
   * persona: un `outsider` es un Loan Officer de la división que pertenece a
   * OTRO branch, y esto es alguien que no es Loan Officer de la división.
   */
  outOfDivision: { name: string; closings: number }[];
  /**
   * ⚠ NADIE DEL ROSTER TIENE ESTE BRANCH — etapa OL21.
   *
   * `true` cuando el branch no tiene ni un productor activo en
   * `org.roster_current`. Son cinco hoy: AFFINITY (32 cierres), 741 (4), 150
   * (2), 701 (2) y 771 (2).
   *
   * ⚠ LA REGLA ES POR DATO Y NO POR LISTA, a propósito: se deriva del roster en
   * cada carga, así que el 741 vuelve a activo solo el día que le asignen a
   * alguien, sin que nadie tenga que acordarse de sacarlo de una constante.
   *
   * Qué implica en la pantalla:
   *   - va en el bloque `Inactive`, al final y separado de los que operan
   *   - suma al total de la división igual que cualquier otro
   *   - los meses SIN producción van vacíos, no en cero
   *   - no se le puede fijar nada: no hay a quién asignárselo
   *   - no proyecta meses futuros
   */
  isInactive: boolean;
  /**
   * Cerrados de ESTE branch cuyo originador no tiene fila acá — etapa OL8.
   *
   * ⚠ ES EL PRECIO DE LA REGLA NUEVA, Y VA A LA PANTALLA POR ESO. El bloque de
   * Loan Officers muestra sólo a los del branch según el roster; quien cerró acá
   * pero pertenece a otro branch ya no tiene fila. Su producción sigue contando
   * --el préstamo se cerró en este branch-- así que el total del branch deja de
   * ser la suma de sus filas.
   *
   * Un descuadre sin explicación es peor que una fila incompleta, así que el
   * subtítulo lo dice: "closed 47 (+3 by loan officers from other branches)".
   * Es el mismo criterio que `unattributed`.
   */
  closedByOutsiders: number;
  /**
   * QUIÉNES son, con cuánto cerraron acá — etapa OL16.
   *
   * El total del branch no da la suma de sus filas, y `closedByOutsiders` dice
   * cuánto falta pero no de quién. Con los nombres el descuadre se entiende sin
   * un párrafo: son Loan Officers de otro branch que cerraron en este.
   */
  outsiders: { name: string; closings: number }[];
  loanOfficers: OutlookLoanOfficer[];
  /** Las cinco estrategias del branch — etapa OL8. */
  byStrategy: BranchStrategy[];
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
  /**
   * ⚠ LA RAMPA DE ARRANQUE, QUE ES UNA Y ES DE TODOS — etapa OL20.
   *
   * 25% el primer mes, 50% el segundo, 100% desde el tercero, editable. Va acá
   * y no en cada `BranchRecruit` porque es UNA decisión global: la revisión
   * vigente de `outlook.recruitment_ramp` rige para los 15, así que si viviera
   * repetida en cada fila un editor podría cambiarla en un branch y dejar los
   * otros catorce con la vieja sin que nada lo dijera.
   */
  recruitRamp: Ramp;
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
     * ¿Están las tablas de OL4? — `outlook.monthly_target` y
     * `outlook.projection_mode`.
     *
     * ⚠ Se usa para NO OFRECER el modo mes a mes cuando no se puede guardar.
     * Ofrecerlo igual dejaría a alguien escribiendo cuatro números para
     * descubrir al apretar Guardar que no hay dónde ponerlos.
     */
    monthlyModeAvailable: boolean;
    /**
     * ¿Están las tres tablas de OL20? — `outlook.recruitment_projection`,
     * `recruitment_ramp` y `recruitment_link`.
     *
     * ⚠ Mismo uso que `monthlyModeAvailable`: NO ofrecer los editores cuando no
     * hay dónde guardar. Sin esto, alguien fija el benchmark de quince personas
     * y lo descubre al apretar Guardar.
     */
    recruitTablesAvailable: boolean;
    /** Gente en contratación leída de la fuente. Hoy 15. */
    recruitsRead: number;
    /**
     * Proyecciones vencidas y sin vincular — ver el aviso de la pantalla.
     *
     * Su mes de producción ya llegó y nadie dijo con quién del roster se
     * corresponden, así que dejaron de sumar. Debería tender a 0: cada una es
     * alguien de quien el presupuesto se olvidó.
     */
    recruitsExpiredUnlinked: number;
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
  /* El respaldo del realtor NPPM cuando `nppm_realtor` viene vacío -- OL13. */
  referred_by_realtor: string | null;
  /*
   * ⚠ EL DUEÑO DE LA OPORTUNIDAD, que en Affinity es un ACCOUNT EXECUTIVE y no
   * el Loan Officer. Es la unidad de decisión de esa estrategia -- etapa OL13.
   */
  opportunity_owner: string | null;
  closing_month: string | null;
}

/*
 * ============================================================================
 * ⚠ LA CLAVE DE UNA DECISIÓN LLEVA A QUIÉN PERTENECE — etapa OL11
 * ============================================================================
 *
 * Las cuatro tablas de `outlook` guardaban `employee_key`, y la clave del índice
 * era `employee_key + '|' + strategy`. Desde que una decisión puede ser de un
 * BRANCH --B2B, Recruitment y Affinity no son de nadie en particular-- esa clave
 * no alcanza: en una fila de branch `employee_key` es NULL, así que las cinco
 * estrategias de los dieciséis branches habrían caído todas en `"null|B2B"` y
 * cada branch habría visto el presupuesto del último que se cargó.
 *
 * El prefijo `e`/`b` hace que los dos espacios de claves no puedan tocarse. Es
 * la misma separación que el CHECK XOR impone en la base: una fila apunta a una
 * persona o a un branch, nunca a las dos.
 */
export const employeeKeyOf = (employeeKey: number, strategy: string) => 'e' + employeeKey + '|' + strategy;
export const branchKeyOf = (branchCode: string, strategy: string) => 'b' + branchCode + '|' + strategy;
const rowKeyOf = (r: { employee_key: number | null; branch_code: string | null }, strategy: string) =>
  r.employee_key !== null ? employeeKeyOf(r.employee_key, strategy) : 'b' + r.branch_code + '|' + strategy;

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
      .select(
        'loan_officer, loan_officer_person_code, branch, strategy, nppm_realtor, referred_by_realtor, opportunity_owner, closing_month'
      )
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

  /*
   * ==========================================================================
   * ⚠ LA GENTE EN PROCESO DE CONTRATACIÓN — etapa OL20
   * ==========================================================================
   *
   * `activity_report.future_loan_officer` y no las otras dos tablas de
   * reclutamiento: trae las reglas ya aplicadas.
   *
   * ⚠ EL FILTRO ES `producira`, NO `confianza`. Medido: de los 6 con
   * `confianza = 'confirmado'` hay 4 que NO producen, así que el filtro que uno
   * escribiría primero da al revés.
   *
   * ⚠ Y LOS `es_nppm` NO ENTRAN COMO PERSONAS con presupuesto propio: van al
   * desglose de NPPM del branch, que se abre por realtor. Hoy son 3 y los tres
   * tienen `producira = false`, así que ya quedan fuera del filtro -- se deja
   * explícito para que el día que uno tenga `producira = true` no se cuele como
   * Loan Officer.
   *
   * Las tres tablas de `outlook` van en un `try` propio: el SQL lo aplica el
   * revisor, y hasta entonces la etapa funciona con los valores por defecto.
   */
  const recruitPromise = (async () => {
    const fuente = await supabase
      .from('future_loan_officer')
      .select('nombre, origen, confianza, branch_code, cargo, fecha_inicio, close_date, nmls_number, es_nppm, id_fuente')
      .eq('producira', true)
      .eq('es_nppm', false);
    let editado: {
      proyecciones: RecruitProjectionRow[];
      rampas: RecruitRampRow[];
      vinculos: RecruitLinkRow[];
    } | null = null;
    try {
      const ol = supabase.schema('outlook');
      const [pr, ra, li] = await Promise.all([
        ol.from('recruitment_projection').select('*'),
        ol.from('recruitment_ramp').select('*'),
        ol.from('recruitment_link').select('*'),
      ]);
      if (!pr.error && !ra.error && !li.error) {
        editado = {
          proyecciones: (pr.data ?? []) as RecruitProjectionRow[],
          rampas: (ra.data ?? []) as RecruitRampRow[],
          vinculos: (li.data ?? []) as RecruitLinkRow[],
        };
      }
    } catch {
      /* Las tablas todavía no existen. Se sigue con los valores por defecto. */
    }
    return { fuente, editado };
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
    /* `nmls` desde OL20: el único identificador que une el roster con la gente en proceso. */
    supabase.schema('org').from('dim_employee').select('employee_key, full_name, is_branch_manager, nmls'),
  ]);

  const [bp, rows, outlookTables, orgTables, recruitTables] = await Promise.all([
    loadBusinessPlanData(reference) as Promise<BusinessPlanData>,
    activityPromise,
    outlookPromise,
    orgPromise,
    recruitPromise,
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
        const k = rowKeyOf(m, m.strategy);
        modeByKey.set(k, m.mode);
        modeSetByKey.set(k, { setBy: m.set_by, at: m.created_at });
      }

      const targets = (targetRes.data ?? []) as MonthlyTargetRow[];
      history.monthlyTargets = targets;
      /* Sólo la revisión más alta de cada par, entera -- igual que las reglas. */
      const maxTargetRev = new Map<string, number>();
      for (const t of targets) {
        const k = rowKeyOf(t, t.strategy);
        maxTargetRev.set(k, Math.max(maxTargetRev.get(k) ?? 0, t.revision));
      }
      for (const [k, rev] of maxTargetRev) targetRevisionByKey.set(k, rev);
      for (const t of targets) {
        const k = rowKeyOf(t, t.strategy);
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
        const k = rowKeyOf(b, b.strategy);
        benchByKey.set(k, [...(benchByKey.get(k) ?? []), b]);
      }
      for (const [k, rows2] of benchByKey) benchmarkScheduleByKey.set(k, scheduleFrom(rows2));

      const rules = (ruleRes.data ?? []) as GrowthRuleRow[];
      history.growthRules = rules;
      growthRuleRows = rules.length;
      /* Sólo la revisión más alta de cada (empleado, estrategia) -- ver el SQL. */
      const maxRevision = new Map<string, number>();
      for (const r of rules) {
        const k = rowKeyOf(r, r.strategy);
        maxRevision.set(k, Math.max(maxRevision.get(k) ?? 0, r.revision));
      }
      for (const [k, rev] of maxRevision) revisionByKey.set(k, rev);
      for (const r of [...rules].sort((a, b) => a.segment_order - b.segment_order)) {
        const k = rowKeyOf(r, r.strategy);
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
   * `org.roster_current` decide quién aparece y en qué branch. El puente con la
   * identidad interna es el alias `person_code`, y hoy cubre a los 38
   * productores: 38 de 38 resuelven a `employee_key`.
   *
   * ⚠ SI ESTA TABLA VUELVE VACÍA, LA PANTALLA QUEDA CASI VACÍA, y es a
   * propósito. Hubo un fallback a `org.employee_branch` y se quitó cuando se
   * aplicaron las policies, porque hacía daño: la lista anterior salía llena de
   * nombres reales con números plausibles y nada delataba que era la vieja.
   * Preferimos que se note.
   *
   * Y si vuelve vacía, mirar el CLAIM de su policy antes que el código: la RLS
   * no rechaza, filtra --devuelve cero filas y `error: null`--, así que una
   * policy que no aplica es indistinguible de una tabla vacía. Hoy hay tres
   * policies de SELECT: `admin`, `outlook` y `commercial_activity`. Ninguna de
   * escritura: la tabla la escribe el sync, no la app.
   */
  const rosterRows = rosterRes.error ? [] : ((rosterRes.data ?? []) as RosterRow[]);

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
  /*
   * ⚠ QUIÉN CERRÓ LO QUE NO SE LE ATRIBUYE A NADIE — etapa OL21.
   *
   * Los cierres cuyo originador no resuelve contra el roster, con NOMBRE y por
   * branch. Sin el nombre, el hueco entre el total del branch y la suma de sus
   * estrategias sería un descuadre sin explicación; con el nombre se lee solo.
   *
   * Es el mismo criterio que `outsiders` en OL16: el número ya decía cuánto
   * faltaba, y lo que hacía falta era de quién.
   */
  const outOfDivisionByBranch = new Map<string, Map<string, number>>();
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
  /*
   * A NIVEL BRANCH, sin la persona en la clave — etapa OL8.
   *
   * ⚠ No se derivan sumando los de persona: incluyen los cierres de gente que no
   * tiene fila en el branch. Derivarlos daría un número más chico y la suma de
   * las estrategias no daría el total del branch.
   */
  const actualByBranchStrategy: MonthCounter = new Map();
  const actualByBranchRealtor: MonthCounter = new Map();
  const realtorsByBranch = new Map<string, Set<string>>();
  /* Los Account Executives de Affinity, por branch -- etapa OL13. */
  const actualByBranchOwner: MonthCounter = new Map();
  const ownersByBranch = new Map<string, Set<string>>();
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

      /*
       * ══════════════════════════════════════════════════════════════════════
       * ⚠ ESTE PRÉSTAMO SÍ CUENTA EN EL TOTAL DEL BRANCH — etapa OL21
       * ══════════════════════════════════════════════════════════════════════
       *
       * HISTORIA DE TRES ETAPAS, porque la regla cambió dos veces y conviene
       * que se lea entera antes de cambiarla una tercera:
       *
       *   OL8   el préstamo contaba del lado del REALTOR aunque el originador
       *         estuviera excluido: el realtor sí es de la división.
       *   OL13  el negocio lo revirtió: si el originador está excluido, el
       *         préstamo no cuenta en ninguna parte. Se ganó que la fila de
       *         reconciliación quedara en cero en los dieciséis branches -- el
       *         -1 de mayo del 733 era exactamente esto.
       *   OL21  cuenta en el TOTAL DEL BRANCH, y no cuenta para ninguna
       *         persona, estrategia ni realtor.
       *
       * ⚠ POR QUÉ SE VOLVIÓ A CAMBIAR, y no es un capricho: Outlook mostraba
       * 340 cierres de enero a agosto y Commercial Activity 355, sobre el mismo
       * período y la misma tabla. Medido: la diferencia son exactamente estos
       * 15 préstamos. `countsIn()` --la regla de Commercial Activity-- sólo mira
       * `counts_for_division`, y no consulta `source_name_excluded`: para un
       * total de división un cierre es un cierre. Dos pantallas de la misma app
       * dando números distintos del mismo mes es peor que una fila que no suma.
       *
       * ⚠ LO QUE ESTO CUESTA, dicho para que no aparezca como sorpresa: la fila
       * de reconciliación vuelve a no-cero en tres branches --733 +4, 747 +4,
       * 716 +1-- y la suma de las estrategias deja de dar el total del branch.
       * Es a propósito, y por eso va con nombre: `outOfDivision` dice QUIÉN
       * cerró cada uno. Un hueco con nombre se explica; el mismo hueco sin
       * nombre es el descuadre que OL13 vino a cerrar.
       *
       * ⚠ Y NO SE TOCA NADA MÁS: ni `actualByBranchLo`, ni las estrategias, ni
       * los realtors, ni `actualByLo`. Un préstamo de alguien de fuera de la
       * división no le suma producción a ninguna persona de la división, que es
       * la parte de OL13 que sigue en pie.
       */
      bump(actualByBranch, b, row.closing_month.slice(0, 7));
      const nombre = row.loan_officer?.trim() || 'unknown loan officer';
      const porNombre = outOfDivisionByBranch.get(b) ?? new Map<string, number>();
      porNombre.set(nombre, (porNombre.get(nombre) ?? 0) + 1);
      outOfDivisionByBranch.set(b, porNombre);
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
    bump(actualByBranchStrategy, branch + '|' + strategy, month);

    if (strategy === 'Affinity' || strategy === 'B2B') {
      /*
       * ⚠ El dueño puede no ser una persona. `sf integrations` es el usuario de
       * sistema de Salesforce: se cuenta --sus cierres son reales-- y se rotula
       * aparte. Sin nombre no hay a quién contarle, y ahí sí es el mismo rótulo.
       */
      const owner = row.opportunity_owner?.trim() || UNASSIGNED_OWNER;
      /* La clave lleva la ESTRATEGIA: un mismo dueño puede tener las dos. */
      bump(actualByBranchOwner, branch + '|' + strategy + '|' + owner, month);
      const set = ownersByBranch.get(branch + '|' + strategy) ?? new Set<string>();
      set.add(owner);
      ownersByBranch.set(branch + '|' + strategy, set);
    }

    if (strategy === 'NPPM') {
      /*
       * ⚠ EL REALTOR PUEDE VENIR EN DOS CAMPOS — etapa OL13.
       *
       * `nppm_realtor` es el principal y `referred_by_realtor` el respaldo: es la
       * misma regla que Forecast ya usa en `nppmRealtors`. Medido: un préstamo del
       * 733 tenía `nppm_realtor` vacío y `referred_by_realtor` con 'Santiago
       * Jaraba Chacon', así que se mostraba como `unassigned realtor` teniendo
       * nombre.
       *
       * ⚠ Y NO LOS RESUELVE A TODOS: queda un préstamo del 776 --agosto-- con los
       * DOS campos vacíos. Ese sigue como `unassigned realtor`, que es la verdad:
       * su realtor no está en el dato de origen.
       */
      const realtor = row.nppm_realtor?.trim() || row.referred_by_realtor?.trim() || UNASSIGNED_REALTOR;
      bump(actualByLoStrategyRealtor, sk + '|' + realtor, month);
      const set = realtorsByStrategyKey.get(sk) ?? new Set<string>();
      set.add(realtor);
      realtorsByStrategyKey.set(sk, set);

      bump(actualByBranchRealtor, branch + '|' + realtor, month);
      const porBranch = realtorsByBranch.get(branch) ?? new Set<string>();
      porBranch.add(realtor);
      realtorsByBranch.set(branch, porBranch);
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

  /*
   * ⚠ EL MAPA SE SIEMBRA CON LOS BRANCHES, NO SE DERIVA DE LAS FILAS.
   *
   * Un branch existe si tuvo producción o si el roster pone gente en él. Antes
   * se derivaba de las filas de personas y eso alcanzaba, porque una fila
   * aparecía en cada branch donde había cerrado. Con la regla de OL8 --una
   * persona, un branch-- un branch entero puede quedarse sin filas.
   *
   * Medido cuando faltaba esta siembra: AFFINITY desapareció del módulo con sus
   * 31 cierres, porque nadie lo tiene como branch de roster --sólo existe a
   * nivel de préstamo-- y el pronóstico de agosto de la división cayó de 31 a 26
   * sin que nada lo dijera. Un branch con producción y sin fila tiene que
   * mostrarse igual: su producción es real.
   */
  for (const k of actualByBranch.keys()) if (!branchMap.has(k)) branchMap.set(k, []);
  for (const r of rosterByKey.values()) {
    if (r.is_producer && r.is_active && r.branch_code && !branchMap.has(r.branch_code)) {
      branchMap.set(r.branch_code, []);
    }
  }

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
  /*
   * ==========================================================================
   * LOS RECLUTAS, POR BRANCH — etapa OL20
   * ==========================================================================
   *
   * La fuente da el estado del proceso; las tres tablas de `outlook` dan lo que
   * se editó encima: branch, fechas y benchmark. La vigente es la revisión más
   * alta por `identity`.
   *
   * ⚠ LA CLAVE ES `identity`, NUNCA EL NOMBRE. Hay dos `Jose Flores` distintos
   * en los 15 registros de hoy --uno de `hr_pipeline` en el 728 y otro de
   * Salesforce, `tentative`-- así que cualquier cosa que agrupe por nombre los
   * une siendo distintos o los separa siendo el mismo, y desde acá no hay forma
   * de saber cuál de las dos cosas es.
   */
  const hoyISO = new Date().toISOString().slice(0, 10);
  const rampa: Ramp = (() => {
    const filas = recruitTables.editado?.rampas ?? [];
    if (filas.length === 0) return DEFAULT_RAMP;
    const v = filas.reduce((a, b) => (b.revision > a.revision ? b : a));
    return { month1: Number(v.month_1_pct), month2: Number(v.month_2_pct), month3Plus: Number(v.month_3_plus_pct) };
  })();

  /* La proyección vigente de cada persona, por revisión. */
  const editadaPor = new Map<string, RecruitProjectionRow>();
  for (const r of recruitTables.editado?.proyecciones ?? []) {
    const ya = editadaPor.get(r.identity);
    if (!ya || r.revision > ya.revision) editadaPor.set(r.identity, r);
  }
  /* El vínculo vigente: el más reciente, y `null` significa desvinculado. */
  const vinculoPor = new Map<string, number | null>();
  for (const l of (recruitTables.editado?.vinculos ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    vinculoPor.set(l.identity, l.employee_key);
  }
  /*
   * ⚠ EL NMLS ES EL ÚNICO IDENTIFICADOR QUE UNE LAS DOS FUENTES SIN ADIVINAR.
   * Es un registro nacional único por licenciado, así que un match ES identidad
   * y no una heurística. Cubre 6 de los 15 --y 44 de los 127 empleados-- pero
   * los que cubre son exactos, que es lo que importa.
   */
  const empleadoPorNmls = new Map<string, number>();
  const empleadosCrudos = (orgTables[3].error ? [] : (orgTables[3].data ?? [])) as {
    employee_key: number;
    nmls?: string | null;
  }[];
  for (const e of empleadosCrudos) {
    const n = (e.nmls ?? '').trim();
    if (n) empleadoPorNmls.set(n, e.employee_key);
  }

  const recruitsPorBranch = new Map<string, BranchRecruit[]>();
  for (const f of (recruitTables.fuente.data ?? []) as FutureLoRow[]) {
    const identity = 'future:' + (f.id_fuente ?? f.nombre);
    const ed = editadaPor.get(identity);
    const startDate = ed?.start_date ?? f.fecha_inicio ?? null;
    const stage = classifyRecruit(
      { origen: f.origen, confianza: f.confianza, closeDate: f.close_date, startDate },
      hoyISO
    );
    const branchCode = ed?.branch_code ?? f.branch_code ?? 'Recruitment';
    const producingFrom = ed?.producing_from ?? defaultProducingFrom(startDate, currentMonth);
    const benchmark =
      ed && ed.monthly_benchmark !== null && ed.monthly_benchmark !== undefined ? Number(ed.monthly_benchmark) : null;
    const nmls = (ed?.nmls ?? f.nmls_number ?? '').trim();
    const porNmls = nmls ? (empleadoPorNmls.get(nmls) ?? null) : null;
    /* El vínculo explícito manda sobre el automático: alguien lo confirmó a mano. */
    const linked = vinculoPor.has(identity) ? vinculoPor.get(identity)! : porNmls;
    const input = { producingFrom, monthlyBenchmark: benchmark, stage, linked: linked !== null, ramp: rampa };
    const valores = projectRecruit(remainingMonths, input, currentMonth);
    const byMonth: Record<string, number> = {};
    remainingMonths.forEach((m, i) => (byMonth[m] = valores[i]));
    const lista = recruitsPorBranch.get(branchCode) ?? [];
    lista.push({
      identity,
      personName: ed?.person_name ?? f.nombre,
      role: (ed?.role as 'loan_officer' | 'nppm') ?? 'loan_officer',
      branchCodeActual: branchCode,
      nmls: nmls || null,
      stage,
      startDate,
      closeDate: f.close_date,
      producingFrom,
      monthlyBenchmark: benchmark,
      linkedEmployeeKey: linked,
      linkedByNmls: linked !== null && !vinculoPor.has(identity),
      byMonth,
      notProjecting: notProjectingReason(input, currentMonth),
    });
    recruitsPorBranch.set(branchCode, lista);
  }
  /* Las creadas a mano no tienen fila en la fuente: salen sólo de `outlook`. */
  for (const ed of editadaPor.values()) {
    if (ed.source !== 'manual') continue;
    const producingFrom = ed.producing_from;
    const benchmark = ed.monthly_benchmark === null ? null : Number(ed.monthly_benchmark);
    const linked = vinculoPor.get(ed.identity) ?? null;
    /*
     * ⚠ UNA CREADA A MANO SIEMPRE ES `in_hiring`. No viene de ningún proceso que
     * se pueda clasificar: alguien la escribió porque sabe que esa persona entra.
     */
    const input = { producingFrom, monthlyBenchmark: benchmark, stage: 'in_hiring' as const, linked: linked !== null, ramp: rampa };
    const valores = projectRecruit(remainingMonths, input, currentMonth);
    const byMonth: Record<string, number> = {};
    remainingMonths.forEach((m, i) => (byMonth[m] = valores[i]));
    const lista = recruitsPorBranch.get(ed.branch_code) ?? [];
    lista.push({
      identity: ed.identity,
      personName: ed.person_name,
      role: ed.role as 'loan_officer' | 'nppm',
      branchCodeActual: ed.branch_code,
      nmls: ed.nmls,
      stage: 'in_hiring',
      startDate: ed.start_date,
      closeDate: null,
      producingFrom,
      monthlyBenchmark: benchmark,
      linkedEmployeeKey: linked,
      linkedByNmls: false,
      byMonth,
      notProjecting: notProjectingReason(input, currentMonth),
    });
    recruitsPorBranch.set(ed.branch_code, lista);
  }
  for (const lista of recruitsPorBranch.values()) {
    lista.sort((a, b) => a.personName.localeCompare(b.personName));
  }
  /*
   * Los quince en una sola lista, para contarlos sin recorrer los branches.
   *
   * ⚠ NO ES UNA SEGUNDA FUENTE DE VERDAD: es la misma referencia de objeto que
   * está en `recruitsPorBranch`, aplanada. Copiar las filas dejaría dos listas
   * que se pueden desincronizar, y el conteo del pie diría una cosa mientras la
   * tabla muestra otra.
   */
  const todosLosReclutas = [...recruitsPorBranch.values()].flat();

  /*
   * ==========================================================================
   * ⚠ UN BRANCH QUE SÓLO TIENE RECLUTAS TAMBIÉN EXISTE — etapa OL20
   * ==========================================================================
   *
   * Es la misma siembra que salvó a AFFINITY en OL8, por el mismo motivo: el
   * mapa se siembra con los branches, no se deriva de las filas de personas.
   * Sin esto, `Recruitment` --que es un marcador y no un branch real, con 5
   * personas hoy-- no aparecería en ningún lado y sus proyecciones se
   * perderían sin que nada lo dijera.
   *
   * ⚠ `Recruitment` COMO BRANCH ES UN MARCADOR DE "TODAVÍA NO SE SABE", no un
   * lugar. Va junto a los reales porque su gente proyecta como la de cualquier
   * otro; el `branch_code` de cada persona es editable, así que moverla a su
   * branch real no espera a que la fuente lo traiga.
   */
  for (const code of recruitsPorBranch.keys()) {
    if (!branchMap.has(code)) branchMap.set(code, []);
  }

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
          : (benchmarkScheduleByKey.get(employeeKeyOf(lo.employeeKey, s)) ?? []);
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
      const k = employeeKeyOf(lo.employeeKey, s);
      rulesByStrategy[s] = rulesByKey.get(k) ?? [];
      ruleRevision[s] = revisionByKey.get(k) ?? 0;
      /* Sin fila de modo, `growth`: es como se comportaba el módulo antes. */
      modeByStrategy[s] = modeByKey.get(k) ?? 'growth';
      modeSetBy[s] = modeSetByKey.get(k) ?? null;
      targetsByStrategy[s] = targetsByKey.get(k) ?? {};
      targetRevision[s] = targetRevisionByKey.get(k) ?? 0;
    }

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
     * ⚠ EN QUÉ BRANCH APARECE — UNO, el del roster (etapa OL8)
     * ==========================================================================
     *
     * Aparece en el branch que le da el ROSTER, y en ninguno más. Dos
     * condiciones, y hace falta una de las dos:
     *
     *   - es productor y está activo  → se ve desde el primer día, sin haber
     *     cerrado nada todavía.
     *   - cerró algo en ESE branch    → así las bajas se quedan donde
     *     pertenecen. Isabel Wagner y Ludwig Aguillon tienen branch 716 en el
     *     roster y cerraron ahí: siguen, marcadas por su estado.
     *
     * ⚠ QUIÉN DEJÓ DE APARECER, que es el cambio de OL8. Hasta OL7 una persona
     * aparecía en TODOS los branches donde había cerrado. El 747 mostraba a
     * Nathan Martinez, Cristhian Ramirez y Jose Zamora --marcados "budget in
     * 716 / budget in 760"-- cuando el 747 tiene dos Loan Officers: Galo Rizzo y
     * Gian Laino. Una fila que aclara que su presupuesto está en otro branch no
     * es información del branch que se está mirando: es ruido con la forma de
     * una fila.
     *
     * Sus cierres SIGUEN sumando al total del branch, sin fila. Por eso el total
     * dejó de ser la suma de las filas, y por eso existe `closedByOutsiders`:
     * el subtítulo lo dice, igual que hace con los que no resuelven.
     *
     * Y una consecuencia buscada: como el roster da UN branch por persona,
     * nadie puede aparecer dos veces. `primaryBranch` y el branch de su fila son
     * siempre el mismo, así que la etiqueta "budget in X" del bloque de
     * personas ya no puede existir.
     */
    const rosterEntry = rosterByKey.get(lo.employeeKey);
    const rosterBranch = rosterEntry?.branch_code ?? null;
    const esProductorActivo = !!rosterEntry && rosterEntry.is_producer && rosterEntry.is_active;
    const cerroEnSuBranch = rosterBranch !== null && branchesWithProduction.includes(rosterBranch);
    const codes = rosterBranch !== null && (esProductorActivo || cerroEnSuBranch) ? [rosterBranch] : [];

    const row: OutlookLoanOfficer = {
      employeeKey: lo.employeeKey,
      fullName: lo.fullName,
      /* Los branches en los que APARECE, no los de `org.employee_branch`. */
      branchCodes: codes,
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
      currentMonthByStrategy: splitCurrentMonth(lo),
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
       * ⚠ EL BRANCH AL QUE SE LE CARGA EL PRONOSTICO Y EL PRESUPUESTO.
       *
       * Sale del ROSTER, que da UN branch por persona -- asi que un presupuesto
       * no puede contarse dos veces. Antes salia de `lo.branchCodes[0]`, de
       * `org.employee_branch`, que tiene el branch viejo: Johann Otiniano figura
       * ahi en el 716 y en el roster en el 710, que es donde trabaja.
       *
       * Si el roster no la conoce, cae al branch donde CERRO y no a
       * `employee_branch`: entre un dato viejo y un dato real del anio en curso,
       * el real. Hoy no dispara -- los 34 del Business Plan estan todos en el
       * roster, medido -- y esta para que el dia que alguien salga del roster su
       * pronostico no se vuelva invisible, que es lo que le pasaba al 777.
       */
      primaryBranch: rosterByKey.get(lo.employeeKey)?.branch_code ?? codes[0] ?? null,
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
   * Las claves que faltan: quien CERRÓ, más los productores activos del roster,
   * menos quien ya vino del Business Plan.
   *
   * ⚠ Quien cerró entra aunque no sea productor ni figure en el roster. Su
   * préstamo ya está sumado en el total del branch, así que sin su fila el
   * branch muestra un total que no es la suma de sus filas -- un descuadre sin
   * explicación, que es peor que una fila incompleta.
   */
  const missingKeys = new Set<number>();
  for (const key of productionByKey.keys()) if (!bpKeys.has(key)) missingKeys.add(key);
  for (const [key, r] of rosterByKey) {
    if (r.is_producer && r.is_active && !bpKeys.has(key)) missingKeys.add(key);
  }

  for (const key of missingKeys) {
    const r = rosterByKey.get(key);
    const name = r?.display_name ?? employeeByKey.get(key)?.full_name ?? null;
    /* Sin nombre no hay fila que mostrar: sería un renglón anónimo. */
    if (!name) continue;

    /* Misma regla que arriba: el branch del roster, y una de las dos condiciones. */
    const rosterBranch = r?.branch_code ?? null;
    const esProductorActivo = !!r && r.is_producer && r.is_active;
    const cerroEnSuBranch = rosterBranch !== null && (productionByKey.get(key) ?? new Set<string>()).has(rosterBranch);
    const codes = rosterBranch !== null && (esProductorActivo || cerroEnSuBranch) ? [rosterBranch] : [];

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
        /* No está en el Business Plan: no tiene pronóstico que repartir. */
        currentMonthByStrategy: {},
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
      currentMonthByStrategy: {},
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

  /*
   * Los 3 meses CERRADOS, que son la ventana del promedio de un realtor NPPM.
   *
   * Se derivan de los meses reales --los anteriores al mes en curso-- y no se
   * vuelven a calcular con el reloj: `currentMonth` ya viene de la fecha de
   * referencia, y una segunda lectura del reloj podría caer en otro mes.
   * Mismo largo que `WINDOW_MONTHS` del Business Plan, que es de dónde sale que
   * la ventana sea de tres.
   */
  const mesesReales = monthsOfYear.filter((m) => m < currentMonth);
  const NPPM_WINDOW = 3;
  const ventanaCerrada = mesesReales.slice(-NPPM_WINDOW);

  /** Las cinco estrategias de un branch, con quién las abre. Ver `BranchStrategy`. */
  function strategiesOfBranch(branchCode: string): BranchStrategy[] {
    return OUTLOOK_STRATEGIES.map((strategy) => {
      const key = branchCode + '|' + strategy;
      const realtors: BranchRealtor[] =
        strategy !== 'NPPM'
          ? []
          : [...(realtorsByBranch.get(branchCode) ?? [])]
              .map((realtor) => {
                const rk = branchCode + '|' + realtor;
                const meses = monthsOf(actualByBranchRealtor, rk);
                /*
                 * ⚠ EL BENCHMARK POR DEFECTO ES EL PROMEDIO DE SUS 3 MESES
                 * CERRADOS, y sale del dato: si nadie lo toca, ese es el valor
                 * que rige, no un cero ni un hueco.
                 *
                 * Se divide siempre por 3, no por los meses con cierres: un mes
                 * sin cerrar nada es un cero real y promediar sólo los meses
                 * activos inflaría el número. Medido: Laura Delgado tiene 5
                 * cierres en el 776 y promedio 0,67, porque sólo 2 caen en la
                 * ventana.
                 */
                const avg3m = ventanaCerrada.reduce((a, m) => a + (meses[m] ?? 0), 0) / NPPM_WINDOW;
                const guardado = benchmarkAt(nppmScheduleByRealtor.get(normName(realtor)) ?? [], displayMonth);
                const hayGuardado = (nppmScheduleByRealtor.get(normName(realtor)) ?? []).length > 0;
                return {
                  realtor,
                  ytd: totalOf(actualByBranchRealtor, rk),
                  actualByMonth: meses,
                  avg3m,
                  benchmark: hayGuardado ? guardado : avg3m,
                  benchmarkIsDefault: !hayGuardado,
                };
              })
              .sort((a, b) => b.ytd - a.ytd || a.realtor.localeCompare(b.realtor));
      /*
       * Las dos mitades del mes en curso, sólo de quienes tienen ESTE branch como
       * primario -- mismo filtro que el total del branch, para que la suma cierre.
       */
      let currentMonthRaw = 0;
      for (const lo of branchMap.get(branchCode) ?? []) {
        if (lo.primaryBranch !== branchCode) continue;
        currentMonthRaw += lo.currentMonthByStrategy[strategy] ?? 0;
      }
      const bk = branchKeyOf(branchCode, strategy);
      const schedule = benchmarkScheduleByKey.get(bk) ?? [];
      const owners: BranchOwner[] =
        strategy !== 'Affinity' && strategy !== 'B2B'
          ? []
          : [...(ownersByBranch.get(branchCode + '|' + strategy) ?? [])]
              .map((owner) => {
                /*
                 * ⚠ ES UNA PERSONA si resuelve a `employee_key` por su alias de
                 * SALESFORCE, que es de donde viene `opportunity_owner`. Los dos
                 * Account Executives resuelven; el usuario de sistema no, y por eso
                 * la regla es "resuelve o no" y no una lista de nombres a mano.
                 */
                const employeeKey =
                  owner === UNASSIGNED_OWNER ? null : aliasIndex.lookup('salesforce', owner).employeeKey;
                const esPersona = employeeKey !== null;
                /*
                 * Su decisión sale de la MISMA clave que la de un Loan Officer:
                 * `e<employee_key>|Affinity`. Por eso las tablas de `outlook` no
                 * necesitaron nada nuevo.
                 */
                const ek = esPersona ? employeeKeyOf(employeeKey, strategy) : '';
                const schedule = esPersona ? (benchmarkScheduleByKey.get(ek) ?? []) : [];
                return {
                  owner: esPersona ? owner : UNASSIGNED_OWNER,
                  employeeKey,
                  ytd: totalOf(actualByBranchOwner, branchCode + '|' + strategy + '|' + owner),
                  actualByMonth: monthsOf(actualByBranchOwner, branchCode + '|' + strategy + '|' + owner),
                  benchmarkSchedule: schedule,
                  benchmarkAtDisplay: benchmarkAt(schedule, displayMonth),
                  rules: esPersona ? (rulesByKey.get(ek) ?? []) : [],
                  ruleRevision: esPersona ? (revisionByKey.get(ek) ?? 0) : 0,
                  mode: esPersona ? (modeByKey.get(ek) ?? 'growth') : ('growth' as const),
                  modeSetBy: esPersona ? (modeSetByKey.get(ek) ?? null) : null,
                  targets: esPersona ? (targetsByKey.get(ek) ?? {}) : {},
                  targetRevision: esPersona ? (targetRevisionByKey.get(ek) ?? 0) : 0,
                  isPerson: esPersona,
                };
              })
              .sort((a, b) => b.ytd - a.ytd || a.owner.localeCompare(b.owner));

      return {
        strategy,
        ytd: totalOf(actualByBranchStrategy, key),
        actualByMonth: monthsOf(actualByBranchStrategy, key),
        currentMonthRaw,
        benchmarkSchedule: schedule,
        benchmarkAtDisplay: benchmarkAt(schedule, displayMonth),
        rules: rulesByKey.get(bk) ?? [],
        ruleRevision: revisionByKey.get(bk) ?? 0,
        mode: modeByKey.get(bk) ?? 'growth',
        modeSetBy: modeSetByKey.get(bk) ?? null,
        targets: targetsByKey.get(bk) ?? {},
        targetRevision: targetRevisionByKey.get(bk) ?? 0,
        /*
         * ⚠ SÓLO RECRUITMENT LLEVA RECLUTAS — etapa OL20. Decisión del negocio:
         * cualquiera que venga del proceso de contratación se proyecta bajo esta
         * estrategia sin importar a qué branch se lo asigne.
         */
        recruits: strategy === 'Recruitment' ? (recruitsPorBranch.get(branchCode) ?? []) : [],
        /*
         * ⚠ RECRUITMENT SE ABRE POR PERSONA — cambio de OL12.
         *
         * Estaba como estrategia del branch, con las otras dos. Pero en el 710
         * la producción ES Recruitment --18 de sus cierres del año-- y ahí la
         * pregunta útil vuelve a ser quién trae cuánto. B2B sigue sin abrirse:
         * es del branch y no de una persona.
         *
         * Consecuencia: su presupuesto pasa a decidirse por persona, como Own
         * Production. Hoy no se pierde nada porque no hay ni un benchmark de
         * Recruitment guardado, ni por branch ni por persona.
         */
        opensBy:
          strategy === 'Own Production' || strategy === 'Recruitment'
            ? ('loanOfficer' as const)
            : strategy === 'NPPM'
              ? ('realtor' as const)
              : strategy === 'Affinity' || strategy === 'B2B'
                ? ('owner' as const)
                : ('branch' as const),
        realtors,
        owners,
      };
    });
  }

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
      /* Los mismos cierres que cuenta `unattributed`, con nombre — OL21. */
      outOfDivision: [...(outOfDivisionByBranch.get(branchCode) ?? new Map<string, number>()).entries()]
        .map(([name, closings]) => ({ name, closings }))
        .sort((a, b) => b.closings - a.closings || a.name.localeCompare(b.name)),
      /*
       * ⚠ SE PREGUNTA AL ROSTER, no a `los`. `los` incluye a gente que aparece
       * sólo porque cerró acá --los `outsiders` de OL16, cuyo branch de roster
       * es otro-- así que derivarlo de ahí diría que el 741 tiene productores
       * cuando lo que tiene es un cierre de alguien de otro branch. Medido: el
       * 741 tiene 2 cierres de Nathan Martinez, que en el roster no es del 741.
       */
      isInactive: !rosterRows.some(
        (r) => r.branch_code === branchCode && r.is_producer && r.is_active
      ),
      /*
       * Por RESTA, y a propósito: lo que el branch tiene menos lo que explican
       * sus filas. Contarlo aparte sería una segunda fórmula para el mismo
       * número, y podría no dar la diferencia que se ve en la pantalla -- que es
       * justo lo que este número viene a explicar.
       */
      closedByOutsiders:
        totalOf(actualByBranch, branchCode) - los.reduce((a, l) => a + l.ytd, 0),
      /*
       * Los mismos cierres que cuenta `closedByOutsiders`, con nombre. Se sacan
       * de `actualByBranchLo` --que tiene la producción de CADA persona en CADA
       * branch-- descartando a quienes sí tienen fila acá.
       */
      outsiders: [...actualByBranchLo.keys()]
        .filter((k) => k.startsWith(branchCode + '|'))
        .map((k) => ({ key: Number(k.slice(branchCode.length + 1)), closings: totalOf(actualByBranchLo, k) }))
        .filter(({ key, closings }) => closings > 0 && !los.some((l) => l.employeeKey === key))
        .map(({ key, closings }) => ({
          name: employeeByKey.get(key)?.full_name ?? 'employee_key ' + key,
          closings,
        }))
        .sort((a, b) => b.closings - a.closings || a.name.localeCompare(b.name)),
      loanOfficers: los.sort((a, b) => b.ytd - a.ytd || a.fullName.localeCompare(b.fullName)),
      byStrategy: strategiesOfBranch(branchCode),
    }))
    .sort((a, b) => b.ytd - a.ytd || a.branchCode.localeCompare(b.branchCode));

  return {
    remainingMonths,
    currentMonth,
    monthsOfYear,
    actualMonths: monthsOfYear.filter((m) => m < currentMonth),
    branches,
    effectiveFrom: addMonths(currentMonth, 1) + '-01',
    recruitRamp: rampa,
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
      monthlyModeAvailable,
      recruitTablesAvailable: recruitTables.editado !== null,
      recruitsRead: todosLosReclutas.length,
      recruitsExpiredUnlinked: todosLosReclutas.filter(
        (r) => r.notProjecting === 'expired' && r.linkedEmployeeKey === null
      ).length,
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
/**
 * El pronóstico del mes de una persona, repartido por estrategia — etapa OL12.
 *
 * ⚠ NO RECALCULA NADA. Las dos mitades ya están hechas:
 *   - el pipeline, en `projection.pipelineByStrategy`, anotado préstamo por
 *     préstamo dentro del mismo bucle que produce `projectedTotal`
 *   - lo ya cerrado, clasificando los préstamos fondeados del mes con la misma
 *     `classifyStrategy` de Forecast
 *
 * Por construcción la suma de las cinco es `projection.projectedTotal`.
 */
function splitCurrentMonth(lo: LoanOfficerRow): Partial<Record<OutlookStrategy, number>> {
  const out: Partial<Record<OutlookStrategy, number>> = {};
  const sumar = (nombre: string, valor: number) => {
    const s = FORECAST_A_OUTLOOK[nombre];
    if (!s) return;
    out[s] = (out[s] ?? 0) + valor;
  };
  for (const r of lo.resolvedLoanDetail) {
    sumar(
      classifyStrategy({
        branch: r.branch ?? '',
        strategyRaw: r.strategyRaw ?? '',
        opportunityOwnerTitle: r.opportunityOwnerTitle ?? '',
      }),
      1
    );
  }
  for (const [nombre, valor] of Object.entries(lo.projection.pipelineByStrategy)) sumar(nombre, valor);
  return out;
}

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
  /*
   * ⚠ Y LAS ESTRATEGIAS QUE SON DEL BRANCH — etapa OL11.
   *
   * Sin esto, el presupuesto de B2B, Recruitment y Affinity no llegaba al total
   * del branch ni a la lista: sólo se sumaban las proyecciones de las PERSONAS.
   * Se descubrió guardando el primer benchmark de branch: el 747 pasó a mostrar
   * B2B con 3 por mes y su total siguió en 81 -- y la fila de reconciliación se
   * lo tragó como un residuo de -3 por mes, sin que nada lo dijera.
   *
   * Es el riesgo de un residuo puro: hace que la suma cierre SIEMPRE, incluso
   * cuando lo que falta es un error. Por eso el total tiene que salir bien de las
   * dos vías, y no cuadrar sólo porque una de ellas se ajusta a la otra.
   */
  /*
   * ⚠ Y LAS QUE PROYECTAN DESDE SUS DUEÑOS DE OPORTUNIDAD — Affinity (OL14) y
   * B2B (OL15).
   *
   * Es la advertencia de la fila de reconciliación aplicada: cada vez que se
   * agrega una fuente de presupuesto hay que verificar a mano que esto la sume,
   * porque el residuo no lo va a avisar. Con `opensBy: 'owner'` las dos entran
   * por el mismo camino, así que la próxima estrategia que se abra por dueño no
   * necesita acordarse de nada.
   *
   * Es la TERCERA fuente de presupuesto que se agrega, y la advertencia de la
   * fila de reconciliación dice exactamente qué hacer: verificar a mano que
   * `projectBranch` la sume, porque el residuo no lo va a avisar. Las dos
   * anteriores --el presupuesto de branch en OL11 y NPPM en OL12-- se
   * descubrieron después de que la fila las tapara; ésta se sumó antes de
   * mirar la pantalla.
   */
  for (const bs of branch.byStrategy) {
    if (bs.opensBy !== 'owner') continue;
    for (const o of bs.owners) {
      if (!o.isPerson) continue;
      const steps = projectPlan(months, {
        mode: o.mode,
        benchmarks: o.benchmarkSchedule,
        segments: o.rules,
        targets: o.targets,
      });
      steps.forEach((st) => (byMonth[st.month] += st.value));
    }
  }

  /*
   * ==========================================================================
   * ⚠ Y LOS RECLUTAS — etapa OL20. CUARTA fuente de presupuesto.
   * ==========================================================================
   *
   * La advertencia de la fila de reconciliación, por cuarta vez y con el mismo
   * procedimiento: se suma ACÁ antes de mirar la pantalla, porque el residuo no
   * lo va a avisar. Las dos primeras --el presupuesto de branch en OL11 y NPPM
   * en OL12-- se descubrieron después de que la fila las tapara; ésta y la de
   * los dueños en OL15 se sumaron antes.
   *
   * ⚠ `byMonth` YA VIENE EN CERO cuando la proyección no cuenta: etapa que no
   * proyecta, ya vinculada al roster, sin benchmark, o vencida sin vincular. Por
   * eso este bucle no repite ninguna de las cuatro condiciones -- si las
   * repitiera, serían dos definiciones de "cuánto aporta" y algún día
   * diferirían. La decisión vive en `projectRecruit` y acá sólo se suma.
   */
  for (const bs of branch.byStrategy) {
    for (const r of bs.recruits) {
      for (const m of months) byMonth[m] += r.byMonth[m] ?? 0;
    }
  }

  /*
   * ⚠ Y NPPM, que proyecta desde sus REALTORS — etapa OL12.
   *
   * Plano, sin regla: `growth_rule` cuelga de una persona o de un branch, y un
   * realtor no es ninguna de las dos. Suma los benchmarks vigentes, incluido el
   * valor por defecto.
   *
   * Se agregó porque al hacer proyectar a NPPM el total del branch NO se movió y
   * la fila de reconciliación absorbió la diferencia en silencio -- la SEGUNDA
   * vez que pasa, después del presupuesto de branch en OL11. Es la advertencia
   * que quedó escrita en esa fila, cumpliéndose.
   */
  for (const bs of branch.byStrategy) {
    if (bs.opensBy !== 'realtor' || bs.realtors.length === 0) continue;
    const suma = bs.realtors.reduce((a, r) => a + r.benchmark, 0);
    for (const m of months) byMonth[m] += suma;
  }
  /*
   * ⚠ Y EL PRESUPUESTO DE BRANCH QUE TODAVÍA EXISTE, que ya no es de ninguna
   * estrategia en particular.
   *
   * Ninguna estrategia se presupuesta a nivel branch desde OL15, pero hay DOS
   * filas guardadas que sí --las de B2B en el 747 y el 716, cargadas antes del
   * cambio-- y no se pueden reasignar: cada una cubre a dos o tres Business
   * Developers y repartirlas es una decisión de negocio. Se siguen sumando para
   * no borrar un presupuesto real, y la pantalla las muestra como una fila propia
   * en vez de mezclarlas con las personas.
   */
  for (const bs of branch.byStrategy) {
    const hay = bs.mode === 'monthly' ? bs.targetRevision > 0 : bs.benchmarkSchedule.length > 0;
    if (!hay) continue;
    const steps = projectPlan(months, {
      mode: bs.mode,
      benchmarks: bs.benchmarkSchedule,
      segments: bs.rules,
      targets: bs.targets,
    });
    steps.forEach((st) => (byMonth[st.month] += st.value));
  }
  /*
   * ⚠ ENTERO POR MES — etapa OL13. Medio préstamo no existe, y el presupuesto se
   * muestra igual que el resto: sin decimales.
   *
   * Se redondea ACÁ y no en cada vista para que la lista de branches y la tabla
   * del branch usen el mismo número. La tabla reparte este entero entre sus
   * estrategias con `apportionByWeight`, así que sus filas suman exactamente
   * esto: el redondeo ocurre una vez, arriba, y las partes se derivan de él.
   */
  for (const m of months) byMonth[m] = Math.round(byMonth[m]);
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

/**
 * ============================================================================
 * EL PRONÓSTICO DEL MES, EN ENTEROS — etapa OL11
 * ============================================================================
 *
 * La columna del mes en curso mostraba 7,3 · 9,4 · 5,2: decimales en una tabla
 * de préstamos, donde medio préstamo no existe. El resto del portal muestra
 * enteros y Forecast redondea por branch, así que Outlook era el único que no.
 *
 * ⚠ NO ES `Math.round` POR FILA. Redondear cada branch por su cuenta hace que
 * la columna deje de sumar el total: doce branches con .4 hacia abajo pierden
 * casi cinco préstamos que el total sí cuenta. `apportionByWeight` reparte el
 * total REDONDEADO entre los branches en proporción a su pronóstico exacto, así
 * que las partes son enteras Y suman -- es la misma función que usa la barra
 * apilada del Business Plan para el mismo problema.
 *
 * ⚠ Y VIVE EN EL LOADER, no en cada vista. La lista de branches y la tabla de un
 * branch tienen que mostrar el MISMO número: si cada una redondeara por su
 * cuenta, volveríamos al descuadre entre pantallas que la fila de reconciliación
 * acaba de cerrar.
 */
/**
 * ============================================================================
 * ⚠ LOS DOS VOCABULARIOS DE ESTRATEGIA, Y POR QUÉ NO SE UNIFICAN ACÁ
 * ============================================================================
 *
 * Forecast dice `Own production`; Outlook dice `Own Production`. Es la misma
 * cosa con otra mayúscula, y este mapa es el único lugar donde se cruzan.
 *
 * ⚠ MÁS IMPORTANTE: son dos CLASIFICACIONES distintas, no sólo dos nombres.
 *
 *   los meses reales   `activity_report.loan_records_v2.strategy`, que viene
 *                      clasificada desde BigQuery.
 *   el mes en curso    `classifyStrategy` de Forecast, que decide en la app y
 *                      con reglas de BRANCH -- Recruitment es 710, 711 y 777;
 *                      Affinity es el branch 'Affinity'.
 *
 * Hoy no se contradicen en lo que Outlook muestra: este año Affinity sólo cerró
 * en el branch Affinity y Recruitment sólo en el 710, que las dos reglas
 * clasifican igual. El único choque conocido es un cierre de Recruitment en el
 * 716 del año pasado, fuera de la ventana.
 *
 * Se deja anotado porque el día que se contradigan, un branch va a mostrar una
 * estrategia en los meses reales y no en el pronóstico, o al revés, y la causa
 * no va a estar a la vista.
 */
const FORECAST_A_OUTLOOK: Record<string, OutlookStrategy> = {
  'Own production': 'Own Production',
  B2B: 'B2B',
  NPPM: 'NPPM',
  Recruitment: 'Recruitment',
  Affinity: 'Affinity',
};

export function currentMonthByBranch(data: {
  branches: OutlookBranch[];
  currentMonth: string;
}): Map<string, number> {
  const exacto = data.branches.map((b) => {
    /*
     * Misma regla que ya usaban las dos vistas: si el branch proyecta, manda el
     * pronóstico --que ya incluye lo cerrado del mes--; si no, lo cerrado, que es
     * un piso real. Ver el bloque de AFFINITY en la vista 1.
     */
    const proyecta = b.loanOfficers.some((l) => l.primaryBranch === b.branchCode);
    return proyecta ? b.currentMonth : (b.actualByMonth[data.currentMonth] ?? 0);
  });
  const total = Math.round(exacto.reduce((a, x) => a + x, 0));
  const partes = apportionByWeight(total, exacto);
  return new Map(data.branches.map((b, i) => [b.branchCode, partes[i]]));
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
