import { apportionByWeight } from '@/lib/pipeline/aggregate';
import {
  composeYear,
  currentMonthByBranch,
  projectBranch,
  projectLoanOfficer,
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
 * ⚠ ESTADO REAL HOY: LA VISTA 2 TODAVÍA TIENE SU PROPIA COPIA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * La vista 1 usa esto. `app/outlook/branch/[code]/page.tsx` sigue calculándolo
 * inline: `filasBase`, `agostoDe`, `presupuestoDe` y sus helpers viven ahí igual
 * que antes. O sea que HOY el código está duplicado, que es justo lo que este
 * archivo dice que no hay que hacer.
 *
 * Se deja así --y escrito-- por una razón de riesgo y no de gusto: la vista 2 es
 * la pantalla más verificada del módulo, y rehacer sus llamadas al final de una
 * etapa de seis ítems es el momento más malo para tocarla. Lo que sí se hizo es
 * la parte que vuelve segura esa migración: se verificó que las dos den lo
 * MISMO, celda por celda.
 *
 * ⚠ CÓMO SE VERIFICÓ, para poder repetirlo antes de migrar: con el filtro de la
 * vista 1 en cada estrategia, se compara su fila de un branch contra la fila de
 * esa estrategia en la vista 2 de ese mismo branch. Medido el 2026-09-03, las
 * trece celdas iguales en las cinco:
 *
 *   Own Production 747   3 2 5 8 4 1 6 4 5 7 7 9 = 61
 *   B2B            747   0 0 1 5 2 3 4 2 2 2 2 3 = 26
 *   NPPM           733   0 0 0 0 1 4 1 0 0 2 2 2 = 12
 *   Recruitment    747   0 0 0 0 0 0 0 0 1 0 0 0 = 1
 *   Affinity       716   0 0 0 0 0 0 0 0 4 0 0 0 = 4
 *
 * Y un control independiente que no mira ninguna de las dos: las cinco
 * estrategias suman 632 y el total de la división da 647. La diferencia --15--
 * son exactamente los cierres de originadores de fuera de la división, que no
 * pertenecen a ninguna estrategia. Que ese número caiga solo es la señal de que
 * el reparto no perdió ni inventó nada.
 *
 * ⚠ EL PRÓXIMO QUE TOQUE ESTO: migrar la vista 2 a estas funciones y borrar su
 * copia, corriendo esa comparación antes y después. Mientras la copia exista,
 * un arreglo va en LOS DOS lados.
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
  return out;
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
      (bs.opensBy === 'realtor' && bs.realtors.length > 0);
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
