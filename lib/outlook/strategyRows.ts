import { apportionByWeight } from '@/lib/pipeline/aggregate';
import {
  composeYear,
  currentMonthByBranch,
  projectBranch,
  projectLoanOfficer,
  type BranchRecruit,
  type BranchStrategy,
  type OutlookBranch,
  type OutlookData,
  type OutlookLoanOfficer,
  type YearRow,
} from '@/lib/outlook/loadData';
import { projectPlan, type OutlookStrategy } from '@/lib/outlook/project';

/**
 * ============================================================================
 * LA FILA DE UNA ESTRATEGIA EN UN BRANCH — etapa OL21, ARCHIVO NUEVO
 * ============================================================================
 *
 * ⚠ POR QUÉ EXISTE, y por qué NO se copió el código: hasta OL21 esto vivía
 * dentro de `app/outlook/branch/[code]/page.tsx` y sólo lo usaba esa pantalla.
 * El filtro de estrategia de la vista 1 necesita los mismos números por branch,
 * y hay exactamente dos formas de conseguirlos:
 *
 *   copiarlos     las dos pantallas empiezan iguales y se separan en el primer
 *                 arreglo que se haga en una sola. Nada avisa: cada una suma
 *                 bien por su cuenta.
 *   compartirlos  una diferencia entre las dos vistas es imposible por
 *                 construcción.
 *
 * Es la misma decisión que ya tomó `currentMonthByBranch` en el loader, y por el
 * mismo motivo escrito ahí: "la misma función la usa la tabla de un branch, así
 * que las dos pantallas muestran el mismo número".
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LAS DOS VISTAS LEEN DE ACÁ — migración completa en OL22
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * En OL21 esto nació como copia y la vista 2 se quedó con la suya: dos
 * implementaciones del mismo cálculo, que es exactamente lo que este archivo
 * dice que no hay que hacer. En OL22 se borró la de la vista 2 --unas 220 líneas
 * entre helpers y las dos cascadas-- y las dos pantallas quedaron leyendo de
 * acá. Una diferencia entre ellas ya no es posible por construcción.
 *
 * ⚠ CÓMO SE VERIFICÓ LA MIGRACIÓN, en dos pasos y en este orden:
 *
 * 1. ANTES de borrar nada, que las dos dieran lo mismo. Con el filtro de la
 *    vista 1 en cada estrategia, su fila de un branch contra la fila de esa
 *    estrategia en la vista 2 del mismo branch. Las trece celdas iguales en las
 *    cinco, medido el 2026-09-03:
 *
 *      Own Production 747   3 2 5 8 4 1 6 4 5 7 7 9 = 61
 *      B2B            747   0 0 1 5 2 3 4 2 2 2 2 3 = 26
 *      NPPM           733   0 0 0 0 1 4 1 0 0 2 2 2 = 12
 *      Recruitment    747   0 0 0 0 0 0 0 0 1 0 0 0 = 1
 *      Affinity       716   0 0 0 0 0 0 0 0 4 0 0 0 = 4
 *
 * 2. DESPUÉS de borrarla, que la vista 2 no se moviera. Se volcó la pantalla
 *    ENTERA a JSON --los 19 branches, todas las estrategias abiertas, 183
 *    filas-- antes y después, y se comparó con `diff`: idéntico, 38.798 bytes
 *    los dos.
 *
 *    ⚠ LA COMPARACIÓN VIVE AFUERA DEL SCRIPT QUE GENERA LOS VOLCADOS, a
 *    propósito. Si viviera adentro, un bug del script podría dar verde sobre dos
 *    salidas distintas -- que es el modo en que fallaron cuatro de las cinco
 *    verificaciones de la tabla de AGENTS.md.
 *
 * Y un control independiente que no mira ninguna de las dos: las cinco
 * estrategias suman 632 y el total de la división da 647. La diferencia --15--
 * son exactamente los cierres de originadores de fuera de la división, que no
 * pertenecen a ninguna estrategia. Que ese número caiga solo es la señal de que
 * el reparto no perdió ni inventó nada.
 *
 * ⚠ UNA DIFERENCIA QUE LA MIGRACIÓN CORRIGIÓ, y no cambió ningún número hoy: la
 * vista 2 armaba el presupuesto de una estrategia SIEMPRE desde el reparto, así
 * que una estrategia sin de dónde proyectar mostraba `0` -- mientras su propio
 * comentario decía que tenía que mostrar vacío. Acá va `null`. Hoy no se ve
 * porque las 33 estrategias visibles proyectan todas; el día que aparezca una
 * que no, va a decir vacío en las dos pantallas en vez de `0` en una.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LAS DOS CASCADAS DE REDONDEO, que son la parte delicada
 * ---------------------------------------------------------------------------
 *
 * Medio préstamo no existe, así que ninguna celda muestra decimales. Pero
 * redondear cada celda por separado rompe las dos sumas que la tabla garantiza:
 * la de la columna (las estrategias dan el total del branch) y la de la fila.
 *
 * Por eso el entero se reparte con `apportionByWeight`, que garantiza que las
 * partes sumen el total y nada más -- un peso que falta se redistribuye en
 * silencio, así que la lista de estrategias que entra tiene que ser LA MISMA que
 * la que se dibuja. De ahí que `filasBase` viva acá y no en cada pantalla.
 *
 * ⚠ Y EL TOTAL A REPARTIR SALE DE `branchYear`, que ya viene entero del loader.
 * Redondear acá la suma de los pesos daría el mismo número hoy, pero serían DOS
 * redondeos del mismo valor: el día que difieran por un caso de medio punto, las
 * filas dejarían de sumar el total y nada lo diría.
 */

/** Tiene un número propio fijado: un benchmark, o metas mes a mes. */
export function tienePresupuestoPropio(lo: OutlookLoanOfficer, s: OutlookStrategy): boolean {
  return (lo.strategyBenchmarks[s] ?? 0) > 0 || Object.keys(lo.targetsByStrategy[s] ?? {}).length > 0;
}

/**
 * ⚠ QUIÉNES ABREN UNA ESTRATEGIA QUE SE ABRE POR PERSONA — etapa OL19.
 *
 * No son siempre todos. `opensBy: 'loanOfficer'` abría `branch.loanOfficers`
 * entero, que es correcto para Own Production y falso para Recruitment:
 *
 *   Own Production  es la PERTENENCIA POR DEFECTO. Todo Loan Officer del branch
 *                   está en ella por definición; su fila en cero ES la
 *                   información -- dice que no produjo.
 *   Recruitment     es un PROGRAMA EN EL QUE SE PARTICIPA. Quien no participa no
 *                   tiene una fila en cero: no tiene fila.
 *
 * Medido en el 710 --el único branch con cierres de Recruitment-- abría 7 filas
 * para 5 participantes.
 */
export function participa(lo: OutlookLoanOfficer, s: OutlookStrategy): boolean {
  return (
    s !== 'Recruitment' ||
    (lo.strategies.find((x) => x.strategy === s)?.ytd ?? 0) > 0 ||
    tienePresupuestoPropio(lo, s)
  );
}

/**
 * Las personas que abren esta estrategia. UN SOLO LUGAR, y hace falta que lo
 * sea: el mismo conjunto lo leen el presupuesto exacto, el benchmark sumado, el
 * "N of M" de la regla y las filas hijas. Filtrar en cuatro lugares deja cuatro
 * conjuntos que pueden diferir, y el que difiera rompe la suma sin que nada
 * avise.
 */
export function personasDe(branch: OutlookBranch, bs: BranchStrategy): OutlookLoanOfficer[] {
  return bs.opensBy !== 'loanOfficer' ? [] : branch.loanOfficers.filter((lo) => participa(lo, bs.strategy));
}

export function esDelBranch(bs: BranchStrategy): boolean {
  return bs.opensBy === 'branch';
}

export function branchHasBudget(bs: BranchStrategy): boolean {
  return bs.mode === 'monthly' ? bs.targetRevision > 0 : bs.benchmarkSchedule.length > 0;
}

/**
 * ⚠ QUÉ ESTRATEGIAS MUESTRA UN BRANCH — etapa OL12.
 *
 * Sólo las que tienen ALGO: producción en cualquier mes, pronóstico del mes en
 * curso, un presupuesto guardado, realtors o gente en contratación. Nada de
 * filas en cero permanente.
 *
 * Medido: Affinity existe SÓLO en el branch Affinity y Recruitment sólo en el
 * 710. En los otros catorce eran dos filas de ceros ocupando lugar.
 *
 * ⚠ El presupuesto cuenta aunque no haya producción: una estrategia a la que
 * recién se le fijó un número TIENE que verse, o el número no se podría revisar
 * ni corregir.
 */
export function tieneAlgo(branch: OutlookBranch, bs: BranchStrategy, currentMonth: string): boolean {
  return (
    bs.ytd > 0 ||
    bs.currentMonthRaw > 0 ||
    (bs.actualByMonth[currentMonth] ?? 0) > 0 ||
    bs.benchmarkSchedule.length > 0 ||
    bs.targetRevision > 0 ||
    bs.realtors.length > 0 ||
    /* Los reclutas — OL20: el 728 tiene uno y ni un cierre de Recruitment. */
    bs.recruits.length > 0 ||
    (bs.opensBy === 'loanOfficer' &&
      branch.loanOfficers.some((lo) => tienePresupuestoPropio(lo, bs.strategy)))
  );
}

/**
 * El presupuesto EXACTO de una estrategia, con decimales y sin repartir. Es el
 * peso con el que después se reparte el entero del branch.
 */
export function exactoDe(
  branch: OutlookBranch,
  bs: BranchStrategy,
  remainingMonths: string[]
): Record<string, number> {
  const out: Record<string, number> = {};

  if (bs.opensBy === 'loanOfficer') {
    /*
     * ⚠ POR `projectLoanOfficer` Y NO POR `projectPlan` SUELTO. Es la misma
     * puerta que usa el total de la persona, así que la estrategia no puede
     * proyectar distinto de lo que proyecta su dueño -- `stepsByStrategy` es el
     * desglose del mismo cálculo, no un segundo cálculo.
     */
    for (const lo of personasDe(branch, bs)) {
      const st = projectLoanOfficer(lo, remainingMonths).stepsByStrategy[bs.strategy] ?? [];
      remainingMonths.forEach((m, i) => (out[m] = (out[m] ?? 0) + (st[i]?.value ?? 0)));
    }
  } else if (bs.opensBy === 'owner') {
    for (const o of bs.owners) {
      if (!o.isPerson) continue;
      const steps = projectPlan(remainingMonths, {
        mode: o.mode,
        benchmarks: o.benchmarkSchedule,
        segments: o.rules,
        targets: o.targets,
      });
      remainingMonths.forEach((m, i) => (out[m] = (out[m] ?? 0) + (steps[i]?.value ?? 0)));
    }
    /*
     * ⚠ MÁS EL PRESUPUESTO DE BRANCH QUE QUEDÓ SIN DUEÑO.
     *
     * Ninguna estrategia se presupuesta a nivel branch desde OL15, pero hay dos
     * filas guardadas antes del cambio --B2B en el 747 y en el 716-- que no se
     * pueden reasignar: cada una cubre a dos o tres Business Developers y
     * repartirlas es una decisión de negocio. Se siguen sumando para no borrar un
     * presupuesto real.
     */
    if (branchHasBudget(bs)) {
      const steps = projectPlan(remainingMonths, {
        mode: bs.mode,
        benchmarks: bs.benchmarkSchedule,
        segments: bs.rules,
        targets: bs.targets,
      });
      remainingMonths.forEach((m, i) => (out[m] = (out[m] ?? 0) + (steps[i]?.value ?? 0)));
    }
  } else if (esDelBranch(bs) && branchHasBudget(bs)) {
    const steps = projectPlan(remainingMonths, {
      mode: bs.mode,
      benchmarks: bs.benchmarkSchedule,
      segments: bs.rules,
      targets: bs.targets,
    });
    remainingMonths.forEach((m, i) => (out[m] = steps[i]?.value ?? 0));
  } else if (bs.opensBy === 'realtor' && bs.realtors.length > 0) {
    const suma = bs.realtors.reduce((a, r) => a + r.benchmark, 0);
    remainingMonths.forEach((m) => (out[m] = suma));
  }

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ Y LA GENTE EN CONTRATACIÓN, QUE FALTABA — arreglado en OL22
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Va FUERA del `if`, y a propósito: un recluta puede estar en Recruitment o en
   * NPPM, así que sumarlo dentro de una rama lo dejaría afuera de la otra.
   *
   * ⚠ EL BUG QUE ARREGLA, que ningún número mostraba: `projectBranch` YA sumaba
   * los reclutas al total del branch, y este peso no los incluía. Como
   * `apportionByWeight` garantiza que las partes sumen el total pase lo que
   * pase, ese excedente no desaparecía: se repartía entre las OTRAS estrategias,
   * y la del recluta quedaba corta. En silencio, porque la columna seguía
   * sumando bien.
   *
   * ⚠ ERA INVISIBLE Y ESTABA ESPERANDO: los 15 reclutas de hoy tienen
   * `monthlyBenchmark` en null, así que ninguno proyecta y el excedente es cero.
   * Es el patrón de `AGENTS.md` -- el código no cambió, lo que iba a cambiar es
   * el conjunto de entradas que lo alcanza, en cuanto alguien fije el primer
   * benchmark.
   *
   * ⚠ CÓMO RE-COMPROBARLO sin escribir en la base --las tablas de OL20 no tienen
   * policy de DELETE, así que una fila de prueba se queda para siempre--:
   *
   *     npx tsx scripts/check-recruit-weight.ts
   *
   * Arma un branch sintético con un recluta que proyecta 1/2/4 y compara
   * `projectBranch` contra `exactoDe`. Los dos tienen que dar 7.
   */
  for (const r of bs.recruits) {
    for (const m of remainingMonths) out[m] = (out[m] ?? 0) + (r.byMonth[m] ?? 0);
  }
  return out;
}

/**
 * El presupuesto entero de UNA estrategia, repartido entre las personas que la
 * abren -- etapa OL26. Extraído del `.map()` que armaba esto inline en
 * `branch/[code]/page.tsx` (Own Production) para reusarlo también con
 * Recruitment: la vista rehecha combina las dos por Loan Officer.
 *
 * ⚠ Mismo mecanismo de siempre: `apportionByWeight` sobre el presupuesto YA
 * repartido de la estrategia (`budgetPorMes`, el mismo que muestra su fila),
 * pesado por la proyección EXACTA de cada persona (`projectLoanOfficer`, la
 * misma puerta que su total). Devuelve en el mismo orden que `personasDe`.
 */
export function personBudgetsOf(
  branch: OutlookBranch,
  bs: BranchStrategy,
  remainingMonths: string[],
  budgetPorMes: Record<string, number>
): Record<string, number>[] {
  const personas = personasDe(branch, bs);
  const exactos = personas.map((lo) => {
    const st = projectLoanOfficer(lo, remainingMonths).stepsByStrategy[bs.strategy] ?? [];
    const out: Record<string, number> = {};
    remainingMonths.forEach((m, i) => (out[m] = st[i]?.value ?? 0));
    return out;
  });
  const enteros: Record<string, number>[] = personas.map(() => ({}));
  for (const m of remainingMonths) {
    const partes = apportionByWeight(budgetPorMes[m] ?? 0, exactos.map((e) => e[m] ?? 0));
    partes.forEach((v, i) => (enteros[i][m] = v));
  }
  return enteros;
}

/** Una fila de Loan Officer en el nuevo agrupamiento por persona — etapa OL26. */
export interface PersonBudgetRow {
  lo: OutlookLoanOfficer;
  /** `true` si esta persona participa de Recruitment (ver `participa`). */
  participatesInRecruitment: boolean;
  /** Own Production + Recruitment combinados: real, mes en curso, presupuesto futuro. */
  year: YearRow;
}

/** Un recluta de Recruitment (`role === 'loan_officer'`), con su parte del presupuesto ya repartida junto con las personas -- etapa OL26. */
export interface RecruitBudgetRow {
  recruit: BranchRecruit;
  year: YearRow;
}

export interface LoanOfficerSection {
  personRows: PersonBudgetRow[];
  /** Los reclutas de Recruitment (`role: 'loan_officer'`) -- filtrados por `shouldShowRecruit` NO se hace acá, eso es de la pantalla. */
  recruitRows: RecruitBudgetRow[];
}

/**
 * ============================================================================
 * LOS LOAN OFFICERS DE UN BRANCH, UNA FILA POR PERSONA — etapa OL26
 * ============================================================================
 *
 * Reemplaza la vista por estrategia (Own Production y Recruitment, cada una
 * abierta por Loan Officer) por una vista por PERSONA: cada Loan Officer del
 * roster es una sola fila con sus dos estrategias sumadas -- porque las dos
 * se abren por la misma unidad de decisión (la persona) y preguntar "cuánto
 * hace Fulano" no debería obligar a sumar dos filas a mano.
 *
 * ⚠ EL MES EN CURSO NO SE REPARTE ENTRE ESTRATEGIAS Y SE SUMA DESPUÉS -- se
 * reparte DIRECTO entre personas, con el peso que cada una YA TIENE:
 * `lo.currentMonth`, el pronóstico INDIVIDUAL que ya calcula el Business Plan
 * (no una estimación armada acá). `branch.currentMonth` es, por construcción,
 * la suma exacta de estos números (ver `loadData.ts`, donde se arma
 * `OutlookBranch.currentMonth`) -- así que el peso correcto siempre estuvo
 * disponible, entero, por persona. Los reclutas NUNCA participan de este
 * reparto: su `byMonth` no cubre el mes en curso (`projectRecruit` proyecta
 * sólo los meses que quedan del año), así que su mes en curso es siempre
 * vacío -- lo mismo que ya hacía la pantalla anterior.
 *
 * ⚠ ESTO ES LO QUE ESTABA MAL EN EL 710 -- Recruitment. Cualquier reparto que
 * use un peso DISTINTO de `lo.currentMonth` (el YTD acumulado, el benchmark, o
 * repartir primero por estrategia y sumar después) le da al 710 una
 * proporción que no es la de su pronóstico real: ahí Recruitment es la
 * producción real de varias personas, no un programa marginal, y un peso que
 * no lo refleja concentra el mes en una sola fila en vez de repartirlo entre
 * quienes efectivamente lo producen.
 *
 * `apportionByWeight(branchCurrent, todos_los_currentMonth)` incluye a TODOS
 * los `branch.loanOfficers` como peso -- no sólo a quien participa de
 * Recruitment -- así que nadie con pronóstico real puede quedar fuera de los
 * pesos: es exactamente el modo de falla que el brief pide vigilar.
 *
 * ⚠ Y EL PRESUPUESTO FUTURO DE RECRUITMENT SE REPARTE ENTRE PERSONAS **Y**
 * RECLUTAS JUNTOS, no en dos pasos. `recRow.budget` (de `strategyRowsOf`) ya
 * incluye el peso de los reclutas (`exactoDe` los suma al presupuesto exacto
 * de la estrategia, fuera del `if` de personas -- ver esa función). Repartir
 * ese mismo total SÓLO entre las personas --como haría `personBudgetsOf`
 * genérica, que no sabe de reclutas-- les daría de más, absorbiendo en
 * silencio lo que le toca a cada recluta: exactamente el modo de falla del
 * brief, esta vez con los reclutas como la fuente que "queda fuera de los
 * pesos". Por eso acá el reparto de Recruitment es uno solo, con las personas
 * y los reclutas como pesos del mismo `apportionByWeight`.
 */
export function loanOfficerRowsOf(
  data: OutlookData,
  branch: OutlookBranch,
  monthsOfYear: string[],
  remainingMonths: string[]
): LoanOfficerSection {
  const { currentMonth } = data;
  const branchCurrent = currentMonthByBranch(data).get(branch.branchCode) ?? 0;
  const los = branch.loanOfficers;

  const bsOwn = branch.byStrategy.find((b) => b.strategy === 'Own Production');
  const bsRec = branch.byStrategy.find((b) => b.strategy === 'Recruitment');
  const recruitsLO = (bsRec?.recruits ?? []).filter((r) => r.role === 'loan_officer');

  /*
   * El presupuesto entero de cada estrategia sale de `strategyRowsOf` -- el
   * MISMO cálculo que ya muestra el resto de la vista, no uno nuevo. Si una
   * estrategia no tiene nada que mostrar (`tieneAlgo` la excluyó), su
   * presupuesto por persona es 0 en todos los meses: no hay de dónde repartir.
   */
  const sRows = strategyRowsOf(data, branch, monthsOfYear, remainingMonths);
  const ownRow = sRows.find((r) => r.strategy === 'Own Production');
  const recRow = sRows.find((r) => r.strategy === 'Recruitment');
  const zeroBudget = Object.fromEntries(remainingMonths.map((m) => [m, 0]));

  const ownPersonas = bsOwn ? personasDe(branch, bsOwn) : [];
  const ownBudgets = bsOwn ? personBudgetsOf(branch, bsOwn, remainingMonths, ownRow?.budget ?? zeroBudget) : [];

  /* Recruitment: personas Y reclutas, en un solo reparto -- ver la nota de arriba. */
  const recPersonas = bsRec ? personasDe(branch, bsRec) : [];
  const exactosPersonasRec = recPersonas.map((lo) => {
    const st = projectLoanOfficer(lo, remainingMonths).stepsByStrategy['Recruitment'] ?? [];
    const out: Record<string, number> = {};
    remainingMonths.forEach((m, i) => (out[m] = st[i]?.value ?? 0));
    return out;
  });
  const recBudget = recRow?.budget ?? zeroBudget;
  const enterosRec: Record<string, number>[] = [...recPersonas, ...recruitsLO].map(() => ({}));
  for (const m of remainingMonths) {
    const pesos = [...exactosPersonasRec.map((e) => e[m] ?? 0), ...recruitsLO.map((r) => r.byMonth[m] ?? 0)];
    const partes = apportionByWeight(recBudget[m] ?? 0, pesos);
    partes.forEach((v, i) => (enterosRec[i][m] = v));
  }
  const recBudgetsPersonas = enterosRec.slice(0, recPersonas.length);
  const recBudgetsReclutas = enterosRec.slice(recPersonas.length);

  const partesCurrent = apportionByWeight(
    branchCurrent,
    los.map((lo) => lo.currentMonth)
  );

  const personRows: PersonBudgetRow[] = los.map((lo, idx) => {
    const ownIdx = ownPersonas.findIndex((p) => p.employeeKey === lo.employeeKey);
    const recIdx = recPersonas.findIndex((p) => p.employeeKey === lo.employeeKey);
    const ownYtd = lo.strategies.find((s) => s.strategy === 'Own Production');
    const recYtd = lo.strategies.find((s) => s.strategy === 'Recruitment');

    const actualByMonth: Record<string, number> = {};
    for (const m of monthsOfYear) {
      actualByMonth[m] = (ownYtd?.actualByMonth[m] ?? 0) + (recYtd?.actualByMonth[m] ?? 0);
    }
    const projected: Record<string, number | null> = {};
    for (const m of remainingMonths) {
      const own = ownIdx >= 0 ? (ownBudgets[ownIdx]?.[m] ?? 0) : 0;
      const rec = recIdx >= 0 ? (recBudgetsPersonas[recIdx]?.[m] ?? 0) : 0;
      projected[m] = own + rec;
    }

    return {
      lo,
      participatesInRecruitment: recIdx >= 0,
      year: composeYear(monthsOfYear, currentMonth, actualByMonth, partesCurrent[idx], projected),
    };
  });

  const recruitRows: RecruitBudgetRow[] = recruitsLO.map((recruit, idx) => ({
    recruit,
    /*
     * El recluta no tiene mes en curso (siempre vacío, `null`) ni meses
     * cerrados (todavía no está): sólo su parte del presupuesto futuro.
     */
    year: composeYear(monthsOfYear, currentMonth, {}, null, recBudgetsReclutas[idx] ?? {}),
  }));

  return { personRows, recruitRows };
}

export interface StrategyRow {
  bs: BranchStrategy;
  strategy: OutlookStrategy;
  /** La fila de doce (o más) meses, ya entera y repartida. */
  year: YearRow;
  /** El mes en curso de esta estrategia, repartido. */
  current: number;
  /** El presupuesto entero por mes, repartido entre las estrategias. */
  budget: Record<string, number>;
  /** `true` si tiene de dónde proyectar. Si no, sus meses futuros van vacíos. */
  proyecta: boolean;
}

/**
 * Las filas de estrategia de UN branch, con sus dos repartos hechos.
 *
 * ⚠ DEVUELVE SÓLO LAS QUE `tieneAlgo`, y eso importa para el reparto: los pesos
 * que entran a `apportionByWeight` tienen que ser los de las filas que se
 * dibujan. Si la pantalla filtrara después, el entero repartido incluiría filas
 * que no se ven y la columna dejaría de sumar el total.
 */
export function strategyRowsOf(
  data: OutlookData,
  branch: OutlookBranch,
  monthsOfYear: string[],
  remainingMonths: string[]
): StrategyRow[] {
  const { currentMonth } = data;
  const branchCurrent = currentMonthByBranch(data).get(branch.branchCode) ?? 0;
  const branchYear = composeYear(
    monthsOfYear,
    currentMonth,
    branch.actualByMonth,
    branchCurrent,
    projectBranch(branch, remainingMonths)
  );

  const filasBase = branch.byStrategy.filter((bs) => tieneAlgo(branch, bs, currentMonth));

  /* El mes en curso del branch, repartido entre sus estrategias. */
  const proyectaAlgo = filasBase.some((bs) => bs.currentMonthRaw > 0);
  const pesosCurrent = filasBase.map((bs) =>
    proyectaAlgo ? bs.currentMonthRaw : (bs.actualByMonth[currentMonth] ?? 0)
  );
  const currentPorEstrategia = apportionByWeight(branchCurrent, pesosCurrent);

  /* Y el presupuesto de cada mes futuro, con la misma garantía. */
  const exactos = filasBase.map((bs) => exactoDe(branch, bs, remainingMonths));
  const budgets: Record<string, number>[] = filasBase.map(() => ({}));
  for (const m of remainingMonths) {
    const partes = apportionByWeight(
      branchYear.byMonth[m] ?? 0,
      exactos.map((e) => e[m] ?? 0)
    );
    partes.forEach((v, i) => (budgets[i][m] = v));
  }

  return filasBase.map((bs, i) => {
    /* Proyecta si el reparto le dio algo, o si tiene con qué proyectar. */
    const proyecta =
      bs.opensBy === 'loanOfficer' ||
      (esDelBranch(bs) && branchHasBudget(bs)) ||
      bs.opensBy === 'owner' ||
      (bs.opensBy === 'realtor' && bs.realtors.length > 0) ||
      /*
       * ⚠ O TIENE GENTE EN CONTRATACIÓN — OL22. Sin esto, un branch cuyo NPPM
       * todavía no tiene realtors pero sí un recluta asignado mostraría su fila
       * de presupuesto VACÍA mientras el total del branch ya lo cuenta: el
       * descuadre sin explicación que el módulo evita en todos lados.
       */
      bs.recruits.length > 0;
    return {
      bs,
      strategy: bs.strategy,
      current: currentPorEstrategia[i],
      budget: budgets[i],
      proyecta,
      year: composeYear(
        monthsOfYear,
        currentMonth,
        bs.actualByMonth,
        currentPorEstrategia[i],
        /*
         * ⚠ VACÍO Y NO CERO cuando no proyecta. Un cero afirmaría que se espera
         * cero; vacío dice que no hay de dónde proyectar. Es la distinción que el
         * módulo usa en todas partes.
         */
        proyecta
          ? budgets[i]
          : Object.fromEntries(remainingMonths.map((m) => [m, null]))
      ),
    };
  });
}
