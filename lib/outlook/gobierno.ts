/**
 * ============================================================================
 * QUÉ FILA DE `outlook.budget_total` GOBIERNA — etapa OL41
 * ============================================================================
 *
 * Una sola definición, importada por todos los que la necesitan. Hasta OL40
 * había TRES copias del mismo criterio, en tres archivos:
 *
 *   · `lib/outlook/loadData.ts`        — la tabla del branch
 *   · `lib/business-plan/loadData.ts`  — el perfil del Loan Officer (BP49b)
 *   · `lib/outlook/save.ts`            — el arrastre de OL38
 *
 * Las tres decían lo mismo y por eso nadie las notaba. El comentario de
 * `loadData.ts` ya avisaba que eran dos y que separarlas era cuestión de que
 * alguien cambiara una: esta etapa cambia el criterio, así que separarlas era
 * cuestión de hoy.
 *
 * ---------------------------------------------------------------------------
 * LAS TRES CLASES DE FILA, Y POR QUÉ SON TRES
 * ---------------------------------------------------------------------------
 *
 *   NÚMERO       `total` con valor. «El presupuesto de este mes es éste.»
 *   CONFIRMACIÓN `confirmed_only`, sin número — RV15. «Miré esto y está bien
 *                como está»: deja rastro de que alguien lo revisó y NO toca el
 *                gobierno. Por eso se descarta al elegir la revisión vigente:
 *                si contara, confirmar le quitaría el presupuesto a alguien
 *                por haber apretado un botón que dice «lo revisé».
 *   LIBERACIÓN   `released_to_rule`, sin número — OL41. «Este mes vuelve a la
 *                regla de crecimiento.» SÍ gobierna --es una decisión sobre el
 *                número, no sobre haberlo mirado-- y lo que decide es que no
 *                haya número.
 *
 * ⚠ LA TERCERA EXISTE PORQUE FALTABA EL ACTO. Soltar un mes sólo se podía
 * haciendo que una revisión nueva lo OMITIERA --un efecto secundario de borrar
 * celdas-- y soltarlos todos no se podía en absoluto: una revisión necesita al
 * menos una fila. Galo Rizzo confirmó cuatro veces en tres minutos buscando
 * este acto; lo que apretaba dejaba cuatro filas y no soltaba nada.
 *
 * ⚠ Y UNA LIBERACIÓN NO ES UN CERO. Cero es «este mes espero cero préstamos»,
 * una decisión con número. Liberar es «no decido yo, decide la regla». Darles
 * el mismo valor es el error que este módulo entero viene evitando desde el
 * primer día -- un cero es una decisión, vacío es que nadie decidió.
 *
 * Sin imports a propósito: así su prueba la carga directo con Node, sin el
 * cliente de Supabase ni el alias `@/lib` (igual que `ventana.ts`).
 */

/**
 * ============================================================================
 * EL PRESUPUESTO DE UNA PERSONA EN UN MES — etapa OL48
 * ============================================================================
 *
 * Tres gobiernos y un piso que los atraviesa:
 *
 *   total fijado         manda, salvo que sus realtors pidan más
 *   soltado a la regla   la regla, salvo que sus realtors pidan más
 *   sin nada             la regla, salvo que sus realtors pidan más
 *
 * ⚠ POR QUÉ EL PISO NO ES UN CUARTO GOBERNANTE. Un realtor NPPM no cierra: el
 * préstamo lo cierra su Loan Officer. Así que lo que el realtor proyecta pasa
 * NECESARIAMENTE por él, y un total menor que la suma de sus realtors afirma
 * algo imposible -- que va a cerrar menos de lo que ya viene por su propio
 * canal. No es una preferencia entre dos números: es que uno de los dos no
 * puede ser cierto.
 *
 * ⚠ Y POR ESO SE VE. El piso se mueve cuando cambia el promedio de cierres del
 * realtor --su benchmark sale de ahí-- así que el total de la persona puede
 * moverse sin que nadie lo decida. Eso es aceptable porque no es un presupuesto
 * que alguien fijó sino un piso que impone el dato, y la fila lo dice con
 * `raised by NPPM`: quien lo lea tiene que saber que ese número no es suyo.
 *
 * Vive acá, con `gobierna`, porque es la misma pregunta --quién decide el
 * número-- y porque lo leen DOS lugares que tienen que coincidir: `projectBranch`
 * (el total del branch y la lista) y `loanOfficerRowsOf` (la fila de la
 * persona). Dos copias de esto es exactamente lo que OL41 vino a desarmar.
 */
/**
 * Lo que aportan los realtors NPPM de una persona en un mes.
 *
 * ⚠ VIVE ACÁ PORQUE SON TRES LUGARES Y UNA SOLA DECISIÓN. La suma estaba
 * escrita tres veces --`projectBranch`, `loanOfficerRowsOf` y la composición de
 * la pantalla-- y las tres contestan lo mismo: cuánto de lo que se espera de
 * esta persona ya viene por sus realtors. Dos de ellas la usan como PISO y la
 * tercera la RESTA para no contarla dos veces, así que si una cambiara de
 * criterio --dejar de contar un realtor sin dueño, decir-- las otras dos
 * seguirían con el viejo y el invariante de OL39 se rompería sin que nada
 * avise. El disparador para extraer no es el tercer llamador: es el primer
 * cambio.
 *
 * El parámetro es la forma mínima y no `OutlookLoanOfficer`, para que este
 * archivo siga sin imports y su prueba lo cargue directo con Node.
 */
export function pisoDeRealtors(
  realtors: readonly { byMonth: Record<string, number> }[],
  mes: string
): number {
  return realtors.reduce((a, r) => a + (r.byMonth[mes] ?? 0), 0);
}

export function presupuestoDePersona(input: {
  /** El total fijado para ese mes, si lo hay. */
  fijado: number | undefined;
  /** Lo que proyecta su regla de crecimiento (own + recruitment). */
  regla: number;
  /** La suma de lo que proyectan o tienen fijado sus realtors NPPM ese mes. */
  pisoDeRealtors: number;
}): { valor: number; subioPorRealtors: boolean } {
  const decidido = input.fijado ?? input.regla;
  if (input.pisoDeRealtors > decidido) {
    return { valor: input.pisoDeRealtors, subioPorRealtors: true };
  }
  return { valor: decidido, subioPorRealtors: false };
}

/** Lo mínimo que una fila de `budget_total` necesita para que se la juzgue. */
export interface FilaDeTotal {
  revision: number;
  target_month: string;
  /* `string` porque un `numeric` de Postgres llega como texto por PostgREST, y
     el tipo de la fila en `loadData.ts` lo dice. Acá se convierte una sola vez,
     con `Number`, y nunca se compara contra `0` sin convertir. */
  total: number | string | null;
  confirmed_only?: boolean | null;
  /**
   * ⚠ OPCIONAL A PROPÓSITO: la columna la agrega
   * `docs/sql/2026-09-budget-soltar-a-la-regla.sql`, y hasta que se aplique
   * PostgREST no la devuelve. Sin la columna, `undefined !== true` y todo se
   * comporta como antes de esta etapa.
   */
  released_to_rule?: boolean | null;
}

/** ¿Esta fila decide sobre el número del mes? */
export function gobierna(t: FilaDeTotal): boolean {
  if (esConfirmacion(t)) return false;
  return t.total !== null || t.released_to_rule === true;
}

/**
 * «Alguien miró esto y lo aceptó» — RV15. Es otra pregunta que `gobierna`, y
 * por eso tiene nombre propio: el pie del editor muestra la última
 * confirmación, que justamente NO es una revisión vigente de nada.
 *
 * ⚠ Y ESTÁ ACÁ para que `confirmed_only` no se compare suelto en ningún otro
 * archivo. Las dos preguntas se escriben igual --`=== true` sobre la misma
 * columna-- y son distintas; tenerlas juntas es lo que impide que alguien
 * conteste una creyendo que contesta la otra. Lo verifica
 * `scripts/verificacion/gobierno-del-total.test.mjs`.
 */
export function esConfirmacion(t: FilaDeTotal): boolean {
  return t.confirmed_only === true;
}

/** «Este mes vuelve a la regla» — OL41. */
export function esLiberacion(t: FilaDeTotal): boolean {
  return t.confirmed_only !== true && t.released_to_rule === true;
}

/** La revisión que manda para un sujeto, o 0 si nadie fijó ni soltó nada. */
export function revisionQueGobierna(filas: FilaDeTotal[]): number {
  let max = 0;
  for (const t of filas) if (gobierna(t) && t.revision > max) max = t.revision;
  return max;
}

/**
 * Lo que la revisión vigente dice, mes a mes.
 *
 * `byMonth` sólo trae los meses CON número: un mes liberado no está, así que
 * el `?? regla` de quien lee cae solo -- que es exactamente lo que significa.
 * `soltados` los nombra igual, porque «no está» y «se soltó» no son lo mismo
 * para quien quiera explicarlo en pantalla.
 */
export function totalesVigentes(filas: FilaDeTotal[]): {
  revision: number;
  byMonth: Record<string, number>;
  soltados: string[];
} {
  const revision = revisionQueGobierna(filas);
  const byMonth: Record<string, number> = {};
  const soltados: string[] = [];
  if (revision === 0) return { revision, byMonth, soltados };
  for (const t of filas) {
    if (t.revision !== revision || !gobierna(t)) continue;
    const m = t.target_month.slice(0, 7);
    if (t.total === null) soltados.push(m);
    else byMonth[m] = Number(t.total);
  }
  return { revision, byMonth, soltados };
}
