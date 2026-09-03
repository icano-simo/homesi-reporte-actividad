'use client';

import { Fragment, use, useState } from 'react';
import Link from 'next/link';
import { addMonths } from '@/lib/business-plan/impact';
import { apportionByWeight } from '@/lib/pipeline/aggregate';
import {
  composeYear,
  currentMonthByBranch,
  projectLoanOfficer,
  projectBranch,
  type OutlookLoanOfficer,
  type BranchStrategy,
  type BranchRecruit,
} from '@/lib/outlook/loadData';
import { STAGE_LABEL, type NotProjectingReason, type RecruitStage } from '@/lib/outlook/recruitment';
import {
  cadenceLabel,
  projectPlan,
  type GrowthSegment,
  type OutlookStrategy,
  type ProjectionMode,
} from '@/lib/outlook/project';
import { fmt, sumOfShown } from '@/lib/outlook/format';
import { useOutlookDataContext } from '@/lib/outlook/useOutlookData';
import StrategyEditor, { type OutlookEditable } from '@/app/outlook/components/StrategyEditor';
import NppmEditor from '@/app/outlook/components/NppmEditor';
import RecruitEditor, { branchOptions } from '@/app/outlook/components/RecruitEditor';
/*
 * ⚠ UNA SOLA IMPLEMENTACION del calculo por estrategia — etapa OL22. Esta
 * pantalla tenia su propia copia y la vista 1 otra; ahora las dos leen de acá.
 * Ver la nota de la migración donde estaban los helpers.
 */
import {
  branchHasBudget,
  esDelBranch,
  personasDe as personasDeBranch,
  strategyRowsOf,
} from '@/lib/outlook/strategyRows';

/**
 * ============================================================================
 * OUTLOOK — VISTA 2: dentro de un branch (etapas OL1b, OL2, OL3 y OL7)
 * ============================================================================
 *
 * DOS BLOQUES, y la razón por la que son dos — etapa OL7:
 *
 *   1. LOAN OFFICERS DEL BRANCH, en filas planas. Quiénes son y cuánto hace
 *      cada uno. Se lee de un barrido, sin abrir nada.
 *   2. PRESUPUESTO POR ESTRATEGIA, cada estrategia abriéndose a las personas
 *      que la aportan, con el editor adentro. Acá se decide.
 *
 * ⚠ ANTES ERA UNA SOLA TABLA con la jerarquía al revés: persona → estrategia.
 * Para saber cuánto NPPM tenía el branch había que abrir las ocho personas y
 * sumar a mano ocho filas, y la pregunta "¿cuánto vale esta estrategia acá?"
 * --que es la que se hace al fijar un presupuesto-- no tenía respuesta en la
 * pantalla. Invertir el segundo bloque la contesta directo, y el primero sigue
 * contestando "¿quién hace cuánto?".
 *
 * Los dos bloques miran los MISMOS números por la misma fórmula: la celda de una
 * persona en una estrategia se calcula en `cellOf` y las dos jerarquías la suman.
 * No hay una segunda cuenta que pueda divergir.
 *
 * ---------------------------------------------------------------------------
 * ETAPA OL2 — acá se DECIDE, no sólo se mira
 * ---------------------------------------------------------------------------
 * Cada fila de persona dentro de una estrategia abre su editor (benchmark +
 * regla de crecimiento) y cada fila de realtor abre el suyo. La edición vive
 * donde está el número que cambia, no en una pantalla de configuración aparte:
 * quien mira una proyección en cero y quiere arreglarla ya está en la fila
 * correcta.
 *
 * ⚠ Al guardar se RECARGA todo con `loadOutlookData`, no se parchea el estado en
 * memoria. Es más lento y es a propósito: lo que queda en la pantalla es lo que
 * la base devuelve, así que un guardado que no tuvo el efecto esperado se ve
 * acá y no en el próximo refresh de alguien más.
 *
 * ---------------------------------------------------------------------------
 * ETAPA OL3 — los doce meses, y LA ÚNICA FILA QUE NO CIERRA
 * ---------------------------------------------------------------------------
 * Las tres bandas (real · pronóstico · presupuesto) son las mismas que en la
 * vista 1 y se rotulan igual.
 *
 * ⚠ El bloque de estrategias NO suma el mes en curso, y el de personas sí: la
 * diferencia entre los dos totales es exactamente ese mes. Forecast lo calcula
 * sobre el pipeline, que no lleva la estrategia consigo, así que por estrategia
 * ese mes dice `no data` -- no 0, que sería afirmar que no va a cerrar nada.
 *
 * Es la única excepción a "cada nivel es la suma del de abajo" en todo el
 * módulo, y está dicha en la pantalla --en los tooltips de los dos totales y en
 * el rótulo del bloque-- porque una jerarquía que casi siempre cierra y una vez
 * no, sin explicación, se reporta como bug. Se cierra el día que el mes en curso
 * se pueda abrir por estrategia (ver la etapa pendiente en `project.ts`).
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.split('-')[1]) - 1];

function bandOf(month: string, currentMonth: string): 'actual' | 'forecast' | 'budget' {
  return month < currentMonth ? 'actual' : month === currentMonth ? 'forecast' : 'budget';
}

/**
 * Cómo se está fijando esta estrategia PARA ESTA PERSONA, en una línea.
 *
 * ⚠ Dice el MODO primero, porque es lo que decide si el resto de la línea
 * significa algo — etapa OL4. Una regla de crecimiento en una estrategia fijada
 * mes a mes está guardada y no se aplica, y mostrarla sin decirlo haría pensar
 * que los meses salieron de ella.
 *
 * En modo `growth` la línea lleva CUÁNDO cae el primer aumento: sin eso, "25%
 * trimestral desde septiembre" con Sep/Oct/Nov todos iguales al benchmark se lee
 * como un error de la tabla. El benchmark ES el objetivo de septiembre y el
 * primer aumento cae al cumplirse el trimestre -- en diciembre.
 */
function ruleLabel(lo: OutlookLoanOfficer, strategy: OutlookStrategy, months: string[]): string {
  if ((lo.modeByStrategy[strategy] ?? 'growth') === 'monthly') {
    const rev = lo.targetRevision[strategy] ?? 0;
    return rev === 0 ? 'month by month · no numbers set' : 'month by month · numbers set by hand';
  }
  const segments = lo.rulesByStrategy[strategy] ?? [];
  if (segments.length === 0) return 'no rule';
  const steps = projectLoanOfficer(lo, months).stepsByStrategy[strategy] ?? [];
  const firstRaise = steps.find((s) => s.periods >= 1);
  const s = segments[0];
  const base = `${s.growthPct}% ${cadenceLabel(s.cadence)} from ${monthLabel(s.fromMonth)}`;
  const extra = segments.length > 1 ? ` (+${segments.length - 1} segment${segments.length > 2 ? 's' : ''})` : '';
  const raise = firstRaise ? ` · 1st raise in ${monthLabel(firstRaise.month)}` : ' · no raise this year';
  return base + extra + raise;
}

/**
 * ⚠ ¿HAY UNA DECISIÓN QUE PROYECTAR? — etapa OL11.
 *
 * Sin esto, una estrategia sin presupuesto proyectaba 0 en vez de quedar vacía:
 * `benchmarkAt([], m)` devuelve 0 y `projectMonth` sobre 0 da 0, así que la
 * pantalla afirmaba "se decidió que no cierre nada" donde la verdad es "nadie
 * decidió todavía". Es la misma distinción que sostiene `fmt`: el cero es un
 * dato y la ausencia es otra cosa.
 *
 * Se mira el MODO vigente, no los dos: una estrategia en modo mes a mes con una
 * regla vieja guardada no proyecta por la regla.
 */
/**
 * ⚠ ¿SU PRESUPUESTO ES DEL BRANCH? HOY NINGUNO — etapa OL15.
 *
 * Devuelve `false` para las cinco estrategias, y eso es el punto de esta etapa:
 * el modelo dejó de tener DOS formas de pertenencia. Toda decisión cuelga de una
 * persona --Loan Officer, realtor o dueño de oportunidad-- y la única diferencia
 * entre las estrategias es el cargo de quien decide.
 *
 * Se conserva por dos razones, no por inercia:
 *
 *   1. Quedan DOS filas guardadas con `branch_code` --B2B en el 747 y el 716--
 *      que no se pueden reasignar: cada una cubre a dos o tres Business
 *      Developers y repartirlas es una decisión de negocio. Se muestran en su
 *      propia fila, `Branch level, no owner`, y `branchHasBudget` las encuentra.
 *   2. El día que aparezca una estrategia que genuinamente no tenga persona
 *      detrás, el camino existe y está probado.
 *
 * La distinción entre por quién se ABRE y de quién es el PRESUPUESTO sigue
 * haciendo falta: son dos preguntas, y `opensBy` sólo responde la primera.
 */
/**
 * ============================================================================
 * LOS TEXTOS DE UNA FILA PROYECTADA — etapa OL20
 * ============================================================================
 *
 * ⚠ CADA CERO TIENE QUE DECIR POR QUÉ. Son cuatro razones distintas y desde la
 * celda no se distinguen: la etapa del proceso, que ya se vinculó al roster,
 * que nadie fijó su benchmark, o que su fecha venció sin vincular. Un cero sin
 * razón en una fila proyectada es indistinguible de un bug.
 *
 * La píldora dice cuál en dos palabras; el título dice la frase entera. Mismo
 * reparto que las reglas de crecimiento.
 */
const NOT_PROJECTING_PILL: Record<NotProjectingReason, string> = {
  stage: 'not budgeted',
  linked: 'in roster',
  no_benchmark: 'no benchmark',
  expired: 'past due',
};

const RECRUIT_TITLE: Record<RecruitStage, (r: BranchRecruit) => string> = {
  in_hiring: (r) =>
    `In the hiring pipeline${r.startDate ? `, starting ${r.startDate}` : ''}. Counts from ${r.producingFrom}` +
    `${r.monthlyBenchmark === null ? ', once someone sets how much is expected of them.' : '.'}`,
  in_offering: (r) =>
    `An offer is out${r.closeDate ? `, recruitment closed ${r.closeDate}` : ''}. Counts from ${r.producingFrom}` +
    `${r.monthlyBenchmark === null ? ', once someone sets how much is expected of them.' : '.'}`,
  /*
   * ⚠ EL `close_date` A LA VISTA, y es el dato que explica la fila. Un
   * reclutamiento cerrado hace más de 30 días que sigue sin fecha de inicio no
   * es pipeline, es un caso sin resolver: proyectarlo sería inventar producción
   * de alguien que quizás nunca entró. La regla es por fecha y no por lista, así
   * que entra y sale solo.
   */
  stale: (r) =>
    `Recruitment closed ${r.closeDate ?? '(no date)'} and there is still no start date, so this is an unresolved case ` +
    'rather than a pipeline one. Not budgeted until someone sets a start date.',
  tentative: (r) =>
    `Nobody closed this recruitment${r.closeDate ? ` — last close date ${r.closeDate}` : ''}. Shown because the ` +
    'candidate exists, not budgeted because the hire does not.',
};

/**
 * Qué dice un mes futuro. Con proyección explica la rampa; sin ella, cuál de las
 * cuatro razones lo dejó en cero.
 */
function RECRUIT_MONTH_TITLE(r: BranchRecruit, month: string): string {
  if (r.notProjecting) return RECRUIT_TITLE[r.stage](r);
  if (month < r.producingFrom) return `Not counted yet: this one starts counting in ${r.producingFrom}.`;
  const n = monthsApart(r.producingFrom, month);
  const pct = n === 0 ? '25%' : n === 1 ? '50%' : '100%';
  return (
    `Month ${n + 1} since ${r.producingFrom}, so ${pct} of the ${r.monthlyBenchmark} expected a month — ` +
    'a new hire ramps up rather than producing their full benchmark from day one.'
  );
}

/* `rampaTexto` se fue a la vista 1 con la barra que lo usaba -- etapa OL21. */

/** Cuántos meses hay entre dos 'YYYY-MM'. */
function monthsApart(desde: string, hasta: string): number {
  const [ya, ma] = desde.split('-').map(Number);
  const [yb, mb] = hasta.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/*
 * ⚠ `esDelBranch` Y `branchHasBudget` SE FUERON A `lib/outlook/strategyRows.ts`
 * — etapa OL22. Se importan de ahí. Ver la nota de la migración más abajo.
 */

/**
 * ⚠ LA PÍLDORA: la regla en cuatro caracteres, no en una frase — etapa OL11.
 *
 * La columna decía `25% quarterly from Sep · 1st raise in Dec` en cada fila, y
 * con diez filas era una pared de texto que había que leer entera para ver que
 * todas decían lo mismo. Lo que se compara de un vistazo es CUÁNTO y CADA CUÁNTO;
 * el resto --desde qué mes, cuándo cae el primer aumento, los meses proyectados--
 * vive en el tooltip, que es donde se busca cuando hace falta.
 */
function pillOf(plan: {
  mode: ProjectionMode;
  rules: GrowthSegment[];
  hasBenchmark: boolean;
  targetRevision: number;
}): string {
  if (plan.mode === 'monthly') return plan.targetRevision === 0 ? 'set months' : 'by month';
  if (plan.rules.length === 0) return plan.hasBenchmark ? 'no rule' : 'set budget';
  const seg = plan.rules[0];
  const cada = seg.cadence === 'monthly' ? 'mo' : seg.cadence === 'quarterly' ? 'qtr' : 'sem';
  const extra = plan.rules.length > 1 ? ` +${plan.rules.length - 1}` : '';
  return `${seg.growthPct}% / ${cada}${extra}`;
}

/** La píldora de una PERSONA en una estrategia. Mismo formato, otro sujeto. */
function pillOfLo(lo: OutlookLoanOfficer, s: OutlookStrategy): string {
  return pillOf({
    mode: lo.modeByStrategy[s] ?? 'growth',
    rules: lo.rulesByStrategy[s] ?? [],
    hasBenchmark: (lo.benchmarkSchedules[s] ?? []).length > 0 || (lo.strategyBenchmarks[s] ?? 0) > 0,
    targetRevision: lo.targetRevision[s] ?? 0,
  });
}

/**
 * Cómo se está fijando una estrategia DEL BRANCH, en una línea — etapa OL11.
 *
 * Mismo criterio que `ruleLabel` para una persona: el MODO primero, porque es lo
 * que decide si el resto significa algo.
 */
function branchRuleLabel(bs: BranchStrategy): string {
  if (bs.mode === 'monthly') {
    return bs.targetRevision === 0 ? 'month by month · no numbers set' : 'month by month · numbers set by hand';
  }
  if (bs.rules.length === 0) return bs.benchmarkSchedule.length === 0 ? 'no budget set' : 'no rule';
  const seg = bs.rules[0];
  const extra = bs.rules.length > 1 ? ` (+${bs.rules.length - 1} segment${bs.rules.length > 2 ? 's' : ''})` : '';
  return `${seg.growthPct}% ${cadenceLabel(seg.cadence)} from ${monthLabel(seg.fromMonth)}${extra}`;
}

/**
 * Qué dice el estado del roster, y por qué son cuatro rótulos y no dos.
 *
 * ⚠ EL RÓTULO DICE EL ESTADO REAL, no "ya no produce". `left` es alguien que
 * dejó la empresa; `not producing` alguien que sigue empleada y dejó de
 * originar. Hoy los dos casos existen por separado en el roster --Isabel Wagner
 * y Ludwig Aguillon son bajas-- y el día que aparezca el segundo el rótulo tiene
 * que poder distinguirlo. Un solo rótulo para los dos obligaría a preguntarle a
 * RRHH cuál es cuál.
 */
const STATE_TAG: Record<string, { text: string; title: string }> = {
  left: {
    text: 'left',
    title:
      'No longer with the company, per the roster. Their closings are real and already happened, which is why the ' +
      'row is here and why the branch total adds up. What changed is that they will not produce from now on, so ' +
      'there is no forecast and no budget.',
  },
  not_producing: {
    text: 'not producing',
    title:
      'Still with the company and no longer originating, per the roster. Not the same as having left: this row is ' +
      'here because of closings that already happened.',
  },
  unknown: {
    text: 'not in roster',
    title:
      'Closed in this branch and does not appear in the roster, so there is no way to say whether they still ' +
      'produce. The row is here because the closings are real.',
  },
};

/**
 * ============================================================================
 * EL BENCHMARK, JUNTO AL NOMBRE — etapa OL18
 * ============================================================================
 *
 * Era una columna propia, y eso es lo que hacía que la tabla se leyera como una
 * planilla: un número que compite por ancho horizontal con los doce meses,
 * teniendo un peso completamente distinto. El benchmark no es un mes; es la BASE
 * de la que salen los meses proyectados.
 *
 * Ahora va al lado del nombre de su fila, en tono tenue, como dato secundario. El
 * lápiz se mantiene: sólo cambia dónde vive.
 *
 * ⚠ CALCULADO vs EDITABLE, sin explicarlo. Un benchmark calculado --el de una
 * fila de estrategia, que es la SUMA de sus hijas-- no se puede editar: no hay
 * un número guardado detrás, hay una suma. Se distingue por no tener lápiz y por
 * llevar el signo `Σ`, que dice "esto es una suma" sin una palabra. Editar la
 * suma no tendría dónde escribirse; hay que editar las partes.
 */
function BenchTag({
  value,
  text,
  onEdit,
  editLabel,
  editTitle,
}: {
  value: number | null;
  /**
   * El número ya formateado, cuando `fmt` no alcanza.
   *
   * ⚠ Lo usa el realtor: su benchmark es el promedio de 3 meses y casi siempre
   * fraccionario --0,33 · 0,67 · 1,33--. Con un decimal se pierde de dónde sale
   * el número, que son tercios. El resto de la tabla sigue con `fmt`.
   */
  text?: string;
  /** Ausente = calculado, no editable. */
  onEdit?: () => void;
  editLabel?: string;
  editTitle?: string;
}) {
  if (value === null && !onEdit) return null;
  /*
   * ⚠ El separador va SOLO si hay número. Sin esto, una fila sin benchmark
   * mostraba `Josue Toro · ✎` -- un punto suelto que se lee como un glitch, no
   * como "acá no hay número todavía". El lápiz solo ya dice que se puede fijar.
   */
  const numero = text ?? fmt(value);
  return (
    <span className={'ol-bench-in' + (onEdit ? '' : ' ol-bench-in--calc')} onClick={(e) => e.stopPropagation()}>
      {numero !== '' && (
        <span className="ol-bench-in__sep" aria-hidden="true">
          ·
        </span>
      )}
      {!onEdit && (
        <span className="ol-bench-in__sum" title="Calculated: the sum of the rows below. Edit the parts, not the sum.">
          Σ
        </span>
      )}
      <span className="ol-bench-in__n">{numero}</span>
      {onEdit && (
        <button type="button" className="ol-edit" onClick={onEdit} aria-label={editLabel} title={editTitle}>
          ✎
        </button>
      )}
    </span>
  );
}

export default function OutlookBranchPage({ params }: { params: Promise<{ code: string }> }) {
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ EL SEGMENTO DE LA URL VIENE CODIFICADO — arreglado en OL22
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Next entrega el segmento CRUDO, así que un branch con un espacio en el
   * código llegaba como `Branch%20Out%20of%20Division` y no calzaba con ningún
   * `branchCode`. La pantalla mostraba "Branch Branch%20Out%20of%20Division has
   * no production or roster this year" -- un branch que sí tiene producción,
   * diciendo que no la tiene, y filtrando el encoding en el texto.
   *
   * ⚠ EL DEFECTO EXISTÍA DESDE SIEMPRE Y ERA INALCANZABLE: hasta OL21 ningún
   * código tenía espacios --`AFFINITY`, `Recruitment` y números-- así que nunca
   * se manifestó. Lo destapó darle fila propia a `Branch Out of Division`, que
   * es donde caen los cierres de branches que no están en el roster oficial.
   *
   * Es el mismo patrón que la etiqueta del mes: el bug no estaba en lo que se
   * cambió, estaba esperando que algo lo alcanzara.
   *
   * `decodeURIComponent` puede tirar sobre una secuencia mal formada --un `%`
   * suelto en una URL escrita a mano-- y ahí lo correcto es quedarse con el
   * crudo: va a no encontrar el branch y mostrar el vacío, que es la verdad.
   */
  const { code: codeRaw } = use(params);
  const code = (() => {
    try {
      return decodeURIComponent(codeRaw);
    } catch {
      return codeRaw;
    }
  })();
  /*
   * Del contexto del layout, igual que la vista 1 -- una sola carga.
   *
   * `reload` sale del mismo contexto: tira el caché de módulo y vuelve a
   * cargar, así que después de guardar las DOS vistas ven el dato nuevo. Antes
   * cada pantalla tenía su propio `loadOutlookData`, y guardar en la vista 2
   * dejaba la vista 1 con la proyección vieja hasta recargar la pestaña.
   *
   * Un error de la recarga llega por `error` del contexto: no hace falta un
   * segundo estado de error acá.
   */
  const { data, error, reload } = useOutlookDataContext();
  /*
   * Qué está abierto, con claves de TEXTO: el bloque 2 tiene dos niveles
   * plegables --la estrategia y, dentro de NPPM, la persona con sus realtors--
   * así que una clave numérica de persona ya no alcanza.
   */
  const [open, setOpen] = useState<Set<string>>(new Set());
  /* Qué se está editando: (persona, estrategia) o (realtor). Nunca los dos. */
  /*
   * ⚠ Se guarda QUIÉN y QUÉ, no el objeto. Después de guardar, `reload` reemplaza
   * `data` entera; un objeto guardado en el estado apuntaría a la versión vieja y
   * el editor seguiría mostrando el benchmark anterior al que se acaba de
   * escribir. Se vuelve a buscar en cada render -- ver el bloque de los editores.
   */
  /*
   * Cuántos meses hacia adelante. Arranca en "hasta diciembre", que es lo que
   * había, así que quien no lo toca ve exactamente lo de antes.
   */
  const [horizonte, setHorizonte] = useState<number | null>(null);
  const [editing, setEditing] = useState<
    { kind: 'employee'; employeeKey: number; strategy: OutlookStrategy } | { kind: 'branch'; strategy: OutlookStrategy } | null
  >(null);
  const [editingNppm, setEditingNppm] = useState<{ realtor: string; ytd: number } | null>(null);
  /*
   * Lo que se esta editando de reclutamiento -- etapa OL20.
   *
   * ⚠ SE GUARDA LA `identity`, NO LA FILA. Es la misma regla que el bloque de
   * los editores mas abajo: `reload` reemplaza `data` entera despues de
   * guardar, asi que un `BranchRecruit` guardado en el estado apuntaria a la
   * version vieja y el panel seguiria mostrando el benchmark anterior al que se
   * acaba de escribir. La fila se resuelve en cada render desde `data` fresca.
   *
   * ⚠ SÓLO UNA `identity` desde OL21. Antes admitía `'new'` y `'ramp'` para el
   * alta y la rampa, que se fueron a la vista 1: son decisiones del módulo y no
   * de este branch. Dejar los dos valores acá habría dejado dos ramas de render
   * que nada puede alcanzar.
   */
  const [editingRecruit, setEditingRecruit] = useState<string | null>(null);

  if (error) return <div className="hub-container"><div className="bp-empty">Could not load Outlook: {error}</div></div>;
  if (!data) return <div className="hub-container"><div className="bp-empty">Loading…</div></div>;

  const branch = data.branches.find((b) => b.branchCode === code);
  if (!branch) {
    return (
      <div className="hub-container">
        <div className="bp-empty">
          Branch {code} has no production or roster this year. <Link href="/outlook">Back to Outlook</Link>
        </div>
      </div>
    );
  }

  const { actualMonths, currentMonth } = data;
  const year = currentMonth.split('-')[0];

  /*
   * La gente en contratacion de este branch, en una lista -- etapa OL20.
   *
   * Viene de `byStrategy`, que la trae sólo en Recruitment. Se aplana acá y no
   * se recorre dos veces: la barra necesita saber si hay alguien y el aviso
   * necesita a los vencidos.
   */
  const reclutas = branch.byStrategy.flatMap((bs) => bs.recruits);
  const vencidasSinVincular = reclutas.filter(
    (r) => r.notProjecting === 'expired' && r.linkedEmployeeKey === null
  );

  /*
   * ==========================================================================
   * HASTA DÓNDE SE PROYECTA — etapa OL12
   * ==========================================================================
   *
   * Era fijo hasta diciembre del año en curso. No hacía falta cambiar el motor:
   * `projectPlan` ya evalúa cualquier mes futuro --una regla es `from_month` +
   * cadencia + porcentaje, y eso no sabe de años-- y `composeYear` arma la fila
   * con la lista de meses que le pasen. Lo único que faltaba era que la tabla
   * dibujara esas columnas.
   *
   * ⚠ El horizonte es del USUARIO y no del dato: vive en el estado de la
   * pantalla, no en `OutlookData`. Meterlo en el loader habría obligado a
   * recargar todo --y a esperar los siete segundos de las lecturas-- cada vez que
   * alguien mira un año más.
   */
  const horizonteHastaDic = data.remainingMonths.length;
  /*
   * Los diciembres de los años siguientes, DERIVADOS del mes en curso: en enero
   * `horizonteHastaDic` da 11 y estas opciones se corren solas. Nada de años
   * escritos a mano, que es lo que obliga a volver cada 1 de enero.
   */
  const finesDeAnio = [1, 2].map((suma) => {
    const anio = Number(year) + suma;
    /* Meses desde el mes en curso hasta diciembre de ese año. */
    const meses = (anio - Number(year)) * 12 + (12 - Number(currentMonth.slice(5, 7)));
    return { anio, meses };
  });
  const meses = horizonte ?? horizonteHastaDic;
  /*
   * ⚠ Sin `useMemo`, y no por descuido: esto vive DESPUÉS de los early returns
   * --`if (!data)`, `if (!branch)`-- así que un hook acá se saltearía en los
   * renders que salen antes y React rompe la pantalla entera. Medido: la tabla
   * no llegaba a dibujarse.
   *
   * Y no hace falta: son 24 sumas de meses por render, contra las lecturas de
   * varios segundos que ya hace el módulo.
   */
  const remainingMonths: string[] = [];
  for (let i = 1; i <= meses; i++) remainingMonths.push(addMonths(currentMonth, i));
  const monthsOfYear = [...actualMonths, currentMonth, ...remainingMonths];
  /* El rótulo de la columna del total: deja de ser un año cuando pasa de uno. */
  const totalLabel = (() => {
    const ultimo = monthsOfYear[monthsOfYear.length - 1] ?? currentMonth;
    const anioFin = ultimo.split('-')[0];
    return anioFin === year ? year : `${year}–${anioFin}`;
  })();
  /*
   * ⚠ ACÁ HABÍA UN `projectsNothing` LOCAL Y SE FUE — etapa OL22.
   *
   * Era `!branch.loanOfficers.some(l => l.primaryBranch === branchCode)`, y no
   * es la misma pregunta que `branch.isInactive`: `loanOfficers` incluye a los
   * `outsiders` de OL16 --gente cuyo branch de roster es otro y que cerró acá--
   * así que las dos pantallas podían contestar distinto sobre el mismo branch.
   * Medido: el 741 tiene 2 cierres de Nathan Martinez, que no es del 741.
   *
   * Ahora las dos leen `isInactive`, que le pregunta al roster.
   */
  /*
   * ⚠ El mes en curso: el pronóstico, o lo cerrado del mes cuando no hay ninguno.
   *
   * Misma regla que la vista 1, y por el mismo motivo: el pronóstico se atribuye
   * por roster y lo cerrado por préstamo, así que un branch sin nadie
   * rosterizado tiene pronóstico 0 -- y sus cierres reales del mes se perderían.
   * Medido en AFFINITY: 5 cerrados en agosto que la primera versión no mostraba.
   */
  /*
   * ⚠ EL MISMO ENTERO QUE LA LISTA, y por la misma función. Calcularlo acá con
   * `Math.round(branch.currentMonth)` habría dado otro número --el reparto
   * depende de TODOS los branches, no de este-- y las dos pantallas volverían a
   * discrepar en el mes en curso, que es justo lo que la fila de reconciliación
   * vino a cerrar.
   */
  const branchCurrent = currentMonthByBranch(data).get(branch.branchCode) ?? 0;
  const branchYear = composeYear(
    monthsOfYear,
    currentMonth,
    branch.actualByMonth,
    branchCurrent,
    projectBranch(branch, remainingMonths)
  );


  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /*
   * ⚠ SIEMPRE TRUE DESDE OL8, y se deja escrito en vez de borrado.
   *
   * El roster da UN branch por persona, y una fila sólo aparece en ese branch,
   * así que `primaryBranch` y el branch de la fila son el mismo. Hasta OL7 esto
   * podía ser falso --una persona aparecía en cada branch donde había cerrado y
   * su presupuesto se cargaba a uno solo-- y de ahí venía la etiqueta "budget in
   * X", que ya no puede ocurrir.
   *
   * Queda como una sola expresión para que el día que la regla vuelva a admitir
   * varias filas por persona haya UN lugar donde mirarlo, en vez de un supuesto
   * repartido por la pantalla.
   */
  const isHere = (lo: OutlookLoanOfficer) => lo.primaryBranch === branch.branchCode;

  /**
   * ⚠ LA CELDA DE UNA PERSONA EN UNA ESTRATEGIA, EN UN SOLO LUGAR.
   *
   * Los dos bloques la usan y las dos jerarquías la suman, así que no hay una
   * segunda cuenta que pueda divergir. Antes vivía dentro del `map` de la única
   * tabla, y al partir la pantalla en dos habría quedado duplicada -- que es el
   * modo de falla que este módulo evita en todos lados: dos fórmulas para el
   * mismo número, y la de arriba que no da la suma de la de abajo.
   *
   * El mes en curso va en `null` --y sale como `no data`-- porque Forecast
   * proyecta el mes desde el pipeline, que no lleva la estrategia consigo.
   */
  function cellOf(lo: OutlookLoanOfficer, s: OutlookStrategy, presupuesto?: Record<string, number>) {
    const here = isHere(lo);
    const st = lo.strategies.find((x) => x.strategy === s);
    const steps = projectLoanOfficer(lo, remainingMonths).stepsByStrategy[s] ?? [];
    /* Si viene el reparto en enteros, manda ése -- ver la cascada. */
    const proj: Record<string, number | null> = {};
    remainingMonths.forEach((m, i) => (proj[m] = presupuesto ? (presupuesto[m] ?? 0) : here ? (steps[i]?.value ?? 0) : 0));
    return {
      here,
      steps,
      /* El mes en curso: lo real cerrado. Ver la nota de `sYear`, misma razón. */
      year: composeYear(
        monthsOfYear,
        currentMonth,
        st?.actualByMonth ?? {},
        st?.actualByMonth[currentMonth] ?? 0,
        proj
      ),
      realtors: st?.byRealtor ?? [],
    };
  }


  /*
   * ==========================================================================
   * LAS CINCO FILAS, CALCULADAS UNA VEZ — etapa OL9
   * ==========================================================================
   *
   * ⚠ Salieron del JSX porque ahora las lee DOS veces: las filas y el total del
   * branch, que es su suma. Calcularlas dentro del `map` y sumar aparte habria
   * dejado dos definiciones del mismo numero, y la de abajo podria no dar la
   * suma de las de arriba -- que es exactamente lo que este total viene a
   * garantizar.
   */
  /*
   * ==========================================================================
   * EL PRONÓSTICO DEL MES, REPARTIDO ENTRE LAS CINCO — etapa OL12
   * ==========================================================================
   *
   * Antes el mes en curso de cada estrategia era lo REAL cerrado, y la
   * diferencia contra el pronóstico del branch se iba a la fila de
   * reconciliación. Ahora se reparte: cada estrategia tiene su agosto.
   *
   * ⚠ El reparto es sobre el ENTERO del branch --el mismo que muestra la lista--
   * así que las cinco suman exactamente eso, y el residuo de agosto pasa a ser
   * cero por construcción. No se esconde: deja de existir.
   *
   * ⚠ Y LOS PESOS TIENEN DOS FUENTES, por la misma razón de siempre. Un branch
   * donde nadie está rosterizado no tiene pronóstico --AFFINITY, 741, 771-- y
   * sus pesos serían todos cero; `apportionByWeight` volcaría el total entero en
   * la primera estrategia, que es Own Production, inventando que los 5 cierres
   * de agosto de AFFINITY fueron producción propia. En ese caso los pesos son
   * los cierres REALES del mes por estrategia, que es lo que efectivamente pasó.
   */
  /*
   * ==========================================================================
   * LOS HELPERS DE ESTRATEGIA VIVEN EN `lib/outlook/strategyRows.ts` — OL22
   * ==========================================================================
   *
   * Estaban acá y se copiaron a ese modulo en OL21 para que la vista 1 pudiera
   * filtrar por estrategia. Quedaron DOS implementaciones del mismo calculo, lo
   * que este mismo archivo ya vio pasar con `fmt`, con 'Sin tipo' y con el tono
   * del icono: empiezan iguales y se separan en el primer arreglo que se haga en
   * una sola, sin que nada avise porque cada una suma bien por su cuenta.
   *
   * ⚠ QUE SE BORRO DE ACA, y donde esta ahora:
   *
   *   tienePresupuestoPropio  la trampa de OL8: un benchmark o un mes fijado,
   *                           NUNCA una regla. Las 185 reglas de la siembra
   *                           hacen que "tiene regla" sea verdad para todos.
   *   participa               quien abre Recruitment -- OL19. Own Production es
   *                           pertenencia por defecto; Recruitment es un
   *                           programa en el que se participa.
   *   personasDe             el conjunto UNICO que leen el presupuesto exacto,
   *                           el benchmark sumado, el "N of M" y las filas hijas.
   *   tieneAlgo              que estrategias muestra el branch -- OL12.
   *   exactoDe               el presupuesto exacto, que es el peso del reparto.
   *   esDelBranch, branchHasBudget
   *
   * ⚠ COMO SE VERIFICO LA MIGRACION, porque un refactor de esta pantalla no se
   * declara equivalente, se mide: se volco la vista 2 ENTERA a JSON --los 19
   * branches, todas las estrategias abiertas, 183 filas-- antes y despues, y se
   * comparo con `diff`. La comparacion vive afuera del script que la genera, a
   * proposito: si viviera adentro, un bug del script podria dar verde sobre dos
   * salidas distintas.
   *
   * `personasDe` se queda como un cierre de una linea sobre `branch` porque lo
   * llaman cuatro lugares de esta pantalla y cambiar la firma en todos no agrega
   * nada -- la implementacion ya es una sola.
   */
  const personasDe = (bs: BranchStrategy) => personasDeBranch(branch, bs);

  /*
   * ==========================================================================
   * LAS FILAS DE ESTRATEGIA, CON SUS DOS REPARTOS — una sola implementacion
   * ==========================================================================
   *
   * ⚠ ACA HABIA 121 LINEAS y son las que la vista 1 necesitaba para su filtro.
   * Las dos cascadas de redondeo --el mes en curso repartido entre estrategias, y
   * el presupuesto entero de cada mes futuro-- viven en `strategyRowsOf`.
   *
   * ⚠ LO QUE LAS CASCADAS GARANTIZAN, y por lo que no se pueden hacer celda por
   * celda: medio prestamo no existe, asi que ninguna celda muestra decimales;
   * pero redondear cada una por separado rompe las dos sumas que la tabla
   * promete --la de la columna, donde las estrategias dan el total del branch, y
   * la de la fila--. `apportionByWeight` garantiza que las partes sumen el total
   * y nada mas, asi que la lista que entra tiene que ser LA MISMA que se dibuja.
   * De ahi que `filasBase` salga de la misma funcion y no de un filtro aparte.
   */
  const sRows = strategyRowsOf(data, branch, monthsOfYear, remainingMonths);
  /*
   * `filasBase` y `agostoDe` desaparecieron con la migración: sus dos
   * consumidores --el `map` de las filas y `sYear`-- ahora salen de `sRows`
   * directamente. `presupuestoDe` se queda porque el reparto entre dueños lo
   * necesita por estrategia.
   */
  const presupuestoDe = new Map(sRows.map((r) => [r.strategy, r.budget]));

  const strategyRows = sRows.map(({ bs, year: sYearCompartido }) => {
      const s = bs.strategy;
      /*
        ⚠ EL PRESUPUESTO SOLO SE PROYECTA DONDE HAY DE DONDE.
        Own Production proyecta: su benchmark vive en `org.employee_benchmark`,
        por persona, y el motor ya lo resuelve. Las otras no: sus tablas de
        decisión cuelgan de `employee_key` y una estrategia del branch no tiene
        dónde guardar su presupuesto todavía. Van en `null` --celda vacía-- y no
        en 0, que afirmaría que se decidió que no cierre nada.
      */
      /*
       * ⚠ ACÁ SE ARMABA `proj` Y SE FUE — etapa OL22. Era la copia local del
       * presupuesto repartido, y su unico consumidor era `sYear`, que ahora viene
       * de `strategyRowsOf`. `presupuestoDe` sigue usándose abajo, para el
       * reparto entre los DUEÑOS.
       */
      let steps: ReturnType<typeof projectPlan> = [];
      /*
       * Lo que le toca al presupuesto de branch sin dueño. Lo llena el bloque de
       * las filas de dueño, que es donde se hace el reparto, y lo lee su propia
       * fila más abajo.
       */
      /*
       * El reparto entre los DUEÑOS y el presupuesto de branch sin dueño, que
       * compite como un peso más. Se calcula acá --no en el render-- porque las
       * dos filas lo necesitan y calcularlo dos veces serían dos repartos que
       * pueden diferir.
       *
       * ⚠ Sin incluirlo como peso, los pesos de los dueños son todos cero
       * --ninguno tiene benchmark todavía-- y `apportionByWeight` vuelca el entero
       * completo en el PRIMERO: Annie Garrido aparecía con 2, 2, 3 sin tener
       * ninguno, y ese número era en realidad el de branch.
       */
      const huerfanoPorMes: Record<string, number> = {};
      const porDueno: Record<string, number>[] = bs.owners.map(() => ({}));
      /*
       * `steps` sólo alimenta el tooltip de la celda --el porqué de cada mes-- y
       * NO el número que se muestra: ése sale del reparto en enteros. Se calcula
       * únicamente para el presupuesto del branch, que es el que tiene una regla
       * que explicar.
       */
      if (branchHasBudget(bs)) {
        steps = projectPlan(remainingMonths, {
          mode: bs.mode,
          benchmarks: bs.benchmarkSchedule,
          segments: bs.rules,
          targets: bs.targets,
        });
      }
      if (bs.opensBy === 'owner') {
        const exactosDueno = bs.owners.map((o) => {
          const out: Record<string, number> = {};
          if (o.isPerson) {
            const st = projectPlan(remainingMonths, {
              mode: o.mode,
              benchmarks: o.benchmarkSchedule,
              segments: o.rules,
              targets: o.targets,
            });
            remainingMonths.forEach((m, i) => (out[m] = st[i]?.value ?? 0));
          }
          return out;
        });
        for (const m of remainingMonths) {
          const pesos = [...exactosDueno.map((e) => e[m] ?? 0), branchHasBudget(bs) ? (steps[remainingMonths.indexOf(m)]?.value ?? 0) : 0];
          const partes = apportionByWeight(presupuestoDe.get(s)?.[m] ?? 0, pesos);
          bs.owners.forEach((_, i) => (porDueno[i][m] = partes[i]));
          huerfanoPorMes[m] = partes[partes.length - 1];
        }
      }

      /* Proyecta si el reparto le dio algo, o si tiene con qué proyectar. */
      const proyecta =
        bs.opensBy === 'loanOfficer' ||
        (esDelBranch(bs) && branchHasBudget(bs)) ||
        bs.opensBy === 'owner' ||
        (bs.opensBy === 'realtor' && bs.realtors.length > 0);
      /*
        El mes en curso sale del REPARTO -- ver `agostoDe` arriba. Hasta OL12 era
        lo real cerrado, porque el pronóstico del mes no se abría por estrategia.
      */
      /*
       * ⚠ VIENE DE `strategyRowsOf`, no se recompone aca — etapa OL22.
       *
       * Era `composeYear(monthsOfYear, currentMonth, bs.actualByMonth,
       * agostoDe.get(s), proj)`, que es exactamente lo que esa funcion ya hace
       * con los mismos tres argumentos. La diferencia esta en el cuarto: aca
       * `proj` salia de `presupuestoDe` SIEMPRE, asi que una estrategia sin de
       * donde proyectar mostraba 0 -- y el comentario de arriba dice que tiene
       * que mostrar vacio. La compartida lo pone en `null`.
       *
       * ⚠ HOY NO CAMBIA NINGUN NUMERO, medido: cero de las 33 estrategias
       * visibles en los 19 branches tiene el presupuesto vacio, o sea que todas
       * proyectan y las dos formas coinciden. El volcado completo antes/despues
       * salio identico. Lo que se gana es que el dia que aparezca una que no
       * proyecte, muestre vacio en las dos pantallas en vez de un 0 en una.
       */
      const sYear = sYearCompartido;
      const bench =
        bs.opensBy === 'loanOfficer'
          ? personasDe(bs).reduce((a, lo) => a + (lo.strategyBenchmarks[s] ?? 0), 0)
          : bs.opensBy === 'owner'
            ? /* La suma de los dueños, más el de branch que quedó sin dueño. */
              bs.owners.reduce((a, o) => a + (o.isPerson && o.mode !== 'monthly' ? o.benchmarkAtDisplay : 0), 0) +
              (branchHasBudget(bs) && bs.mode !== 'monthly' ? bs.benchmarkAtDisplay : 0)
            : s === 'NPPM'
            ? bs.realtors.reduce((a, r) => a + r.benchmark, 0)
            : /*
               * Del branch. Vacío en dos casos, y los dos significan lo mismo --
               * que no hay un número que gobierne esta fila: en modo mes a mes el
               * benchmark no interviene, y sin benchmark guardado no hay nada que
               * mostrar. Un 0 diría que alguien decidió cero.
               */
              bs.mode === 'monthly' || bs.benchmarkSchedule.length === 0
              ? null
              : bs.benchmarkAtDisplay;
      return { bs, s, proyecta, sYear, bench, steps, porDueno, huerfanoPorMes };
    });

  /*
   * ⚠ EL TOTAL DEL BRANCH ES LA SUMA DE LAS CINCO. Nada más.
   *
   * No sale de `projectBranch` ni de sumar personas: se suma lo que la tabla
   * muestra, columna por columna. Así el total no puede discrepar de sus filas
   * por construcción, que es lo que una tabla de presupuesto necesita.
   *
   * ⚠ CONSECUENCIA QUE HAY QUE SABER: el mes en curso de esta suma es lo REAL
   * cerrado, mientras la lista de branches muestra el PRONÓSTICO de ese mes. Los
   * dos números son correctos y distintos, y la diferencia es la parte del
   * pronóstico que todavía no cerró. El subtítulo la dice para que nadie tenga
   * que descubrirla comparando dos pantallas.
   */
  const strategiesByMonth: Record<string, number | null> = {};
  for (const m of monthsOfYear) {
    const aportan = strategyRows.filter((r) => r.sYear.byMonth[m] !== null);
    strategiesByMonth[m] = aportan.length === 0 ? null : aportan.reduce((a, r) => a + (r.sYear.byMonth[m] ?? 0), 0);
  }

  /*
   * ==========================================================================
   * LA FILA DE RECONCILIACIÓN — lo que ninguna estrategia reclama
   * ==========================================================================
   *
   * `residual[m] = lo que muestra la lista de branches − lo que suman las cinco`
   *
   * ⚠ ES UN RESIDUO PURO, y por eso el total sigue siendo la suma de las filas:
   * sumar las cinco más el residuo da, por construcción, el número de la lista.
   * Definirlo como "el pipeline que falta cerrar" habría sido una segunda
   * fórmula que puede desviarse; así no puede.
   *
   * ⚠ Y VA POR MES, NO SÓLO EN EL MES EN CURSO. Empezó como una fila con una
   * sola celda --agosto, el pronóstico que no se puede abrir por estrategia--
   * hasta que la medición mostró una SEGUNDA causa, en otro mes: el 733 tiene
   * mayo 7 en esta tabla y 6 en la lista. Es el cierre NPPM de Daniel Rodriguez,
   * que cuenta para el realtor y no para el branch porque su originador está
   * excluido de la división (ver el `+1` en la fila de NPPM). Con el residuo
   * limitado a agosto el total NO habría cuadrado en el 733: 75 + 2,2 = 77,2
   * contra 76,2. Por mes cuadra siempre.
   *
   * Las dos causas de hoy, entonces:
   *   mes en curso   el pronóstico del mes, que el pipeline no abre por
   *                  estrategia. Desaparece el día que lo haga.
   *   otros meses    cierres contados a un realtor y no al branch.
   *
   * ==========================================================================
   * ⚠⚠ ESTA FILA PUEDE ESCONDER UN ERROR, Y HAY QUE SABERLO
   * ==========================================================================
   *
   * Al ser un residuo puro, la suma CIERRA SIEMPRE -- también cuando lo que
   * falta no es "el pronóstico que ninguna estrategia reclama" sino un bug. La
   * fila que vino a garantizar el invariante es la que puede tapar que el
   * invariante se rompió.
   *
   * ⚠⚠ YA PASÓ DOS VECES, EN DOS ETAPAS SEGUIDAS. No es una advertencia
   * teórica: es un patrón, y las dos veces fue la MISMA causa.
   *
   *   OL11  se guardó el primer benchmark de branch. B2B pasó a mostrar 3 por
   *         mes, el total del branch NO se movió --`projectBranch` sólo sumaba
   *         las proyecciones de las personas-- y esta fila absorbió -3 por mes.
   *
   *   OL12  se hizo proyectar a NPPM desde sus realtors. Mismo síntoma, misma
   *         causa: `projectBranch` tampoco lo sumaba.
   *
   * ⚠ LA REGLA, ENTONCES: cada vez que se agrega una FUENTE DE PRESUPUESTO
   * --una estrategia nueva, un sujeto nuevo, otra tabla-- hay que verificar a
   * mano que `projectBranch` la sume. El residuo NO lo va a avisar: está
   * definido para cerrar siempre, así que una fuente olvidada se ve como un
   * residuo que creció y no como un error.
   *
   * Y si el residuo empieza a dar valores GRANDES, o cambia sin que haya
   * cambiado el mes en curso, es eso: algo dejó de sumarse. Las dos vías tienen
   * que dar bien POR SEPARADO; que cierren no alcanza, porque una se ajusta a la
   * otra por construcción.
   *
   * Hoy sus únicas dos causas legítimas son chicas y conocidas: el pronóstico del
   * mes en curso, que el pipeline no abre por estrategia, y algún cierre contado
   * a un realtor y no al branch.
   *
   * ⚠ PUEDE SER NEGATIVO Y NO SE CLAMPEA. Medido: el 710 da −0,6 -- cerró 2 en
   * agosto y su pronóstico era 1,4, porque sus 2 préstamos abiertos del mes no
   * son healthy. Un `max(0, ...)` rompería justo el invariante que esta fila
   * viene a garantizar, y taparía una noticia: ese branch ya pasó lo que se
   * esperaba del mes. Por eso el rótulo lo dice al derecho --"already above
   * forecast"-- y no describe el signo.
   */
  const residual: Record<string, number> = {};
  for (const m of monthsOfYear) {
    residual[m] = (branchYear.byMonth[m] ?? 0) - (strategiesByMonth[m] ?? 0);
  }
  /* Su total del año también se suma al mostrarlo -- ver `sumOfShown`. */
  /* Sólo se muestra si hay algo que reconciliar: 11 de 16 no la necesitan. */
  const showResidual = monthsOfYear.some((m) => Math.abs(residual[m]) > 0.001);
  const currentAboveForecast = residual[currentMonth] < -0.001;

  /*
   * El total: la suma de las filas que la tabla MUESTRA, incluida la de
   * reconciliación. Da el mismo número que la lista de branches, por
   * construcción -- y así el invariante "el total es la suma de las filas" sigue
   * siendo literal en vez de casi.
   *
   * El total del AÑO no está acá: se calcula al mostrarlo, sumando lo que se ve
   * -- ver `sumOfShown` en `format.ts`.
   */
  const totalByMonth: Record<string, number | null> = {};
  for (const m of monthsOfYear) {
    const base = strategiesByMonth[m];
    totalByMonth[m] = base === null && !showResidual ? null : (base ?? 0) + residual[m];
  }

  return (
    <div className="hub-container ol-page">
      <div className="page-head">
        <div>
          <div className="bp-breadcrumbs">
            <Link href="/outlook">Outlook</Link> <span>›</span> <span>{branch.branchCode}</span>
          </div>
          <h1 className="page-head__title">
            Branch {branch.branchCode}
            {/*
              Era un párrafo al pie y ahora es una marca al lado del título: dice
              lo mismo en dos palabras, y está donde se mira primero en vez de
              debajo de la tabla que viene a explicar.
            */}
            {/*
              ⚠ DICE `Inactive`, LO MISMO QUE LA VISTA 1 — corregido en OL22.
              Decía `does not project`, que describe la CONSECUENCIA; la vista 1
              pasó a decir el ESTADO en OL21 y las dos pantallas quedaron
              nombrando la misma cosa de dos maneras. El motivo sigue en el
              tooltip, que es donde se busca.

              ⚠ Y LA CONDICIÓN ES `branch.isInactive`, la del loader, no la
              local: `projectsNothing` preguntaba a `loanOfficers`, que incluye
              a los outsiders de OL16 -- el 741 tiene un cierre de alguien de
              otro branch, así que contestaba distinto que la vista 1.
            */}
            {branch.isInactive && branch.ytd > 0 && (
              <span
                className="bp-muted ol-tag"
                title={
                  `No active producer on the roster has this branch. Its ${branch.ytd} closings this year are real ` +
                  `and count in the division total, but there is nobody to give a budget to — the projection is ` +
                  `charged to each person's roster branch, because it is one number per person, not per loan. ` +
                  `Who owns this budget is still to be decided.`
                }
              >
                Inactive
              </span>
            )}
          </h1>
          {/*
            ⚠ LOS DOS "+N" SON EL PRECIO DE DOS REGLAS, y van acá porque sin
            ellos el total del branch no da la suma de sus filas y nadie sabe por
            qué. Son cosas distintas:

              unattributed       el originador no pertenece a la división
                                 (`org.source_name_excluded`).
              closedByOutsiders  el originador SÍ es de la división, pero de otro
                                 branch: el roster lo pone en otro lado, así que
                                 su fila está allá. Nuevo en OL8.
          */}
          <p className="page-head__subtitle">
            {branch.loanOfficers.length} loan officer{branch.loanOfficers.length === 1 ? '' : 's'} · closed {branch.ytd}
            {branch.closedByOutsiders > 0 ? (
              <span title="Closed in this branch by loan officers whose roster branch is another one. Their production counts here, because the loan closed here; their row lives in their own branch.">
                {' '}
                (+{branch.closedByOutsiders} by loan officers from other branches)
              </span>
            ) : null}
            {branch.unattributed > 0 ? (
              <span title="Closed in this branch by someone who is not a loan officer of the division — listed in org.source_name_excluded with a written reason. Not counted in any branch total.">
                {' '}
                (+{branch.unattributed} outside the division)
              </span>
            ) : null}{' '}
            {/*
              Un solo total, porque la tabla ahora cuadra con la lista: la fila
              de reconciliacion lleva la diferencia. Antes aca habia dos numeros
              y una explicacion de por que no coincidian.
            */}
            · {year} total {fmt(sumOfShown(monthsOfYear.map((m) => totalByMonth[m])))}
          </p>
        </div>
      </div>

      {/*
        ══════════════════════ UNA SOLA TABLA — etapa OL9 ═════════════════════
        Cada estrategia se abre por lo que corresponde a SU unidad de decision
        -- ver `BranchStrategy` en el loader:

          Own Production  por LOAN OFFICER
          NPPM            por REALTOR
          B2B             no se abre: es del branch
          Recruitment     no se abre: es del branch
          Affinity        no se abre: es del branch

        ⚠ HABIA UN BLOQUE DE LOAN OFFICERS ARRIBA Y SE FUE. Su contenido vive
        dentro de Own Production, que ya se abria por persona, asi que eran dos
        listas de la misma gente en la misma pantalla. Lo que se movio con el:
        el rol (BM) y el estado del roster, que van al lado del nombre en su
        fila. Lo que se saco: la columna de funnel, que es informacion de
        Business Plan y no tiene lugar en una tabla de presupuesto.

        ⚠ Y LO QUE DEJO DE EXISTIR: la fila con el TOTAL de una persona. Galo
        Rizzo mostraba 45 arriba --sus cinco estrategias-- y 38 abajo en Own
        Production; queda el 38. Un presupuesto se arma por estrategia, asi que
        esta bien; pero "cuanto hace Galo Rizzo en total" pasa a ser una
        pregunta de Business Plan y ya no se contesta aca.
      */}
      <div className="ol-block__head">
        <h2 className="ol-block__title">Budget by strategy</h2>
        <label className="ol-horizon">
          <span>Project through</span>
          <select
            className="field"
            value={meses}
            onChange={(e) => setHorizonte(Number(e.target.value))}
            title="How many months forward the budget columns go. The growth rules already know how to reach any future month; this only decides how many are drawn."
          >
            <option value={horizonteHastaDic}>Dec {year}</option>
            {/*
              ⚠ DOS FORMAS DE PENSAR EL MISMO HORIZONTE, y las dos sirven: "seis
              meses más" es una pregunta de planificación y "hasta diciembre del
              año que viene" es una de presupuesto anual. Ninguna reemplaza a la
              otra, así que están las dos.

              La etiqueta dice SIEMPRE hasta dónde llega -- `12 months (Sep 2027)`
              y `Dec 2027 (16 months)` -- para que las dos listas se puedan
              comparar entre sí sin contar meses a mano.
            */}
            {[6, 12, 18, 24]
              .filter((n) => n !== horizonteHastaDic)
              .map((n) => (
                <option key={n} value={n}>
                  {n} months ({monthLabel(addMonths(currentMonth, n))} {addMonths(currentMonth, n).slice(0, 4)})
                </option>
              ))}
            {finesDeAnio.map(({ anio, meses }) => (
              <option key={'y' + anio} value={meses}>
                Dec {anio} ({meses} months)
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tbl-scroll">
        <table className="piv bp-table--los ol-year">
          <thead>
            {/*
              ⚠ LAS BANDAS VOLVIERON, Y CON UN ROTULO DISTINTO. Vivian en la
              cabecera del bloque de Loan Officers, que en OL9 dejo de existir.

              Y aca `Actual — closed` llega HASTA EL MES EN CURSO inclusive, no
              hasta el anterior: en esta tabla ese mes es lo que cerro, no un
              pronostico -- ninguna estrategia tiene pronostico porque el
              pipeline no lleva la estrategia consigo. Copiar la banda
              `Forecast` de la otra vista habria rotulado como pronostico una
              columna de cierres reales.
            */}
            <tr className="yr-row">
              <th className="lbl"></th>
              <th className="bp-center ol-band ol-band--actual" colSpan={actualMonths.length + 1}>
                Actual — closed
              </th>
              {remainingMonths.length > 0 && (
                <th className="bp-center ol-band ol-band--budget" colSpan={remainingMonths.length}>
                  Budget
                </th>
              )}
              <th className="bp-center"></th>
              {/* Una sola columna de decisión: el benchmark se fue al nombre. */}
              <th className="bp-center ol-band ol-band--decide" colSpan={1}>
                Decision
              </th>
            </tr>
            <tr className="mo-row">
              <th className="lbl">Strategy</th>
              {monthsOfYear.map((m) => (
                <th key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {monthLabel(m)}
                </th>
              ))}
              <th className="bp-center totcol">{totalLabel}</th>
              <th className="ol-rulecol">Rule</th>
              {/* Sin columna de funnel: es informacion de Business Plan. */}
            </tr>
          </thead>
          <tbody>
            {strategyRows.map(({ bs, s, proyecta, sYear, bench, steps, porDueno, huerfanoPorMes }) => {
              const abierta = open.has('s:' + s);
              /*
               * ⚠ SIN HIJAS NO SE PLIEGA — etapa OL19. Desde que Recruitment
               * filtra por participación, una estrategia que se abre por persona
               * puede no tener a nadie: el 747 y el 777 tienen pipeline de
               * Recruitment este mes y ni un cierre de alguien con fila acá. El
               * chevron prometía algo que al abrirse no mostraba nada.
               */
              const personas = personasDe(bs);
              const plegable =
                bs.opensBy === 'loanOfficer'
                  ? personas.length + bs.recruits.length > 0
                  : bs.opensBy !== 'branch';

              const conBenchmark = personas.filter((lo) => (lo.strategyBenchmarks[s] ?? 0) > 0).length;
              /*
                ⚠ CORTO, Y EL RESTO EN EL TOOLTIP. Own Production y NPPM no
                tienen regla propia --deciden por persona y por realtor-- así que
                su columna es un RESUMEN, no una decisión. La frase entera
                empujaba la tabla 6px más allá de su caja en el 733 y se cortaba
                contra el borde sin verse entera.
              */
              const conAE = bs.owners.filter((o) => o.isPerson && o.benchmarkSchedule.length > 0).length;
              const regla =
                bs.opensBy === 'loanOfficer'
                  ? /*
                     * "0 of 0" no dice nada. Sin nadie, lo que hay que decir es
                     * que la estrategia tiene pipeline este mes y todavía nadie
                     * a quien atribuírselo acá -- ver el título.
                     */
                    personas.length === 0
                    ? 'nobody yet'
                    : `${conBenchmark} of ${personas.length}`
                  : bs.opensBy === 'owner'
                    ? `${conAE} of ${bs.owners.filter((o) => o.isPerson).length}`
                    : s === 'NPPM'
                    ? `${bs.realtors.length} realtor${bs.realtors.length === 1 ? '' : 's'}`
                    : branchRuleLabel(bs);
              const reglaTitulo =
                bs.opensBy === 'loanOfficer'
                  ? personas.length === 0
                    ? `Nobody in this branch has closings in ${s} or a budget for it, so there is no row to open. ` +
                      `The month's figure is pipeline that is classified as ${s}: the loans are real and they are ` +
                      `counted, they just have no owner here yet.`
                    : `${conBenchmark} of the ${personas.length} loan officers shown here have a benchmark in ${s}.` +
                      (s === 'Recruitment'
                        ? ` Recruitment only opens for those who took part in it: ${
                            branch.loanOfficers.length - personas.length
                          } of the branch's ${branch.loanOfficers.length} loan officers have no closings in it and ` +
                          `no budget, so they have no row.`
                        : '')
                  : bs.opensBy === 'owner'
                    ? `${conAE} of the ${bs.owners.filter((o) => o.isPerson).length} owners have a ` +
                      `benchmark. The system user cannot have one.`
                    : s === 'NPPM'
                    ? `${bs.realtors.length} realtor${bs.realtors.length === 1 ? '' : 's'} in this branch. Each one's ` +
                      `benchmark defaults to the average of their closings over the 3 closed months.`
                    : branchRuleLabel(bs);

              return (
                <Fragment key={'s-' + s}>
                  <tr
                    className={'grp d1' + (plegable ? ' togg' : '')}
                    onClick={plegable ? () => toggle('s:' + s) : undefined}
                  >
                    <td className="lbl">
                      {plegable ? (
                        <span className={'chev' + (abierta ? ' open' : '')} aria-hidden="true">
                          ›
                        </span>
                      ) : (
                        /* Sin chevron, con la misma sangria: la fila no se abre. */
                        <span className="chev chev--none" aria-hidden="true" />
                      )}
                      {s}
                      {bs.opensBy === 'loanOfficer' && (
                        <span
                          className="bp-muted ol-tag"
                          title="The question here is how much each loan officer does, so it opens by person."
                        >
                          by loan officer
                        </span>
                      )}
                      {bs.opensBy === 'realtor' && (
                        <span
                          className="bp-muted ol-tag"
                          title="The loan is brought in by the realtor, so it opens by realtor. Which loan officer processed it is not the unit of decision here."
                        >
                          by realtor
                        </span>
                      )}
                      {bs.opensBy === 'branch' && (
                        <span
                          className="bp-muted ol-tag"
                          title="This is the branch's, not a person's. The question is how many loans it brought in and how much it projects, not how much each person did — so there is nothing to open."
                        >
                          branch level
                        </span>
                      )}
                      {bs.opensBy === 'owner' && (
                        <span
                          className="bp-muted ol-tag"
                          title="These loans are brought in by the opportunity owner — an Account Executive in Affinity, a Business Developer in B2B — so the strategy opens by owner and each one has their own budget."
                        >
                          by owner
                        </span>
                      )}
                      {/*
                        Su benchmark. Editable sólo en las de branch --las otras
                        son la SUMA de sus hijas y no hay nada que guardar--.
                      */}
                      <BenchTag
                        value={bench}
                        onEdit={esDelBranch(bs) ? () => setEditing({ kind: 'branch', strategy: s }) : undefined}
                        editLabel={`Edit ${s}'s benchmark and rule for branch ${branch.branchCode}`}
                        editTitle={`Set ${s}'s benchmark and growth rule for the whole branch`}
                      />
                    </td>
                    {monthsOfYear.map((m) => (
                      <td
                        key={m}
                        className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                        title={
                          m === currentMonth
                            ? 'What actually closed this month. There is no forecast by strategy: Forecast projects the month from the pipeline, which does not carry the strategy — so this column shows the real closings, not a projection.'
                            : m > currentMonth && !proyecta
                              ? 'Nothing is set for this strategy yet, so there is no budget to show. Not the same as a budget of zero.'
                              : undefined
                        }
                      >
                        {fmt(sYear.byMonth[m] ?? null)}
                      </td>
                    ))}
                    <td
                      className="bp-center totcol"
                      title={`${monthLabel(currentMonth)} is what actually closed, not the forecast — so this total is below the one in the block above, by the part of the forecast that has not closed yet.`}
                    >
                      {fmt(sumOfShown(monthsOfYear.map((m) => sYear.byMonth[m] ?? null)))}
                    </td>
                    {/*
                      ⚠ EL LÁPIZ SÓLO DONDE SE PUEDE DECIDIR. Own Production
                      decide por persona y NPPM por realtor: sus filas de
                      estrategia son sumas, y un lápiz ahí abriría un editor que
                      guardaría en un sujeto que no es el que muestra la fila.
                      Las tres del branch sí se editan acá.
                    */}
                    <td className="ol-rulecol" onClick={(e) => e.stopPropagation()}>
                      {esDelBranch(bs) ? (
                        <button
                          type="button"
                          className={'ol-pill' + (branchHasBudget(bs) ? '' : ' ol-pill--empty')}
                          onClick={() => setEditing({ kind: 'branch', strategy: s })}
                          title={
                            regla +
                            (steps.length > 0
                              ? ` · ${steps.map((st) => `${monthLabel(st.month)} ${fmt(st.value)}`).join(' · ')}`
                              : '')
                          }
                        >
                          {pillOf({
                            mode: bs.mode,
                            rules: bs.rules,
                            hasBenchmark: bs.benchmarkSchedule.length > 0,
                            targetRevision: bs.targetRevision,
                          })}
                        </button>
                      ) : (
                        <span className="bp-muted" title={reglaTitulo}>
                          {regla}
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* ── Own Production: se abre por Loan Officer ───────────── */}
                  {abierta &&
                    bs.opensBy === 'loanOfficer' &&
                    (() => {
                      /*
                       * El entero de la estrategia, repartido entre las personas
                       * en proporción a su presupuesto exacto. Así las filas suman
                       * la fila de arriba y ninguna muestra decimales.
                       */
                      const exactos = personas.map((lo) => {
                        const st = projectLoanOfficer(lo, remainingMonths).stepsByStrategy[s] ?? [];
                        const out: Record<string, number> = {};
                        remainingMonths.forEach((m, i) => (out[m] = st[i]?.value ?? 0));
                        return out;
                      });
                      const enteros: Record<string, number>[] = personas.map(() => ({}));
                      for (const m of remainingMonths) {
                        const partes = apportionByWeight(
                          presupuestoDe.get(s)?.[m] ?? 0,
                          exactos.map((e) => e[m] ?? 0)
                        );
                        partes.forEach((v, i) => (enteros[i][m] = v));
                      }
                      return personas.map((lo, idx) => {
                      const cell = cellOf(lo, s, enteros[idx]);
                      const isMonthly = (lo.modeByStrategy[s] ?? 'growth') === 'monthly';
                      const b = lo.strategyBenchmarks[s] ?? 0;
                      return (
                        <tr key={'s-' + s + '-' + lo.employeeKey} className="metric mrow">
                          <td className="lbl" style={{ paddingLeft: '30px' }}>
                            {lo.fullName}
                            {/*
                              ⚠ EL ESTADO Y EL ROL VIVIAN EN EL BLOQUE DE ARRIBA,
                              que en OL9 dejo de existir. Se mudaron aca y no se
                              perdieron: son lo que distingue a Isabel Wagner
                              --una baja con produccion real-- de alguien que
                              sigue produciendo, y a los 10 que ademas dirigen su
                              branch. Sin eso la fila dice un nombre y un numero
                              y hay que preguntar quien es.
                            */}
                            {STATE_TAG[lo.rosterState] && (
                              <span className="bp-muted ol-tag" title={STATE_TAG[lo.rosterState].title}>
                                {STATE_TAG[lo.rosterState].text}
                              </span>
                            )}
                            {!lo.hasIdentity && (
                              <span
                                className="bp-muted ol-tag"
                                title={
                                  'The roster says they produce, but there is no person_code alias tying them to an ' +
                                  'internal identity, and benchmark and plan both hang off it. Shown with name and ' +
                                  'branch so the branch total keeps adding up. Someone has to create the alias.'
                                }
                              >
                                no internal identity
                              </span>
                            )}
                            {lo.isBranchManager && (
                              <span className="bp-muted ol-tag" title="Manages the branch as well as producing.">
                                BM
                              </span>
                            )}
                            <BenchTag
                              value={isMonthly ? null : b}
                              onEdit={() => setEditing({ kind: 'employee', employeeKey: lo.employeeKey, strategy: s })}
                              editLabel={`Edit ${lo.fullName}'s benchmark and rule in ${s}`}
                              editTitle={
                                isMonthly
                                  ? 'Set month by month: the benchmark does not take part. It stays saved in case this goes back to growth rate.'
                                  : `Its benchmark is edited in the Business Plan. What is edited here is ${lo.fullName}'s growth rule.`
                              }
                            />
                          </td>
                          {monthsOfYear.map((m) => (
                            <td
                              key={m}
                              className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                              title={
                                m === currentMonth
                                  ? 'What actually closed this month, not a forecast: the pipeline does not carry the strategy.'
                                  : m > currentMonth
                                    ? cell.steps[remainingMonths.indexOf(m)]?.explain
                                    : undefined
                              }
                            >
                              {fmt(cell.year.byMonth[m] ?? null)}
                            </td>
                          ))}
                          <td className="bp-center totcol">{fmt(sumOfShown(monthsOfYear.map((m) => cell.year.byMonth[m] ?? null)))}</td>
                          {/*
                            ⚠ LA PÍLDORA TAMBIÉN ACÁ, y sobre todo acá: son estas
                            filas las que repetían `25% quarterly from Sep · 1st
                            raise in Dec` diez veces. La frase entera y la
                            revisión viven en el tooltip; lo que se compara de un
                            vistazo es cuánto y cada cuánto.
                          */}
                          <td className="ol-rulecol">
                            <button
                              type="button"
                              className={
                                'ol-pill' +
                                ((lo.rulesByStrategy[s] ?? []).length || isMonthly ? '' : ' ol-pill--empty')
                              }
                              onClick={() => setEditing({ kind: 'employee', employeeKey: lo.employeeKey, strategy: s })}
                              title={
                                `${ruleLabel(lo, s, remainingMonths)} · revision ` +
                                `${(isMonthly ? lo.targetRevision[s] : lo.ruleRevision[s]) || 0}`
                              }
                            >
                              {pillOfLo(lo, s)}
                            </button>
                          </td>
                        </tr>
                      );
                      });
                    })()}


                  {/*
                    ══════════════════════════════════════════════════════════
                    LA GENTE EN PROCESO DE CONTRATACIÓN — etapa OL20
                    ══════════════════════════════════════════════════════════

                    Van como hijas de Recruitment, al mismo nivel que las
                    personas reales, y lo que las distingue NO es sólo la
                    píldora:

                      una persona real      tiene meses cerrados
                      una proyectada        los tiene VACÍOS

                    Esa es la diferencia que se lee sin explicación, y es la
                    misma distinción entre vacío y cero que el módulo usa en
                    todos lados. La píldora dice por qué.

                    ⚠ Y CADA CERO LLEVA SU MOTIVO en el tooltip. Un cero sin
                    razón en una fila proyectada es indistinguible de un bug:
                    puede ser la etapa, el vínculo, el benchmark que nadie fijó
                    o el vencimiento, y son cuatro cosas distintas.
                  */}
                  {abierta &&
                    bs.recruits.map((r) => {
                      const suma = monthsOfYear.reduce((a, m) => a + (r.byMonth[m] ?? 0), 0);
                      return (
                        <tr key={'s-' + s + '-rec-' + r.identity} className="metric mrow ol-rec">
                          <td className="lbl" style={{ paddingLeft: '30px' }}>
                            {r.personName}
                            {/*
                              ⚠ SIN MODIFICADOR POR ETAPA. Habia un
                              `ol-tag--<stage>` por fila y ninguna hoja de
                              estilo lo definia: cinco clases que no hacian
                              nada. La etiqueta ya dice la etapa con palabras,
                              que es mas claro que un color que hay que
                              aprender.
                            */}
                            <span className="bp-muted ol-tag" title={RECRUIT_TITLE[r.stage](r)}>
                              {STAGE_LABEL[r.stage]}
                            </span>
                            {r.linkedEmployeeKey !== null && (
                              <span
                                className="bp-muted ol-tag"
                                title={
                                  r.linkedByNmls
                                    ? 'Matched to a roster employee by NMLS, which is a national registry number and ' +
                                      'therefore an exact match. From here on the roster projects them, so this row adds nothing.'
                                    : 'Someone confirmed which roster employee this is. From here on the roster projects ' +
                                      'them, so this row adds nothing.'
                                }
                              >
                                {r.linkedByNmls ? 'in roster (NMLS)' : 'in roster'}
                              </span>
                            )}
                            <BenchTag
                              value={r.monthlyBenchmark}
                              onEdit={() => setEditingRecruit(r.identity)}
                              editLabel={`Edit ${r.personName}'s projection`}
                              editTitle={
                                r.monthlyBenchmark === null
                                  ? 'Nobody has set how much they are expected to produce, so this row adds nothing. ' +
                                    'Empty, not zero: zero would claim no production is expected.'
                                  : `Expected ${r.monthlyBenchmark} a month once ramped up, from ${r.producingFrom}.`
                              }
                            />
                          </td>
                          {monthsOfYear.map((m) => (
                            <td
                              key={m}
                              className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                              title={
                                m > currentMonth
                                  ? RECRUIT_MONTH_TITLE(r, m)
                                  : /*
                                     * Los meses ya cerrados y el actual van VACÍOS y
                                     * no en cero: esta persona no estaba, así que no
                                     * hay producción que informar. Un cero diría que
                                     * estuvo y no cerró nada.
                                     */
                                    'Not on the roster this month, so there is nothing to report — empty, not zero.'
                              }
                            >
                              {/*
                                ⚠ VACÍO CUANDO NO PROYECTA, no cero. Un `0` en un
                                mes futuro afirmaría que se espera que esa persona
                                no cierre nada; la verdad es que nadie fijó su
                                benchmark, o que su etapa no entra al presupuesto.
                                Es la misma distinción de siempre y acá es la que
                                hace legible la fila: la píldora dice por qué está
                                vacía.

                                Cuando SÍ proyecta, el cero se muestra: un mes
                                anterior a `producing_from` es un cero decidido --
                                todavía no cuenta-- y no una ausencia.
                              */}
                              {m > currentMonth && !r.notProjecting ? fmt(r.byMonth[m] ?? null) : ''}
                            </td>
                          ))}
                          <td className="bp-center totcol">{fmt(suma === 0 ? null : suma)}</td>
                          <td className="ol-rulecol">
                            <button
                              type="button"
                              className={'ol-pill' + (r.notProjecting ? ' ol-pill--empty' : '')}
                              onClick={() => setEditingRecruit(r.identity)}
                              title={RECRUIT_TITLE[r.stage](r)}
                            >
                              {r.notProjecting ? NOT_PROJECTING_PILL[r.notProjecting] : 'ramping up'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                  {/* ── Affinity: se abre por Account Executive ─────────────── */}
                  {abierta &&
                    bs.opensBy === 'owner' &&
                    bs.owners.map((o, idx) => {
                      /*
                        ⚠ El usuario de sistema muestra sus cierres reales y su
                        presupuesto queda VACÍO, no en cero: no hay a quién
                        pedírselo. Es la misma distinción de siempre -- cero es una
                        decisión, vacío es que no hay ninguna.
                      */
                      const oYear = composeYear(
                        monthsOfYear,
                        currentMonth,
                        o.actualByMonth,
                        o.actualByMonth[currentMonth] ?? 0,
                        o.isPerson ? porDueno[idx] : {}
                      );
                      return (
                        <tr key={'s-' + s + '-ae-' + o.owner} className="metric mrow">
                          <td className="lbl" style={{ paddingLeft: '30px' }}>
                            {o.owner}
                            {!o.isPerson && (
                              <span
                                className="bp-muted ol-tag"
                                title={
                                  `Not a person: it is the Salesforce system user, listed in ` +
                                  `org.source_name_excluded. Its closings are real and counted, so the row is here ` +
                                  `and the strategy total adds up — but there is nobody to give a budget to.`
                                }
                              >
                                system user
                              </span>
                            )}
                            {o.isPerson && (
                              <BenchTag
                                value={o.mode === 'monthly' ? null : o.benchmarkSchedule.length ? o.benchmarkAtDisplay : null}
                                onEdit={() =>
                                  setEditing({ kind: 'employee', employeeKey: o.employeeKey as number, strategy: s })
                                }
                                editLabel={`Edit ${o.owner}'s benchmark and rule in ${s}`}
                                editTitle={`Set ${o.owner}'s benchmark and growth rule in ${s}`}
                              />
                            )}
                          </td>
                          {monthsOfYear.map((m) => (
                            <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                              {fmt(oYear.byMonth[m] ?? null)}
                            </td>
                          ))}
                          <td className="bp-center totcol">
                            {fmt(sumOfShown(monthsOfYear.map((m) => oYear.byMonth[m] ?? null)))}
                          </td>
                          {/* Su presupuesto, editable como el de una persona. */}
                          <td className="ol-rulecol">
                            {o.isPerson ? (
                              <button
                                type="button"
                                className={
                                  'ol-pill' + (o.rules.length || o.mode === 'monthly' ? '' : ' ol-pill--empty')
                                }
                                onClick={() =>
                                  setEditing({ kind: 'employee', employeeKey: o.employeeKey as number, strategy: s })
                                }
                                title={`Revision ${(o.mode === 'monthly' ? o.targetRevision : o.ruleRevision) || 0}`}
                              >
                                {pillOf({
                                  mode: o.mode,
                                  rules: o.rules,
                                  hasBenchmark: o.benchmarkSchedule.length > 0,
                                  targetRevision: o.targetRevision,
                                })}
                              </button>
                            ) : (
                              <span className="bp-muted">no budget</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                  {/*
                    ⚠ EL PRESUPUESTO DE BRANCH QUE QUEDO SIN DUEÑO. Ver `exactoDe`:
                    son las dos filas cargadas antes de OL15, que no se pueden
                    reasignar a una persona. Editable, para poder corregirlas o
                    ponerlas en cero cuando se decida como repartirlas.
                  */}
                  {abierta && bs.opensBy === 'owner' && branchHasBudget(bs) && (
                    <tr className="metric mrow ol-residual">
                      <td className="lbl" style={{ paddingLeft: '30px' }}>
                        Branch level, no owner
                        <span
                          className="bp-muted ol-tag"
                          title={
                            `A budget saved for the whole branch, before this strategy started budgeting per owner. ` +
                            `It cannot be reassigned automatically: it covers ${bs.owners.filter((o) => o.isPerson).length} ` +
                            `owners and splitting it is a business decision. It is still counted so no real budget is lost.`
                          }
                        >
                          to be split
                        </span>
                        <BenchTag
                          value={bs.benchmarkAtDisplay}
                          onEdit={() => setEditing({ kind: 'branch', strategy: s })}
                          editLabel={`Edit the branch-level budget left in ${s}`}
                          editTitle="Edit or zero out the branch-level budget that has no owner yet"
                        />
                      </td>
                      {monthsOfYear.map((m) => (
                        <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                          {m > currentMonth ? fmt(huerfanoPorMes[m] ?? 0) : ''}
                        </td>
                      ))}
                      <td className="bp-center totcol">
                        {fmt(sumOfShown(remainingMonths.map((m) => huerfanoPorMes[m] ?? 0)))}
                      </td>
                      <td className="ol-rulecol bp-muted">not assigned</td>
                    </tr>
                  )}

                  {/* ── NPPM: se abre por realtor ──────────────────────────── */}
                  {abierta &&
                    bs.opensBy === 'realtor' &&
                    bs.realtors.map((r) => {
                      /*
                        Un realtor tiene meses REALES y nada mas: su benchmark no
                        proyecta (ver `NppmEditor`), asi que del mes en curso en
                        adelante la fila va vacia.
                      */
                      const rYear = composeYear(
                        monthsOfYear,
                        currentMonth,
                        r.actualByMonth,
                        r.actualByMonth[currentMonth] ?? 0,
                        {}
                      );
                      return (
                        <tr key={'s-' + s + '-r-' + r.realtor} className="metric mrow">
                          <td className="lbl" style={{ paddingLeft: '30px' }}>
                            {r.realtor}
                            {/*
                              ⚠ Dos decimales: el promedio de 3 meses de un realtor
                              es casi siempre fraccionario --0,33 · 0,67 · 1,33-- y
                              con uno se pierde de dónde sale el número. Por eso el
                              valor va formateado acá y no por `fmt`.
                            */}
                            <BenchTag
                              value={r.benchmark}
                              onEdit={() => setEditingNppm({ realtor: r.realtor, ytd: r.ytd })}
                              editLabel={`Edit ${r.realtor}'s benchmark`}
                              editTitle={
                                r.benchmarkIsDefault
                                  ? `Nobody has set it, so what applies is the average of their closings over the 3 ` +
                                    `closed months: ${r.avg3m.toFixed(2)}. One number per realtor, across every branch.`
                                  : `Set by hand. Their 3-month average is ${r.avg3m.toFixed(2)}.`
                              }
                              text={Number.isInteger(r.benchmark) ? String(r.benchmark) : r.benchmark.toFixed(2)}
                            />
                          </td>
                          {monthsOfYear.map((m) => (
                            <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                              {fmt(rYear.byMonth[m] ?? null)}
                            </td>
                          ))}
                          <td className="bp-center totcol">{fmt(sumOfShown(monthsOfYear.map((m) => rYear.byMonth[m] ?? null)))}</td>
                          {/*
                            ⚠ EL DEFAULT ES EL PROMEDIO DE SUS 3 MESES CERRADOS, y
                            si nadie lo toca ESE es el valor -- no un cero ni un
                            hueco. Se marca `default` para que se distinga de un
                            numero que alguien decidio.
                          */}
                          {/*
                            ⚠ DOS decimales, no uno. El benchmark de un realtor
                            es el promedio de 3 meses y casi siempre fraccionario:
                            0,33 · 0,67 · 1,33. Con un decimal salen 0,3 · 0,7 ·
                            1,3 y se pierde de dónde viene el número -- son
                            tercios. El resto de la tabla sigue con un decimal,
                            que es lo que un pronóstico de pipeline necesita.
                          */}
                          {/*
                            El realtor no tiene regla: su columna dice de dónde
                            sale el número, que es lo único que hay que decidir.
                          */}
                          <td className="ol-rulecol">
                            <button
                              type="button"
                              className={'ol-pill' + (r.benchmarkIsDefault ? ' ol-pill--empty' : '')}
                              onClick={() => setEditingNppm({ realtor: r.realtor, ytd: r.ytd })}
                              title={
                                r.benchmarkIsDefault
                                  ? `Nobody has set it, so what applies is the average of their closings over the 3 ` +
                                    `closed months: ${r.avg3m.toFixed(2)}. One number per realtor, across every branch.`
                                  : `Set by hand. Their 3-month average is ${r.avg3m.toFixed(2)}.`
                              }
                            >
                              {r.benchmarkIsDefault ? '3-mo avg' : 'by hand'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                </Fragment>
              );
            })}

            {/*
              LO QUE NINGUNA ESTRATEGIA RECLAMA. Ver `residual` arriba: es un
              residuo puro, asi que el total sigue siendo la suma de las filas.
              No se muestra cuando no hay nada que reconciliar.
            */}
            {showResidual && (
              <tr className="metric ol-residual">
                <td className="lbl">
                  {/*
                    ⚠ EL RÓTULO SALE DE DÓNDE ESTÁ EL RESIDUO, no de una
                    suposición. Decía "Aug pipeline, no strategy yet" fijo, y
                    desde que el mes en curso se reparte por estrategia (OL12) su
                    residuo es cero: la fila quedaba anunciando agosto con su
                    único valor en mayo. Un rótulo que no describe su propia fila
                    es peor que ninguno.
                  */}
                  {Math.abs(residual[currentMonth]) > 0.001
                    ? currentAboveForecast
                      ? `${monthLabel(currentMonth)} already above forecast`
                      : `${monthLabel(currentMonth)} pipeline, no strategy yet`
                    : 'Counted for a realtor, not for the branch'}
                  <span
                    className="bp-muted ol-tag"
                    title={
                      Math.abs(residual[currentMonth]) <= 0.001
                        ? `Closings counted for an NPPM realtor but not for the branch, because the loan officer who ` +
                          `originated them is outside the division. The row carries the difference so the total ` +
                          `matches the branch list.`
                        : currentAboveForecast
                        ? `This branch has already closed more this month than its forecast expected: ` +
                          `${fmt(strategiesByMonth[currentMonth])} closed against a forecast of ` +
                          `${fmt(branchYear.byMonth[currentMonth])}. The row carries the difference so the total ` +
                          `matches the branch list.`
                        : `The part of ${monthLabel(currentMonth)}'s forecast that no strategy can claim: Forecast ` +
                          `projects the month from the pipeline, which does not carry the strategy. This row goes ` +
                          `away the day it does.`
                    }
                  >
                    not a strategy
                  </span>
                </td>
                {monthsOfYear.map((m) => (
                  <td
                    key={m}
                    className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                    title={
                      Math.abs(residual[m]) <= 0.001
                        ? undefined
                        : m === currentMonth
                          ? `The branch list shows ${fmt(branchYear.byMonth[m])} for ${monthLabel(m)} and the five ` +
                            `strategies add up to ${fmt(strategiesByMonth[m])}. This is the difference.`
                          : `${monthLabel(m)} differs from the branch list by ${fmt(residual[m])}: closings counted ` +
                            `for a realtor but not for the branch, because the loan officer who originated them is ` +
                            `outside the division. See the tag on the NPPM row.`
                    }
                  >
                    {Math.abs(residual[m]) <= 0.001 ? '' : fmt(residual[m])}
                  </td>
                ))}
                <td className="bp-center totcol">{fmt(sumOfShown(monthsOfYear.map((m) => (Math.abs(residual[m]) <= 0.001 ? null : residual[m]))))}</td>
                <td className="bp-center"></td>
                <td className="ol-rulecol"></td>
              </tr>
            )}

            {/*
              El total del branch: la SUMA de las filas de arriba, columna por
              columna, incluida la de reconciliacion. Ver `totalByMonth` -- no se
              calcula por otra via, y da el mismo numero que la lista.
            */}
            <tr className="metric ol-total">
              <td className="lbl">Branch {branch.branchCode}</td>
              {monthsOfYear.map((m) => (
                <td
                  key={m}
                  className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                  title={
                    m === currentMonth
                      ? `The month's forecast, same as in the branch list. The five strategies add up to ` +
                        `${fmt(strategiesByMonth[m])} — what actually closed — and the row above carries the rest.`
                      : undefined
                  }
                >
                  {fmt(totalByMonth[m])}
                </td>
              ))}
              <td className="bp-center totcol" title="The sum of the five strategies, column by column.">
                {fmt(sumOfShown(monthsOfYear.map((m) => totalByMonth[m])))}
              </td>
              <td className="bp-center"></td>
              <td className="ol-rulecol"></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/*
        El aviso va DEBAJO del bloque 2, pegado a los ceros que explica. En el
        pie de la pagina lo leeria quien ya se hizo la pregunta; aca lo lee quien
        esta mirando la columna en cero.
      */}
      {/*
        ⚠ ACÁ HABÍA UN PÁRRAFO Y SE FUE — etapa OL12.

        Explicaba qué se puede editar y qué significa una celda en blanco. Cinco
        líneas de texto debajo de una tabla de doce columnas, que sólo se leen la
        primera vez: quien ya sabe lo saltea, y quien no sabe lo descubre antes
        haciendo clic en el lápiz.

        Lo que decía vive donde se busca: el lápiz se ve en la fila que se puede
        editar, y por qué una celda está vacía lo dice su tooltip.
      */}

      {/*
        Igual que en la vista 1: se EXPLICA, no se calcula distinto. Una fila con
        cerrados y proyección en cero, sin texto, se reporta como bug.
      */}

      {/*
        ⚠ LOS CIERRES AJENOS, CON NOMBRE — etapa OL16.

        El total del branch no da la suma de sus filas: cuenta lo que cerró ACÁ,
        incluidos préstamos de gente de otro branch. `closedByOutsiders` ya decía
        cuánto faltaba; esto dice de quién.

        Una línea y nada más. Sin párrafo: con los nombres al lado del número, el
        descuadre se explica solo -- que es el criterio que reemplazó a los
        párrafos en OL6 y OL12.
      */}
      {/*
        ══════════════════════════════════════════════════════════════════════
        LA BARRA DE RECLUTAMIENTO — etapa OL20
        ══════════════════════════════════════════════════════════════════════

        La rampa y el alta a mano. Va debajo de la tabla porque las dos son
        decisiones del PROGRAMA y no de una fila: la rampa es una y es de los
        diecisiete branches, y un alta a mano todavía no tiene fila.

        ⚠ SE OFRECE SÓLO SI HAY DÓNDE GUARDAR. Es lo mismo que hace
        `monthlyModeAvailable` con el modo mes a mes: sin las tres tablas de
        OL20 aplicadas, alguien llenaría el formulario de quince personas para
        descubrir al apretar Guardar que no hay tabla.
      */}
      {/*
        ══════════════════════════════════════════════════════════════════════
        ⚠ LA RAMPA Y EL ALTA SE FUERON DE ACÁ — etapa OL21
        ══════════════════════════════════════════════════════════════════════

        Estaban debajo de esta tabla, y sólo en los branches que ya tenían gente
        en proceso: estaban en el 747 y no en el 724. Las dos son decisiones del
        MÓDULO --la rampa rige para los diecisiete branches, y un alta todavía no
        tiene branch-- así que vivir dentro de un branch las hacía parecer de ese
        branch y las escondía en los demás.

        Viven en la vista 1, al lado de la tabla de la división. Desde ahí se
        elige el branch en el formulario y la persona se aloja donde corresponda.

        Lo que SÍ se queda acá: el lápiz de cada fila proyectada, que edita a UNA
        persona y por lo tanto sí es de este branch.
      */}

      {/*
        ══════════════════════════════════════════════════════════════════════
        ⚠ LAS PROYECCIONES VENCIDAS Y SIN VINCULAR — etapa OL20
        ══════════════════════════════════════════════════════════════════════

        Su mes de producción llegó y nadie dijo con quién del roster se
        corresponden, así que dejaron de sumar. Es la única de las cuatro
        razones para no sumar que hay que ARREGLAR: las otras tres son
        decisiones --la etapa, el vínculo, el benchmark que nadie fijó-- y esta
        es un olvido.

        ⚠ Y EL FALLO ELEGIDO ES ESTE, a propósito: un presupuesto corto y
        visible antes que uno inflado y callado. Si al vencer siguiera sumando,
        el mes que la persona entra al roster su producción se contaría dos
        veces y el número seguiría pareciendo plausible. Acá falta, y el aviso
        dice cuánto y de quién.

        ⚠ Y NO NOMBRA A QUIEN ADEMÁS NO TIENE BENCHMARK, porque
        `notProjectingReason` mira el benchmark ANTES del vencimiento. Es el
        orden correcto: sin benchmark no había proyección que perder, así que no
        falta nada del presupuesto -- lo que falta es la decisión, y eso ya lo
        dice la píldora `no benchmark` de su fila. Hoy los quince están así, así
        que este aviso no aparece: se verificó cambiando el filtro a
        `no_benchmark` --4 en el 710, con nombre y con el botón que abre el
        editor-- y volviéndolo atrás. No se escribieron filas de prueba: las
        tablas de OL20 no tienen policy de DELETE, así que una fila de prueba se
        queda para siempre.

        ⚠ NO PROPONE A NADIE. Medido contra los datos de hoy: `employee_alias`
        propone 0 de 15 y el nombre exacto contra `dim_employee` propone 0 de
        15; lo único que propone algo es el apellido, y sus tres propuestas son
        de personas equivocadas. El editor abre una lista alfabética del roster
        y decide una persona -- ver la nota del selector en `RecruitEditor`.
      */}
      {vencidasSinVincular.length > 0 && (
        <p className="ol-notice">
          <b>
            {vencidasSinVincular.length === 1
              ? 'One projection has expired'
              : `${vencidasSinVincular.length} projections have expired`}
          </b>{' '}
          and nobody said who they are on the roster, so they stopped counting:{' '}
          {vencidasSinVincular.map((r, i) => (
            <span key={r.identity}>
              {i > 0 ? ' · ' : ''}
              <button
                type="button"
                className="ol-pill ol-pill--empty"
                onClick={() => setEditingRecruit(r.identity)}
                title={`Producing from ${r.producingFrom}, which has already arrived. Link them to a roster employee, or move the month.`}
              >
                {r.personName}
              </button>
            </span>
          ))}
          . The budget is <b>short</b> by what they were expected to produce, on purpose — counting them while they are
          also on the roster would count the same production twice.
        </p>
      )}

      {branch.outsiders.length > 0 && (
        <p className="ol-outsiders">
          <span className="ol-outsiders__lbl">Closed here by loan officers from other branches:</span>{' '}
          {branch.outsiders.map((o, i) => (
            <span key={o.name}>
              {i > 0 ? ' · ' : ''}
              {o.name} <b>{o.closings}</b>
            </span>
          ))}
        </p>
      )}

      {/*
        Los editores. Se busca la persona en `branch.loanOfficers` en cada render
        y no se guarda el objeto en el estado: después de un guardado, `reload`
        reemplaza `data` entera, y un objeto guardado apuntaría a la versión
        vieja -- el editor seguiría mostrando el benchmark anterior al que se
        acaba de escribir, que es exactamente el bug que uno no revisa.
      */}
      {editing &&
        (() => {
          /*
           * ⚠ El editable se ARMA en cada render, desde `data` fresca. Guardarlo
           * en el estado dejaría al editor mostrando la versión anterior a lo que
           * se acaba de escribir -- el bug que uno no revisa porque el guardado
           * "funcionó".
           */
          let editable: OutlookEditable | null = null;
          if (editing.kind === 'employee') {
            /*
             * ⚠ NO TODA PERSONA ES UN LOAN OFFICER DEL BRANCH — etapa OL14.
             *
             * Los Account Executives de Affinity son personas con `employee_key`
             * y con presupuesto propio, pero NO están en `branch.loanOfficers`:
             * su branch de roster es otro. Buscarlos sólo ahí dejaba el editor
             * sin abrir --se hacía clic en el lápiz y no pasaba nada, sin error--
             * que es la clase de falla que sólo se ve usando la pantalla.
             */
            const ae = branch.byStrategy
              .flatMap((bs) => (bs.opensBy === 'owner' ? bs.owners.map((o) => ({ bs, o })) : []))
              .find(({ o }) => o.isPerson && o.employeeKey === editing.employeeKey);
            if (ae) {
              editable = {
                subject: { kind: 'employee', employeeKey: editing.employeeKey },
                label: ae.o.owner,
                benchmarkSchedules: { [ae.bs.strategy]: ae.o.benchmarkSchedule },
                rulesByStrategy: { [ae.bs.strategy]: ae.o.rules },
                targetsByStrategy: { [ae.bs.strategy]: ae.o.targets },
                modeByStrategy: { [ae.bs.strategy]: ae.o.mode },
                modeSetBy: { [ae.bs.strategy]: ae.o.modeSetBy },
                ruleRevision: { [ae.bs.strategy]: ae.o.ruleRevision },
                targetRevision: { [ae.bs.strategy]: ae.o.targetRevision },
              };
            }
            const lo = !editable ? branch.loanOfficers.find((l) => l.employeeKey === editing.employeeKey) : null;
            if (lo) {
              editable = {
                subject: { kind: 'employee', employeeKey: lo.employeeKey },
                label: lo.fullName,
                benchmarkSchedules: lo.benchmarkSchedules,
                rulesByStrategy: lo.rulesByStrategy,
                targetsByStrategy: lo.targetsByStrategy,
                modeByStrategy: lo.modeByStrategy,
                modeSetBy: lo.modeSetBy,
                ruleRevision: lo.ruleRevision,
                targetRevision: lo.targetRevision,
              };
            }
          } else {
            const bs = branch.byStrategy.find((x) => x.strategy === editing.strategy);
            if (bs) {
              /*
               * Un branch decide UNA estrategia por vez, así que los mapas llevan
               * sólo esa clave. El editor lee siempre `[strategy]`, y darle las
               * cinco lo obligaría a que el loader las trajera todas para nada.
               */
              editable = {
                subject: { kind: 'branch', branchCode: branch.branchCode },
                label: `Branch ${branch.branchCode}`,
                benchmarkSchedules: { [bs.strategy]: bs.benchmarkSchedule },
                rulesByStrategy: { [bs.strategy]: bs.rules },
                targetsByStrategy: { [bs.strategy]: bs.targets },
                modeByStrategy: { [bs.strategy]: bs.mode },
                modeSetBy: { [bs.strategy]: bs.modeSetBy },
                ruleRevision: { [bs.strategy]: bs.ruleRevision },
                targetRevision: { [bs.strategy]: bs.targetRevision },
              };
            }
          }
          if (!editable) return null;
          return (
            <StrategyEditor
              lo={editable}
              strategy={editing.strategy}
              data={data}
              /*
                ⚠ LOS MESES QUE LA TABLA ESTA MOSTRANDO, no los del año — OL21.

                `remainingMonths` de acá es la lista del HORIZONTE elegido, que
                es estado de esta pantalla. Sin esto el editor caia en
                `data.remainingMonths` y ofrecia tres meses mientras la tabla
                dibujaba treinta y seis.
              */
              months={remainingMonths}
              onClose={() => setEditing(null)}
              onSaved={reload}
            />
          );
        })()}

      {editingRecruit !== null &&
        (() => {
          /*
           * ⚠ LA FILA SE RESUELVE ACA, EN CADA RENDER, desde `data` fresca. Es
           * la misma regla que el bloque de los otros editores: `reload`
           * reemplaza `data` entera despues de guardar, asi que un
           * `BranchRecruit` guardado en el estado dejaria el panel mostrando el
           * benchmark anterior al que se acaba de escribir -- el bug que uno no
           * revisa porque el guardado "funciono".
           *
           * ⚠ Y SE BUSCA EN TODOS LOS BRANCHES, no en este. Editar el branch de
           * alguien lo MUEVE de lista: se guarda, `reload` lo pone en el 728, y
           * buscarlo en el 710 no lo encontraria -- el panel se cerraria solo,
           * sin error, justo despues de un guardado correcto.
           */
          const r = data.branches
            .flatMap((b) => b.byStrategy.flatMap((bs) => bs.recruits))
            .find((x) => x.identity === editingRecruit);
          /* La fila se fue de la fuente entre el render y el clic. Nada que abrir. */
          if (r === undefined) return null;
          return (
            <RecruitEditor
              recruit={r}
              /*
                ⚠ TODOS, Y `Recruitment` PRIMERO — corregido en OL21.

                Antes se lo filtraba de la lista "para no ofrecer no-se-sabe como
                destino", y el campo nacia justamente en `Recruitment`: el valor
                por defecto no estaba entre las opciones. Con un `datalist`, que
                filtra por lo escrito, eso dejaba CERO opciones visibles --medido,
                0 de 16-- y parecia que el desplegable solo ofrecia Recruitment.

                La leccion es la del assert: un valor por defecto tiene que ser
                un valor elegible. Si no lo es, algo lo va a ocultar.
              */
              branches={branchOptions(data.branches.map((b) => b.branchCode))}
              /*
                El roster para vincular a mano, de los diecisiete branches y
                ordenado por nombre. La persona con la que hay que vincular a un
                recluta casi nunca esta en el branch donde se lo esta mirando --
                si ya se supiera, el branch estaria corregido.
              */
              roster={data.branches
                .flatMap((b) => b.loanOfficers.map((lo) => ({ employeeKey: lo.employeeKey, name: lo.fullName, branchCode: b.branchCode })))
                .filter((p, i, a) => a.findIndex((q) => q.employeeKey === p.employeeKey) === i)
                .sort((a, b) => a.name.localeCompare(b.name))}
              currentMonth={currentMonth}
              onClose={() => setEditingRecruit(null)}
              onSaved={() => {
                setEditingRecruit(null);
                reload();
              }}
            />
          );
        })()}

      {editingNppm && (
        <NppmEditor
          realtor={editingNppm.realtor}
          ytd={editingNppm.ytd}
          data={data}
          onClose={() => setEditingNppm(null)}
          onSaved={reload}
        />
      )}

      {/*
        ⚠ ACÁ HABÍA UN PÁRRAFO LARGO, Y SE FUE A PROPÓSITO — etapa OL6.

        Explicaba la jerarquía, la excepción del mes en curso, cómo se atribuye
        cada cosa y qué significa cada modo. Ocupaba más alto que la tabla que
        venía a explicar.

        Lo que decía no se perdió: vive donde se busca cuando hace falta.
          · el detalle del cálculo de cada celda, en su tooltip
          · el motivo de un branch que no proyecta, en `does not project` y en su
            tooltip
          · el porqué de cada regla, en las cabeceras de `lib/outlook/*.ts`

        Si algo de la tabla necesita un párrafo para entenderse, el problema
        está en la tabla.
      */}
    </div>
  );
}
