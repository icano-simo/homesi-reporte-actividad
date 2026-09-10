'use client';

import { Fragment, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { focusIndexed, focusIsAbsent, hiddenCount } from '@/lib/review/focus';
import { useReview } from '@/components/review/ReviewProvider';
import {
  composeYear,
  currentMonthByBranch,
  projectBranch,
  type BranchRecruit,
  type YearRow,
} from '@/lib/outlook/loadData';
import {
  STAGE_LABEL,
  shouldShowRecruit,
  type NotProjectingReason,
  type RecruitStage,
} from '@/lib/outlook/recruitment';
import { remainingMonthsFor } from '@/lib/outlook/horizon';
import { fmt, sumOfShown } from '@/lib/outlook/format';
import { useOutlookDataContext } from '@/lib/outlook/useOutlookData';
import NppmEditor from '@/app/outlook/components/NppmEditor';
import RecruitEditor, { branchOptions } from '@/app/outlook/components/RecruitEditor';
import PersonBudgetEditor, {
  type BudgetEditable,
  type OwnProductionRate,
} from '@/app/outlook/components/PersonBudgetEditor';
import OutlookTopBar from '@/app/outlook/components/OutlookTopBar';
import type { PersonSubject } from '@/lib/outlook/save';
/*
 * ⚠ UNA SOLA IMPLEMENTACION del calculo por estrategia — etapa OL22. Esta
 * pantalla tenia su propia copia y la vista 1 otra; ahora las dos leen de acá.
 * Ver la nota de la migración donde estaban los helpers.
 */
import { loanOfficerRowsOf, strategyRowsOf } from '@/lib/outlook/strategyRows';

/**
 * ============================================================================
 * OUTLOOK — VISTA 2: dentro de un branch (etapa OL26, rehecha)
 * ============================================================================
 *
 * ⚠ HISTORIA: hasta OL25 esto se abría por ESTRATEGIA (Own Production, B2B,
 * NPPM, Recruitment, Affinity) -- ver el historial de este archivo si hace
 * falta esa versión. OL26 lo cambia a agruparse por TIPO DE PERSONA:
 *
 *   Loan Officers — existing    el roster: Own Production + Recruitment
 *                                COMBINADOS, una fila por persona.
 *   NPPM — existing              los realtors del branch (sin cambios).
 *   Loan Officers — in hiring    reclutas `role==='loan_officer'` que pasan
 *                                `shouldShowRecruit`.
 *   NPPM — in hiring             ídem, `role==='nppm'` (vacío hoy: nadie
 *                                editó ningún recluta con ese rol todavía).
 *
 * Más una fila `Affinity` (total, sin abrir por Account Executive) y la de
 * reconciliación de siempre. B2B ya NO tiene fila propia -- su presupuesto
 * sigue contando en el total del branch, absorbido por la reconciliación,
 * igual que ya pasaba con Own Production en AFFINITY desde OL22.
 *
 * ⚠ POR QUÉ POR PERSONA Y NO POR ESTRATEGIA: Own Production y Recruitment se
 * abren por la MISMA unidad de decisión -- la persona --, así que "cuánto
 * hace Fulano" quedaba respondido en dos filas que había que sumar a mano.
 * En el 710, donde Recruitment es buena parte de la producción real de
 * varias personas, esa suma manual era justo la que escondía el error de
 * reparto que esta etapa corrige (ver `loanOfficerRowsOf`,
 * `lib/outlook/strategyRows.ts`).
 *
 * Los números sigue siendo LOS MISMOS que sumaba `strategyRowsOf`: el reparto
 * del presupuesto POR ESTRATEGIA (Own Production, Recruitment) no cambió, lo
 * que cambia es que `loanOfficerRowsOf` los combina por persona DESPUÉS de
 * calculados, y reparte el mes en curso directo entre personas (por su propio
 * pronóstico individual, `lo.currentMonth`) en vez de heredar el reparto por
 * estrategia. No hay una segunda cuenta que pueda divergir: es la misma
 * fuente, reagrupada.
 *
 * ---------------------------------------------------------------------------
 * SE DECIDE ACÁ, NO SÓLO SE MIRA
 * ---------------------------------------------------------------------------
 * Cada fila de persona abre su editor (benchmark + regla de crecimiento) y
 * cada fila de realtor abre el suyo. Un Loan Officer que participa de
 * Recruitment tiene DOS controles de edición en su fila -- uno por
 * estrategia, porque el editor sigue guardando por estrategia, sin cambios.
 *
 * ⚠ Al guardar se RECARGA todo con `loadOutlookData`, no se parchea el estado
 * en memoria. Es más lento y es a propósito: lo que queda en la pantalla es
 * lo que la base devuelve, así que un guardado que no tuvo el efecto esperado
 * se ve acá y no en el próximo refresh de alguien más.
 *
 * ---------------------------------------------------------------------------
 * LOS DOCE MESES
 * ---------------------------------------------------------------------------
 * Las tres bandas (real · pronóstico · presupuesto) son las mismas que en la
 * vista 1 y se rotulan igual -- y ahora dicen explícitamente qué mes es cuál
 * en la cabecera de cada grupo (antes sólo lo decía el color de fondo).
 *
 * A diferencia de la versión OL7-OL25, el mes en curso de "Loan Officers —
 * existing" SÍ es un pronóstico (no sólo lo cerrado): cada persona tiene el
 * suyo, propio, y la fila total suma exacto por construcción (ver el reparto
 * en `loanOfficerRowsOf`).
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH_ABBR[Number(ym.split('-')[1]) - 1];

function bandOf(month: string, currentMonth: string): 'actual' | 'forecast' | 'budget' {
  return month < currentMonth ? 'actual' : month === currentMonth ? 'forecast' : 'budget';
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
  const { data, error, reload, horizonMonths } = useOutlookDataContext();
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
   * ⚠ EL HORIZONTE YA NO VIVE ACÁ — etapa OL22. Lo elige la barra del módulo y
   * viaja por el contexto: un horizonte distinto por branch no significa nada,
   * el presupuesto es de la división, y obligaba a repetir la selección trece
   * veces. Ver `OutlookTopBar` y `lib/outlook/horizon.ts`.
   */
  /*
   * ══════════════════════════════════════════════════════════════════
   * ⚠ EL EDITOR PUEDE VENIR PEDIDO POR LA URL — etapa RV4, re-cableada en
   * OL26b cuando "Set budget" pasó a ser UNA pantalla por persona (antes
   * era por estrategia -- ver el historial de este archivo antes de OL26b)
   * ══════════════════════════════════════════════════════════════════
   *
   *   ?rvOpen=budget&rvLo=24
   *
   * El modo revisión lleva a esta pantalla y necesita que el editor del
   * presupuesto esté abierto: Isabella llegó al lugar correcto y el paso no
   * decía qué hacer, y lo que había que revisar estaba detrás de un clic.
   *
   * ⚠ ESTA PANTALLA NO IMPORTA NADA DE LA REVISIÓN, y es la mitad que importa:
   * lee dos parámetros de su propia URL, como cualquier pantalla. La misma
   * dirección que la nota de `focus.ts` -- Outlook no tiene por qué saber que
   * existe un modo que lo enfoca, sólo contesta lo que le preguntan.
   *
   * ⚠ `rvOpen` YA NO ES UNA ESTRATEGIA. Antes validaba contra
   * `OUTLOOK_STRATEGIES` porque el editor era por estrategia (`StrategyEditor`,
   * uno por Own Production/B2B/NPPM/Recruitment/Affinity); ahora hay un único
   * editor por persona (`PersonBudgetEditor`, ver más abajo), así que lo único
   * que la URL necesita decir es "abrí el editor de presupuesto de esta
   * persona" -- de ahí el string fijo `'budget'` en vez de un nombre de
   * estrategia. `gate_config.open_editor` tiene que decir `'budget'` para esto
   * (antes decía `'Own Production'`) -- ver
   * `docs/sql/2026-09-review-open-editor-budget.sql`.
   *
   * `useState` con inicializador y no un efecto: el valor está disponible en el
   * primer render, así que copiarlo con un efecto sería un render de más -- y es
   * el error que ya costó dos veces en esta serie (el benchmark, los clics).
   */
  const searchParams = useSearchParams();
  /*
   * ⚠ Y QUÉ CERRÓ LA PERSONA. Sin esto, cerrar el editor que la URL pide lo
   * volvería a abrir en el render siguiente: el parámetro sigue ahí. Se guarda
   * la CLAVE de lo descartado (acá, el `employeeKey` -- ya no hace falta
   * componerla con la estrategia, porque el editor es uno solo por persona) y
   * no un booleano, así que si el paso siguiente pide otro editor, ese sí se
   * abre.
   */
  const [rvDescartado, setRvDescartado] = useState<number | null>(null);

  /*
   * Lo que la URL pide, validado. `null` si no pide nada o pide algo que no
   * existe: `rvOpen`/`rvLo` son texto de una barra de direcciones. Ya en la
   * forma de `PersonSubject`, para poder compararse y combinarse directo con
   * `editingBudget` más abajo.
   */
  const rvPedido: { kind: 'employee'; employeeKey: number } | null = (() => {
    const abre = searchParams.get('rvOpen');
    const dePersona = Number(searchParams.get('rvLo'));
    if (abre !== 'budget' || !Number.isInteger(dePersona) || dePersona <= 0) return null;
    return { kind: 'employee', employeeKey: dePersona };
  })();

  /*
   * ⚠ CON LA LÓGICA DE ARRIBA --de la rama de revisión-- Y LA FORMA NUEVA
   * DE `editingNppm`, que vino con el `realtor_code`. Los dos cambios son de
   * dominios distintos: uno decide QUÉ editor se abre, el otro CÓMO se
   * identifica a un realtor. Ninguno anula al otro.
   */
  /* La identidad es el codigo; `displayName` es lo unico que se muestra. */
  const [editingNppm, setEditingNppm] = useState<{
    realtorCode: string;
    displayName: string;
    ytd: number;
  } | null>(null);
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
  /*
   * ⚠ ARRIBA DE LOS CORTES, PORQUE ES UN HOOK. Lo había puesto al lado de
   * `personasDe`, que vive después de los tres `return` tempranos --sin datos,
   * cargando, branch inexistente-- así que en esas tres ramas no corría y el
   * orden de hooks cambiaba entre renders. Lo dijo `react-hooks/rules-of-hooks`.
   *
   * Lo que SÍ puede quedar abajo es todo lo derivado de esto: `focoKey`,
   * `focoNombre` y `avisoDelFoco` no son hooks, y el último necesita
   * `monthsOfYear`, que se calcula después de los cortes.
   */
  const { recorriendo } = useReview();
  /*
   * El presupuesto compuesto que se está editando -- punto 5 de OL26. Mismo
   * criterio que `editingRecruit`: se guarda el SUJETO (empleado o realtor),
   * no la fila, y se resuelve fresco de `branch` en cada render.
   */
  const [editingBudget, setEditingBudget] = useState<PersonSubject | null>(null);
  /*
   * ⚠ SE DERIVA, NO SE COPIA AL MONTAR -- mismo mecanismo que tenía
   * `editingActivo` en la versión por estrategia (ver la nota de `rvPedido`
   * más arriba), re-cableado sobre `editingBudget`/`PersonSubject` en vez de
   * `editing`/estrategia. Y el estado local le GANA a la URL: lo que la
   * persona abre a mano manda.
   */
  const editingBudgetActivo: PersonSubject | null =
    editingBudget ?? (rvPedido !== null && rvPedido.employeeKey !== rvDescartado ? rvPedido : null);

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
  /*
   * Las opciones y la lista de meses las deriva `lib/outlook/horizon.ts`, que es
   * el mismo modulo que usa la barra. Antes estaban acá, y con el selector
   * arriba habria dos derivaciones del mismo horizonte que pueden diferir.
   */
  const remainingMonths = remainingMonthsFor(currentMonth, horizonMonths);
  /*
   * ⚠ Sin `useMemo`, y no por descuido: esto vive DESPUÉS de los early returns
   * --`if (!data)`, `if (!branch)`-- así que un hook acá se saltearía en los
   * renders que salen antes y React rompe la pantalla entera. Medido: la tabla
   * no llegaba a dibujarse.
   */
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
   * LOS CUATRO GRUPOS — etapa OL26, ver el JSDoc de cabecera del archivo
   * ==========================================================================
   *
   * Own Production y Recruitment ya no se calculan acá: `loanOfficerRowsOf`
   * (`lib/outlook/strategyRows.ts`) hace el reparto por persona, reusando el
   * mismo presupuesto por estrategia que ya calculaba `strategyRowsOf`. NPPM y
   * Affinity siguen leyendo directo de `branch.byStrategy`, sin cambios en el
   * cálculo -- lo único nuevo es dónde vive el benchmark (columna propia) y,
   * en Affinity, que ya no se abre por Account Executive.
   */
  const bsNppm = branch.byStrategy.find((b) => b.strategy === 'NPPM');
  const { personRows, recruitRows } = loanOfficerRowsOf(data, branch, monthsOfYear, remainingMonths);

  /*
   * ══════════════════════════════════════════════════════════════════
   * EL FOCO DE LA REVISIÓN: UNA SOLA PERSONA A LA VISTA — etapa RV7
   * ══════════════════════════════════════════════════════════════════
   *
   * `recorriendo` y no «hay una sesión abierta»: es la distinción de RV5, y con
   * ella el foco SE APAGA SOLO al dar `Save and exit`, sin trabajo extra.
   *
   * `null` deja la app idéntica -- la nota de `focus.ts` lo dice: `null` no es
   * «mostrar a nadie». Es el peor error posible acá, que una pantalla de Outlook
   * se quede sin gente porque nadie arrancó una revisión.
   *
   * ⚠ Y EL FOCO NO ENTRA EN NINGÚN CÁLCULO. `personRows` sigue completa en la
   * suma del branch y en el reparto de `loanOfficerRowsOf` -- sólo se filtra acá,
   * al dibujar. La pregunta que lo gobierna es «esto es un número del branch, o
   * una fila de una persona?» -- y sólo las filas se enfocan.
   *
   * ⚠ RE-CABLEADO AL REBASAR SOBRE MAIN (OL26 → OL26f, contra RV7-RV13). RV7
   * enfocaba `personasDe(bs)` y `bs.owners`, las listas de la vista POR
   * ESTRATEGIA que esta etapa reemplaza por `personRows` (Own Production y
   * Recruitment combinados por persona). B2B y Affinity dejaron de abrirse por
   * dueño (OL26c: Affinity es una fila total, sin AE; B2B no tiene fila propia),
   * así que el foco por `bs.owners` ya no tiene superficie donde aplicarse -- se
   * pierde ese caso puntual del foco, y queda dicho acá en vez de haber
   * desaparecido sin que nadie lo viera. `personRows` es la única lista que
   * sigue enfocable, y es donde se aplica más abajo.
   */
  const focoKey = recorriendo?.session?.lo_employee_key ?? null;
  const focoNombre = recorriendo?.loName ?? null;

  /*
   * ⚠ ENFOCAR SIN DECIRLO ES PEOR QUE NO ENFOCAR.
   *
   * Quien mire va a ver una fila donde había ocho y no va a saber si el branch
   * se quedó sin gente o si la vista está filtrada. Dos casos, y son distintos:
   *
   *   · la persona ESTÁ y el resto se escondió  → cuántas, y por quién
   *   · la persona NO participa de la estrategia → eso, con esas palabras. Una
   *     tabla vacía se lee como un dato que falta, y acá el dato está: la
   *     estrategia tiene presupuesto y nada de él es suyo. Es una conversación
   *     válida de una revisión, así que la estrategia se muestra y se explica en
   *     vez de esconderse.
   *
   * Sin clases nuevas: `lbl` y `bp-muted` ya existen.
   *
   * ⚠ `colSpan` en `monthsOfYear.length + 4`, no `+3` -- esta etapa (OL26)
   * agregó la columna Benchmark a la tabla (lbl, bench, N meses, total,
   * rule); la vista por estrategia de la que viene este aviso no la tenía.
   * (Hubo también una columna Position, agregada y sacada de nuevo dentro de
   * la misma etapa -- ver OL26b -- así que el número final es +4 y no +5.)
   */
  const avisoDelFoco = (lista: readonly { employeeKey: number | null }[], s: string) => {
    if (focoKey === null) return null;
    const ausente = focusIsAbsent(lista, focoKey);
    const ocultos = hiddenCount(lista, focoKey);
    if (!ausente && ocultos === 0) return null;
    const quien = focoNombre ?? 'the coachee';
    return (
      <tr className="metric mrow" key={'s-' + s + '-foco'}>
        <td className="lbl bp-muted" colSpan={monthsOfYear.length + 4} style={{ paddingLeft: '30px' }}>
          {ausente
            ? `${quien} takes no part in ${s} \u2014 this budget is the branch's, and none of it is theirs.`
            : `${ocultos} more row${ocultos === 1 ? '' : 's'} hidden while coaching ${quien}.`}
        </td>
      </tr>
    );
  };

  /*
   * ==========================================================================
   * LAS FILAS DE ESTRATEGIA, CON SUS DOS REPARTOS — una sola implementacion
   * ==========================================================================
   * ⚠ EL FILTRO DE "QUIÉN SE MUESTRA" VA ACÁ, DESPUÉS DEL REPARTO — punto 6 del
   * brief, mismo principio que ya usaba AFFINITY con Own Production más arriba
   * en el historial de este archivo: `loanOfficerRowsOf` reparte el presupuesto
   * de Recruitment entre TODOS los reclutas, se muestren o no, porque un
   * recluta que aporta al total y queda fuera de los PESOS es exactamente el
   * modo de falla que el punto 7 pide vigilar. Filtrar antes del reparto haría
   * eso mismo con el filtro de visibilidad en vez de con un bug.
   *
   * Si un recluta oculto por este filtro tuviera una parte del presupuesto
   * --hoy no ocurre: `tentative` y `stale` no proyectan (`stageProjects` en
   * `recruitment.ts`), así que su peso ya es cero-- esa parte no se pierde: la
   * fila de reconciliación la absorbe, porque `strategiesByMonth` más abajo
   * suma sólo lo que efectivamente se muestra.
   */
  const visibleRecruitRows = recruitRows.filter((rr) => shouldShowRecruit(rr.recruit, data.today));

  /*
   * Los realtors de NPPM: mismo cálculo de siempre. Lo único que cambia es que
   * su benchmark ya no va pegado al nombre -- ver `BenchTag` en la fila, más
   * abajo -- que es justo el caso que el punto 2 del brief señala como el más
   * confuso hoy.
   */
  const nppmRows = (bsNppm?.realtors ?? []).map((r) => ({
    r,
    year: composeYear(monthsOfYear, currentMonth, r.actualByMonth, r.actualByMonth[currentMonth] ?? 0, {}),
  }));

  /*
   * ⚠ NPPM — IN HIRING: VACÍO HOY, Y A PROPÓSITO SIN EL REPARTO CONJUNTO DE
   * `loanOfficerRowsOf`. `outlook.recruitment_projection` está vacía por
   * completo, así que ningún recluta tiene `role === 'nppm'` todavía --el rol
   * cae siempre a `'loan_officer'` por default, ver `loadData.ts`--. El día que
   * aparezca el primero, su presupuesto va a necesitar el MISMO reparto
   * conjunto que ya tiene Recruitment (realtors + recluta en un solo
   * `apportionByWeight`, para no repetir el error que el punto 7 corrige), pero
   * construirlo y verificarlo hoy sería sobre cero casos reales. Mientras tanto
   * se muestra su valor EXACTO sin repartir, que es lo que ya hacía la pantalla
   * anterior con cualquier recluta.
   */
  const nppmRecruitsVisible = (bsNppm?.recruits ?? []).filter((r) => shouldShowRecruit(r, data.today));
  const nppmHiringRows = nppmRecruitsVisible.map((r) => ({
    r,
    year: composeYear(monthsOfYear, currentMonth, {}, null, r.byMonth),
  }));

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ AFFINITY: UNA SOLA FILA TOTAL, SIN ABRIR POR ACCOUNT EXECUTIVE — OL26
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Confirmado con Isabella: "affinity debería venir en una línea total sin
   * abrir por lo o ae". Reusa el `year` que ya calcula `strategyRowsOf` para
   * esta estrategia -- el reparto entre dueños sigue existiendo ADENTRO de esa
   * función, sólo que acá no se despliega fila por fila.
   *
   * ⚠ YA NO ES EDITABLE DESDE ACÁ. Antes cada Account Executive tenía su lápiz
   * en su propia fila; al no abrirse ya no hay dónde ponerlo. Es una pérdida
   * real de la simplificación pedida y queda dicho, no escondido: si hace falta
   * volver a editar el presupuesto de un AE, hoy no hay desde dónde en esta
   * pantalla.
   */
  const sRowsTodas = strategyRowsOf(data, branch, monthsOfYear, remainingMonths);
  const affinityRow = sRowsTodas.find((r) => r.strategy === 'Affinity');
  /* Mismo `bench` que calculaba la fila de estrategia vieja para Affinity. */
  const affinityBench = affinityRow
    ? affinityRow.bs.owners.reduce((a, o) => a + (o.isPerson && o.mode !== 'monthly' ? o.benchmarkAtDisplay : 0), 0)
    : null;

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ B2B YA NO TIENE FILA, Y NO LE HACE FALTA -- corregido en OL26c
   * ══════════════════════════════════════════════════════════════════════════
   *
   * EL MODELO ESTABA MAL PLANTEADO. B2B, NPPM, Affinity y Recruitment son
   * estrategias de ORIGEN -- quién trajo el negocio -- pero el CIERRE siempre
   * lo procesa un Loan Officer. Verificado: los 20 cierres de B2B del 747 este
   * año tienen loan_officer -- 15 de Gian Laino y Galo Rizzo, que YA tienen
   * fila en este branch como Own Production.
   *
   * Por eso `loanOfficerRowsOf` deja de sumar sólo Own Production + Recruitment
   * para lo YA CERRADO: suma las CUATRO estrategias que puede cerrar un Loan
   * Officer (Own Production, B2B, Recruitment, Affinity) -- todas menos NPPM,
   * que se abre como detalle del realtor pero no suma a nadie, para no contar
   * el mismo préstamo dos veces (una vez en la fila del realtor, otra en la
   * del Loan Officer que lo cerró).
   *
   * ⚠ ESO ES LO QUE CIERRA EL 747 SIN RESIDUO DE B2B. Antes B2B no tenía dónde
   * caer más que la reconciliación, que absorbía sus 20 cierres sin nombrarlos
   * -- el número de esa fila no coincidía con los 5 cierres reales de gente de
   * otro branch que el pie sí explica por nombre. Ahora los 15 de Gian y Galo
   * están en SUS filas, y sólo quedan los 5 genuinos: Nathan Martinez (2, roster
   * 716) y los no resueltos (Michael Tirio, Frank Rodriguez), que van donde
   * siempre fueron -- `outsiders` y `unattributed`.
   *
   * `sRowsTodas` sigue completo -- adentro, `strategyRowsOf` todavía necesita
   * el peso de B2B para repartir bien el presupuesto FUTURO entre todas las
   * estrategias. Lo que no pasa es que se RENDERICE una fila para B2B: su
   * presupuesto futuro (dos filas guardadas con `branch_code`, sin un Loan
   * Officer al que atribuírselo) sigue sin tener dónde vivir y cae en la
   * reconciliación -- pero sólo en los meses de presupuesto, nunca en los ya
   * cerrados.
   */

  /**
   * El total de un grupo, mes por mes: la suma de sus FILAS MOSTRADAS y nada
   * más -- mismo criterio que ya usaba `strategiesByMonth` por estrategia, acá
   * generalizado para sumar sobre CUALQUIER conjunto de filas (personas,
   * reclutas o realtors). Vacío sólo cuando NINGUNA fila del conjunto tiene
   * algo que mostrar ese mes.
   */
  function sumYears(years: YearRow[], m: string): number | null {
    const showing = years.filter((y) => y.byMonth[m] !== null);
    return showing.length === 0 ? null : showing.reduce((a, y) => a + (y.byMonth[m] ?? 0), 0);
  }

  const loExistingYears = personRows.map((p) => p.year);
  const loHiringYears = visibleRecruitRows.map((r) => r.year);
  const nppmExistingYears = nppmRows.map((x) => x.year);
  const nppmHiringYears = nppmHiringRows.map((x) => x.year);
  const allShownYears: YearRow[] = [
    ...loExistingYears,
    ...loHiringYears,
    ...nppmExistingYears,
    ...nppmHiringYears,
    ...(affinityRow ? [affinityRow.year] : []),
  ];

  /*
   * ⚠ EL TOTAL DEL BRANCH ES LA SUMA DE LO QUE SE MUESTRA. Nada más.
   *
   * No sale de `projectBranch` ni de sumar personas por otra vía: se suma lo
   * que la tabla efectivamente dibuja, fila por fila. Así el total no puede
   * discrepar de sus filas por construcción -- que es lo que el punto 7 del
   * brief pide para el branch entero, no sólo para cada Loan Officer.
   *
   * ⚠ CONSECUENCIA QUE HAY QUE SABER, la misma de siempre pero con un matiz
   * nuevo: el mes en curso de "Loan Officers — existing" SÍ es un pronóstico
   * ahora (ver el JSDoc de cabecera), pero NPPM y Affinity siguen mostrando lo
   * REAL cerrado ese mes, porque no tienen pronóstico propio. La lista de
   * branches muestra el PRONÓSTICO del branch entero; la fila de reconciliación
   * absorbe la diferencia, igual que antes.
   */
  const strategiesByMonth: Record<string, number | null> = {};
  for (const m of monthsOfYear) {
    strategiesByMonth[m] = sumYears(allShownYears, m);
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
            {/*
              ⚠ LA MISMA ETIQUETA QUE LA VISTA 1, y hace falta decirlo: en OL22
              la lista pasó a distinguir tres estados donde `isInactive` sólo
              contesta uno --dejó de producir, nunca tuvo gente propia, cola de
              espera-- y esta pantalla se quedó diciendo `Inactive` para los
              tres. Es exactamente el defecto de la etiqueta doble que OL22
              arregló en la otra dirección: la misma cosa nombrada de dos
              maneras en dos pantallas.
            */}
            {branch.isInactive && branch.ytd > 0 && (
              <span
                className="bp-muted ol-tag"
                title={
                  branch.branchCode === 'AFFINITY'
                    ? `Its ${branch.ytd} closings this year are real and count in the division total, but nobody ` +
                      `has this branch on their roster: its production is opened by the Account Executives who own ` +
                      `the opportunity, and they belong to other branches. That is why there is no Own Production ` +
                      `section here.`
                    : `No active producer on the roster has this branch. Its ${branch.ytd} closings this year are ` +
                      `real and count in the division total, but there is nobody to give a budget to — the ` +
                      `projection is charged to each person's roster branch, because it is one number per person, ` +
                      `not per loan. Who owns this budget is still to be decided.`
                }
              >
                {/*
                  ⚠ AFFINITY YA NO LLEVA NOTA — etapa OL25. Decia `opens by
                  account executive` y la tabla de abajo ya muestra a Shirley
                  Camargo y David Alvarez: la nota repetia lo que se ve. El
                  motivo completo sigue en el tooltip, que es donde se busca.
                */}
                {branch.branchCode === 'AFFINITY' ? '' : 'Inactive'}
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
        ⚠ LA BARRA, DEBAJO DEL ENCABEZADO — etapa OL25. Ver la nota del layout:
        vivia arriba del titulo y con su propia columna, 110px corrida respecto
        del breadcrumb. Aca hereda la columna del contenido.
      */}
      <OutlookTopBar />

      {/*
        ══════════════════════ UNA SOLA TABLA — etapa OL26 ═════════════════════
        Se abre por TIPO DE PERSONA, no por estrategia -- ver el JSDoc de
        cabecera del archivo:

          Loan Officers — existing    Own Production + Recruitment combinados
          NPPM — existing              los realtors del branch
          Loan Officers — in hiring    reclutas role='loan_officer'
          NPPM — in hiring              reclutas role='nppm' (vacío hoy)

        Más Affinity (fila total, sin abrir) y la reconciliación de siempre.
        B2B ya no tiene fila -- ver el JSDoc de cabecera, "por qué por persona".
      */}
      <div className="ol-block__head">
        <h2 className="ol-block__title">Budget</h2>
        {/*
          ⚠ ACA ESTABA `Project through` Y SE FUE A LA BARRA DEL MODULO — OL22.
          Elegirlo en el 747 no cambiaba nada en el 733, asi que habia que
          repetir la seleccion trece veces para mirar la division con el mismo
          horizonte. Ahora es uno solo y aplica a todas.
        */}
      </div>

      <div className="tbl-scroll">
        <table className="piv bp-table--los ol-year">
          <thead>
            {/*
              ⚠ TRES BANDAS, NO DOS — etapa OL26. Hasta OL25 esta tabla no
              abría el mes en curso por estrategia, así que "Actual — closed"
              llegaba hasta ese mes inclusive y no hacía falta una banda de
              Forecast. Ahora "Loan Officers — existing" SÍ tiene un
              pronóstico real para ese mes (repartido en `loanOfficerRowsOf`),
              así que la tabla necesita las mismas tres bandas que la vista 1
              -- y el rótulo dice explícitamente qué mes es (punto 3 del
              brief: "hoy no se distingue cuál es el mes de forecast y cuáles
              son presupuesto").

              ⚠ NPPM Y AFFINITY NO TIENEN PRONÓSTICO PROPIO del mes en curso
              -- sólo Loan Officers. Sus celdas en la columna de Forecast
              siguen mostrando lo REAL cerrado (como toda la tabla hacía antes
              de esta etapa), con un tooltip que lo aclara: la banda nombra lo
              que es cierto para la mayoría de las filas, la excepción vive en
              el tooltip de su propia celda, mismo patrón que ya usaba esta
              pantalla en todos lados.
            */}
            <tr className="yr-row">
              <th className="lbl"></th>
              <th className="bp-center ol-bench"></th>
              <th className="bp-center ol-band ol-band--actual" colSpan={actualMonths.length}>
                Actual — closed
              </th>
              <th className="bp-center ol-band ol-band--forecast" colSpan={1}>
                Forecast ({monthLabel(currentMonth)})
              </th>
              {remainingMonths.length > 0 && (
                <th className="bp-center ol-band ol-band--budget" colSpan={remainingMonths.length}>
                  Budget ({monthLabel(remainingMonths[0])}
                  {remainingMonths.length > 1 ? '–' + monthLabel(remainingMonths[remainingMonths.length - 1]) : ''})
                </th>
              )}
              <th className="bp-center"></th>
              {/* "Decision" se va -- esto es la regla de CRECIMIENTO, que diga eso. */}
              <th className="bp-center ol-band ol-band--decide" colSpan={1}>
                Growth rule
              </th>
            </tr>
            <tr className="mo-row">
              <th className="lbl">Name</th>
              <th className="bp-center ol-bench">Benchmark</th>
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
            {/*
              ══════════════════════════════════════════════════════════════
              GRUPO 1 — LOAN OFFICERS — EXISTING
              ══════════════════════════════════════════════════════════════
              Own Production + Recruitment combinados por persona. Ver
              `loanOfficerRowsOf` y el JSDoc de cabecera del archivo.
            */}
            {personRows.length > 0 &&
              (() => {
                const key = 'g:lo-existing';
                const abierta = open.has(key);
                /*
                 * ⚠ `employeeKey` AL TOPE, PARA EL FOCO — re-cableado al
                 * rebasar sobre main. `focusIndexed`/`avisoDelFoco` (RV7)
                 * piden `{ employeeKey }` en el objeto mismo, y
                 * `PersonBudgetRow` sólo la tiene anidada en `.lo`. Se
                 * completa acá, una vez, para las dos llamadas de abajo -- no
                 * en `focus.ts` (rama ajena) ni en `PersonBudgetRow` (usado
                 * por media pantalla).
                 */
                const focoRows = personRows.map((pr) => ({ ...pr, employeeKey: pr.lo.employeeKey }));
                return (
                <Fragment key={key}>
                  <tr className="grp d1 togg" onClick={() => toggle(key)}>
                    <td className="lbl">
                      <span className={'chev' + (abierta ? ' open' : '')} aria-hidden="true">
                        ›
                      </span>
                      Loan Officers — existing
                    </td>
                    <td className="bp-center ol-bench"></td>
                    {monthsOfYear.map((m) => (
                      <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                        {fmt(sumYears(loExistingYears, m))}
                      </td>
                    ))}
                    <td className="bp-center totcol">
                      {fmt(sumOfShown(monthsOfYear.map((m) => sumYears(loExistingYears, m))))}
                    </td>
                    <td className="ol-rulecol bp-muted">
                      {branch.loanOfficers.length} loan officer{branch.loanOfficers.length === 1 ? '' : 's'}
                    </td>
                  </tr>

                  {abierta &&
                    /*
                     * ⚠ EL FOCO SE APLICA ACÁ, SOBRE `personRows` COMPLETA --
                     * re-cableado al rebasar sobre main (ver la nota de
                     * `focoKey` más arriba). Filtrar antes de este punto
                     * mostraría el presupuesto de otra persona en la fila de
                     * quien quedó, porque `personRows` ya viene con el reparto
                     * hecho por posición -- exactamente el motivo por el que
                     * RV7 aplicaba el foco después del reparto y no antes.
                     */
                    focusIndexed(focoRows, focoKey).map(({ item: pr }) => {
                      const isMonthly = (pr.lo.modeByStrategy['Own Production'] ?? 'growth') === 'monthly';
                      const ownBenchmark = pr.lo.strategyBenchmarks['Own Production'] ?? 0;
                      return (
                        <tr key={'lo-' + pr.lo.employeeKey} className="metric mrow">
                          <td className="lbl">
                            {pr.lo.fullName}
                            {pr.lo.position && <span className="bp-muted ol-tag">{pr.lo.position}</span>}
                            {STATE_TAG[pr.lo.rosterState] && (
                              <span className="bp-muted ol-tag">{STATE_TAG[pr.lo.rosterState].text}</span>
                            )}
                            {!pr.lo.hasIdentity && <span className="bp-muted ol-tag">no internal identity</span>}
                          </td>
                          <td className="bp-center ol-bench">
                            <BenchTag
                              value={isMonthly ? null : ownBenchmark}
                              onEdit={() => setEditingBudget({ kind: 'employee', employeeKey: pr.lo.employeeKey })}
                              editLabel={`Edit ${pr.lo.fullName}'s benchmark and rule in Own Production`}
                            />
                          </td>
                          {monthsOfYear.map((m) => (
                            <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                              {fmt(pr.year.byMonth[m] ?? null)}
                            </td>
                          ))}
                          <td className="bp-center totcol">
                            {fmt(sumOfShown(monthsOfYear.map((m) => pr.year.byMonth[m] ?? null)))}
                          </td>
                          {/*
                            ⚠ UN SOLO BOTÓN — etapa OL26. Abre `PersonBudgetEditor`,
                            que trae adentro el selector de Own Production /
                            Recruitment (si participa) / Budget composition. Antes
                            había hasta tres controles acá; el mismo rótulo en
                            todos lados evita que uno diga "25% / qtr" y otro
                            "by month" para la misma acción.
                          */}
                          <td className="ol-rulecol" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className={
                                'ol-pill' +
                                ((pr.lo.rulesByStrategy['Own Production'] ?? []).length ||
                                isMonthly ||
                                pr.lo.budgetTotalRevision > 0
                                  ? ''
                                  : ' ol-pill--empty')
                              }
                              onClick={() => setEditingBudget({ kind: 'employee', employeeKey: pr.lo.employeeKey })}
                            >
                              Set budget
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                  {/*
                    Y si la vista está enfocada, la fila que lo dice -- misma
                    `avisoDelFoco` de RV7, re-cableada sobre `personRows`. Ver
                    la nota de `focoKey` más arriba: Own Production es la
                    pertenencia por defecto, así que la rama "ausente" de
                    `avisoDelFoco` no debería dispararse nunca para este grupo
                    -- todo Loan Officer del branch tiene fila acá.
                  */}
                  {abierta && avisoDelFoco(focoRows, 'Own Production')}
                </Fragment>
              );
            })()}

            {/*
              ══════════════════════════════════════════════════════════════
              GRUPO 2 — NPPM — EXISTING
              ══════════════════════════════════════════════════════════════
              Los realtors del branch. Mismo cálculo de siempre -- ver
              `nppmRows` más arriba --, sólo cambia dónde vive el benchmark.
            */}
            {nppmRows.length > 0 &&
              (() => {
                const key = 'g:nppm-existing';
                const abierta = open.has(key);
                return (
                <Fragment key={key}>
                  <tr className="grp d1 togg" onClick={() => toggle(key)}>
                    <td className="lbl">
                      <span className={'chev' + (abierta ? ' open' : '')} aria-hidden="true">
                        ›
                      </span>
                      NPPM — existing
                    </td>
                    <td className="bp-center ol-bench"></td>
                    {monthsOfYear.map((m) => (
                      <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                        {fmt(sumYears(nppmExistingYears, m))}
                      </td>
                    ))}
                    <td className="bp-center totcol">
                      {fmt(sumOfShown(monthsOfYear.map((m) => sumYears(nppmExistingYears, m))))}
                    </td>
                    <td className="ol-rulecol bp-muted">
                      {nppmRows.length} realtor{nppmRows.length === 1 ? '' : 's'}
                    </td>
                  </tr>

                  {abierta &&
                    nppmRows.map(({ r, year: rYear }) => (
                      <tr key={'nppm-' + r.realtorCode} className="metric mrow">
                        <td className="lbl">{r.displayName}</td>
                        <td className="bp-center ol-bench">
                          {/*
                            ⚠ Dos decimales: el promedio de 3 meses de un realtor
                            es casi siempre fraccionario --0,33 · 0,67 · 1,33-- y
                            con uno se pierde de dónde sale el número. Por eso el
                            valor va formateado acá y no por `fmt`.
                          */}
                          <BenchTag
                            value={r.benchmark}
                            onEdit={() => setEditingNppm({ realtorCode: r.realtorCode, displayName: r.displayName, ytd: r.ytd })}
                            editLabel={`Edit ${r.displayName}'s benchmark`}
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
                        <td className="ol-rulecol">
                          <button
                            type="button"
                            className={'ol-pill' + (r.benchmarkIsDefault ? ' ol-pill--empty' : '')}
                            onClick={() => setEditingNppm({ realtorCode: r.realtorCode, displayName: r.displayName, ytd: r.ytd })}
                            title={
                              r.benchmarkIsDefault
                                ? `Nobody has set it, so what applies is the average of their closings over the 3 ` +
                                  `closed months: ${r.avg3m.toFixed(2)}. One number per realtor, across every branch.`
                                : `Set by hand. Their 3-month average is ${r.avg3m.toFixed(2)}.`
                            }
                          >
                            {r.benchmarkIsDefault ? '3-mo avg' : 'by hand'}
                          </button>
                          <button
                            type="button"
                            className={'ol-pill' + (r.budgetTotalRevision > 0 ? '' : ' ol-pill--empty')}
                            onClick={() => setEditingBudget({ kind: 'realtor', realtorCode: r.realtorCode })}
                            title={
                              r.budgetTotalRevision > 0
                                ? 'This realtor has a composed budget set (a fixed total, with an informational breakdown by plan). Click to review or edit it.'
                                : 'No composed budget set yet for this realtor. Click to set one -- informational, separate from the projection above.'
                            }
                          >
                            Set budget
                          </button>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })()}

            {/*
              ══════════════════════════════════════════════════════════════
              GRUPO 3 — LOAN OFFICERS — IN HIRING
              ══════════════════════════════════════════════════════════════
              Reclutas `role: 'loan_officer'` que pasan `shouldShowRecruit` --
              punto 6 del brief. Su presupuesto ya viene repartido en conjunto
              con las personas de Recruitment (ver `loanOfficerRowsOf`).
            */}
            {visibleRecruitRows.length > 0 &&
              (() => {
                const key = 'g:lo-hiring';
                const abierta = open.has(key);
                return (
                <Fragment key={key}>
                  <tr className="grp d1 togg" onClick={() => toggle(key)}>
                    <td className="lbl">
                      <span className={'chev' + (abierta ? ' open' : '')} aria-hidden="true">
                        ›
                      </span>
                      Loan Officers — in hiring
                    </td>
                    <td className="bp-center ol-bench"></td>
                    {monthsOfYear.map((m) => (
                      <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                        {fmt(sumYears(loHiringYears, m))}
                      </td>
                    ))}
                    <td className="bp-center totcol">
                      {fmt(sumOfShown(monthsOfYear.map((m) => sumYears(loHiringYears, m))))}
                    </td>
                    <td className="ol-rulecol bp-muted">{visibleRecruitRows.length} in hiring</td>
                  </tr>

                  {abierta &&
                    visibleRecruitRows.map(({ recruit: r, year: rrYear }) => (
                      <tr key={'lo-hiring-' + r.identity} className="metric mrow ol-rec">
                        <td className="lbl">
                          {r.personName}
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
                        </td>
                            <td className="bp-center ol-bench">
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
                                : 'Not on the roster this month, so there is nothing to report — empty, not zero.'
                            }
                          >
                            {m > currentMonth && !r.notProjecting ? fmt(rrYear.byMonth[m] ?? null) : ''}
                          </td>
                        ))}
                        <td className="bp-center totcol">
                          {fmt(sumOfShown(monthsOfYear.map((m) => rrYear.byMonth[m] ?? null)))}
                        </td>
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
                    ))}
                </Fragment>
              );
            })()}

            {/*
              ══════════════════════════════════════════════════════════════
              GRUPO 4 — NPPM — IN HIRING
              ══════════════════════════════════════════════════════════════
              Reclutas `role: 'nppm'` -- vacío hoy, ver la nota de
              `nppmHiringRows` más arriba: sin reparto conjunto todavía porque
              no hay ni un caso real contra el cual construirlo y verificarlo.
            */}
            {nppmHiringRows.length > 0 &&
              (() => {
                const key = 'g:nppm-hiring';
                const abierta = open.has(key);
                return (
                <Fragment key={key}>
                  <tr className="grp d1 togg" onClick={() => toggle(key)}>
                    <td className="lbl">
                      <span className={'chev' + (abierta ? ' open' : '')} aria-hidden="true">
                        ›
                      </span>
                      NPPM — in hiring
                    </td>
                    <td className="bp-center ol-bench"></td>
                    {monthsOfYear.map((m) => (
                      <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                        {fmt(sumYears(nppmHiringYears, m))}
                      </td>
                    ))}
                    <td className="bp-center totcol">
                      {fmt(sumOfShown(monthsOfYear.map((m) => sumYears(nppmHiringYears, m))))}
                    </td>
                    <td className="ol-rulecol bp-muted">{nppmHiringRows.length} in hiring</td>
                  </tr>

                  {abierta &&
                    nppmHiringRows.map(({ r, year: rrYear }) => (
                      <tr key={'nppm-hiring-' + r.identity} className="metric mrow ol-rec">
                        <td className="lbl">
                          {r.personName}
                          <span className="bp-muted ol-tag" title={RECRUIT_TITLE[r.stage](r)}>
                            {STAGE_LABEL[r.stage]}
                          </span>
                        </td>
                            <td className="bp-center ol-bench">
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
                                : 'Not on the roster this month, so there is nothing to report — empty, not zero.'
                            }
                          >
                            {m > currentMonth && !r.notProjecting ? fmt(rrYear.byMonth[m] ?? null) : ''}
                          </td>
                        ))}
                        <td className="bp-center totcol">
                          {fmt(sumOfShown(monthsOfYear.map((m) => rrYear.byMonth[m] ?? null)))}
                        </td>
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
                    ))}
                </Fragment>
              );
            })()}

            {/*
              ══════════════════════════════════════════════════════════════
              AFFINITY — una sola fila total, sin abrir por Account Executive
              ══════════════════════════════════════════════════════════════
            */}
            {affinityRow && (
              <tr className="metric mrow">
                <td className="lbl">
                  <span className="chev chev--none" aria-hidden="true" />
                  Affinity
                  <span className="bp-muted ol-tag">total only</span>
                </td>
                <td className="bp-center ol-bench">
                  <BenchTag value={affinityBench} />
                </td>
                {monthsOfYear.map((m) => (
                  <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                    {fmt(affinityRow.year.byMonth[m] ?? null)}
                  </td>
                ))}
                <td className="bp-center totcol">
                  {fmt(sumOfShown(monthsOfYear.map((m) => affinityRow.year.byMonth[m] ?? null)))}
                </td>
                <td className="ol-rulecol bp-muted">not editable here</td>
              </tr>
            )}

            {/*
              LO QUE NINGÚN GRUPO RECLAMA. Ver `residual` arriba: es un residuo
              puro, así que el total sigue siendo la suma de las filas. No se
              muestra cuando no hay nada que reconciliar.
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
                    : /*
                       * ⚠ B2B YA NO CAE ACÁ -- etapa OL26c. Hasta esta corrección,
                       * este residuo absorbía toda la producción de B2B --el 747
                       * cerró 20 este año-- porque esa estrategia no tenía fila
                       * propia ni tampoco caía en la de nadie más. Ahora cada
                       * cierre suma en la fila del Loan Officer que lo cerró, sea
                       * cual sea su estrategia (ver `loanOfficerRowsOf`), así que
                       * lo único que puede quedar acá es lo mismo de siempre:
                       * cierres de gente que no está en el roster de este branch.
                       */
                      'LO out of branch'}
                  <span
                    className="bp-muted ol-tag"
                    title={
                      Math.abs(residual[currentMonth]) <= 0.001
                        ? `The branch total counts by LOAN --whatever closed here-- and the strategies open by ` +
                          `the people on this branch's roster. Closings by loan officers who are not on it land ` +
                          `in this row: they are real and they count in the total, but no strategy can claim ` +
                          `them. The row carries the difference so the total matches the list.`
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
                <td className="bp-center ol-bench"></td>
                {monthsOfYear.map((m) => (
                  <td
                    key={m}
                    className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                    title={
                      Math.abs(residual[m]) <= 0.001
                        ? undefined
                        : m === currentMonth
                          ? `The branch list shows ${fmt(branchYear.byMonth[m])} for ${monthLabel(m)} and the groups ` +
                            `shown above add up to ${fmt(strategiesByMonth[m])}. This is the difference.`
                          : `${monthLabel(m)} differs from the branch list by ${fmt(residual[m])}: a closing by a ` +
                            `loan officer who is not on this branch's roster.`
                    }
                  >
                    {Math.abs(residual[m]) <= 0.001 ? '' : fmt(residual[m])}
                  </td>
                ))}
                <td className="bp-center totcol">{fmt(sumOfShown(monthsOfYear.map((m) => (Math.abs(residual[m]) <= 0.001 ? null : residual[m]))))}</td>
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
              <td className="bp-center ol-bench"></td>
              {monthsOfYear.map((m) => (
                <td
                  key={m}
                  className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}
                  title={
                    m === currentMonth
                      ? `The month's forecast, same as in the branch list. The groups shown above add up to ` +
                        `${fmt(strategiesByMonth[m])} — what actually closed — and the row above carries the rest.`
                      : undefined
                  }
                >
                  {fmt(totalByMonth[m])}
                </td>
              ))}
              <td className="bp-center totcol" title="The sum of the rows shown above, column by column.">
                {fmt(sumOfShown(monthsOfYear.map((m) => totalByMonth[m])))}
              </td>
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
              ramp={data.recruitRamp}
              recruitCount={data.diagnostics.recruitsRead}
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
          realtorCode={editingNppm.realtorCode}
          displayName={editingNppm.displayName}
          ytd={editingNppm.ytd}
          data={data}
          onClose={() => setEditingNppm(null)}
          onSaved={reload}
        />
      )}

      {/*
        El presupuesto compuesto -- punto 5 de OL26. Mismo criterio que los
        demás editores: se resuelve la fila FRESCA de `branch` en cada render,
        nunca desde un objeto guardado en el estado (ver la nota de
        `editingBudget` más arriba).

        ⚠ `editingBudgetActivo`, NO `editingBudget` -- re-cableado al rebasar
        sobre main. Es lo que abre el editor, ya sea porque la persona hizo
        clic o porque la URL de la revisión lo pidió (`rvOpen=budget`, ver la
        nota de `rvPedido` más arriba); `editingBudget` sigue siendo sólo lo
        que la persona abrió A MANO, para que `onClose` sepa si tiene que
        cerrar un estado propio o descartar lo que pedía la URL.
      */}
      {editingBudgetActivo &&
        (() => {
          /*
           * ⚠ CERRAR TIENE DOS CASOS -- mismo mecanismo que tenía
           * `StrategyEditor` con `rvClave`, ahora sobre el `employeeKey` a
           * secas (no hace falta componerlo con una estrategia: el editor es
           * uno solo por persona). Si `editingBudget` estaba puesto, lo abrió
           * la persona y hay que limpiarlo; si no, lo que se ve viene de la
           * URL y hay que DESCARTARLO -- si no, el parámetro lo reabre en el
           * render siguiente.
           */
          const cerrar = () => {
            if (editingBudget !== null) setEditingBudget(null);
            else if (rvPedido !== null) setRvDescartado(rvPedido.employeeKey);
          };
          if (editingBudgetActivo.kind === 'employee') {
            const lo = branch.loanOfficers.find((x) => x.employeeKey === editingBudgetActivo.employeeKey);
            if (!lo) return null;
            /*
             * ⚠ `recruitment` SÓLO PARA QUIEN PARTICIPA -- etapa OL26e. Ver
             * `docs/sql/2026-09-outlook-budget-recruitment-bucket.sql`. Mismo
             * criterio que ya usa `loanOfficerRowsOf` para la píldora
             * "Rec": sin producción ni presupuesto propio en Recruitment, el
             * bucket no tiene nada que explicar.
             */
            const pr = personRows.find((x) => x.lo.employeeKey === lo.employeeKey);
            const person: BudgetEditable = {
              subject: { kind: 'employee', employeeKey: lo.employeeKey },
              label: lo.fullName,
              buckets: pr?.participatesInRecruitment
                ? ['own_production', 'b2b', 'nppm', 'recruitment', 'business_plan']
                : ['own_production', 'b2b', 'nppm', 'business_plan'],
              budgetTotal: lo.budgetTotal,
              budgetTotalRevision: lo.budgetTotalRevision,
              budgetBreakdown: lo.budgetBreakdown,
              budgetBreakdownRevision: lo.budgetBreakdownRevision,
            };
            /*
             * ⚠ SÓLO LO QUE HACE FALTA PARA LA CALCULADORA -- etapa OL26d. Ya
             * no se arma un `OutlookEditable` completo (eso guardaba en
             * `outlook.growth_rule`, que esta pantalla dejó de escribir): sólo
             * el benchmark y la última regla, para prellenar "apply a rate".
             */
            const ownProductionRate: OwnProductionRate = {
              savedSchedule: lo.benchmarkSchedules['Own Production'] ?? [],
              savedSegments: lo.rulesByStrategy['Own Production'] ?? [],
            };
            return (
              <PersonBudgetEditor
                person={person}
                ownProductionRate={ownProductionRate}
                data={data}
                months={remainingMonths}
                onClose={cerrar}
                onSaved={reload}
              />
            );
          }

          /* Por código, no por nombre normalizado -- ver la nota de `PersonSubject` en save.ts. */
          const r = bsNppm?.realtors.find((x) => x.realtorCode === editingBudgetActivo.realtorCode);
          if (!r) return null;
          const person: BudgetEditable = {
            subject: { kind: 'realtor', realtorCode: r.realtorCode },
            label: r.displayName,
            buckets: ['own_production', 'business_plan'],
            budgetTotal: r.budgetTotal,
            budgetTotalRevision: r.budgetTotalRevision,
            budgetBreakdown: r.budgetBreakdown,
            budgetBreakdownRevision: r.budgetBreakdownRevision,
          };
          return (
            <PersonBudgetEditor
              person={person}
              ownProductionRate={null}
              data={data}
              months={remainingMonths}
              onClose={cerrar}
              onSaved={reload}
            />
          );
        })()}

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
