import { addMonths } from '@/lib/business-plan/impact';

/**
 * ============================================================================
 * HASTA DÓNDE SE PROYECTA — etapa OL22, ARCHIVO NUEVO
 * ============================================================================
 *
 * Estaba dentro de la vista de un branch, con su propio estado. Se saca acá
 * porque desde OL22 el horizonte es del MÓDULO: lo elige la barra superior y lo
 * aplican las dos vistas. Un horizonte distinto por branch no significa nada --
 * el presupuesto es de la división-- y obligaba a repetir la selección trece
 * veces.
 *
 * ⚠ NO HACE FALTA TOCAR EL MOTOR para proyectar más lejos, y no se tocó:
 * `projectPlan` ya evalúa cualquier mes futuro --una regla es `from_month` +
 * cadencia + porcentaje, y eso no sabe de años-- y `composeYear` arma la fila
 * con la lista de meses que le pasen. Lo único que hace falta es la lista.
 *
 * ⚠ Y NADA DE AÑOS ESCRITOS A MANO. Las opciones se derivan del mes en curso,
 * así que el 1 de enero se corren solas. Un `2027` literal es lo que obliga a
 * volver acá cada año.
 */

export interface HorizonOption {
  label: string;
  /** Meses hacia adelante desde el mes en curso. `null` = hasta diciembre. */
  months: number | null;
}

/** Meses desde el actual hasta diciembre del año en curso. 0 en diciembre. */
export function monthsToDecember(currentMonth: string): number {
  return 12 - Number(currentMonth.slice(5, 7));
}

/**
 * Las opciones del desplegable, derivadas del mes en curso.
 *
 * La primera es el valor por defecto --hasta diciembre-- y es la única con la
 * que la tabla de la vista 1 son exactamente los doce meses del año.
 */
export function horizonOptions(currentMonth: string): HorizonOption[] {
  const year = Number(currentMonth.slice(0, 4));
  const hastaDic = monthsToDecember(currentMonth);
  const opciones: HorizonOption[] = [{ label: `Dec ${year}`, months: null }];
  for (const n of [6, 12, 18, 24]) {
    const fin = addMonths(currentMonth, n);
    opciones.push({ label: `${n} months (${etiquetaMes(fin)})`, months: n });
  }
  /* Los diciembres de los dos años siguientes, para pensar en años cerrados. */
  for (const suma of [1, 2]) {
    const meses = suma * 12 + hastaDic;
    opciones.push({ label: `Dec ${year + suma} (${meses} months)`, months: meses });
  }
  return opciones;
}

/**
 * La lista de meses futuros que corresponde a un horizonte.
 *
 * ============================================================================
 * ⚠ ARRANCA EN `i = 1`, Y ESO ES UNA REGLA — NO UN OFF-BY-ONE
 * ============================================================================
 *
 * El mes EN CURSO no está, así que su presupuesto no se puede fijar ni
 * corregir. Desde afuera parece una limitación y es la decisión:
 *
 *   **El presupuesto de un mes se fija ANTES de que el mes empiece, y una vez
 *   que arrancó es la meta contra la que se mide. Poder corregirlo durante el
 *   mes sería mover la vara mientras se juega.**
 *
 * Queda escrito acá, en la condición misma, porque desde afuera se lee como un
 * descuido. Y ya costó una etapa: BP54 midió que `outlook.budget_total` no
 * tenía UNA SOLA fila de septiembre, lo leyó como un hueco que había que
 * rellenar, e hizo que el perfil del Loan Officer mostrara el presupuesto del
 * PRÓXIMO mes en su lugar. El número era correcto y afirmaba algo falso -- el
 * de octubre nunca fue la meta de septiembre -- y encima alimentaba el GAP.
 *
 * La consecuencia que hay que saber, y que NO es un problema: los meses
 * anteriores a que esto se empezara a cargar quedan sin presupuesto PARA
 * SIEMPRE. No se perdió ninguno; nunca existieron. Lo que corresponde es que la
 * pantalla lo DIGA --«not budgeted»-- y no que lo rellene con otro mes.
 */
export function remainingMonthsFor(currentMonth: string, horizonMonths: number | null): string[] {
  const n = horizonMonths ?? monthsToDecember(currentMonth);
  const out: string[] = [];
  /* `i = 1` y no `0`: ver el JSDoc. El mes en curso ya no se presupuesta. */
  for (let i = 1; i <= n; i++) out.push(addMonths(currentMonth, i));
  return out;
}

const ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function etiquetaMes(ym: string): string {
  return `${ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}
