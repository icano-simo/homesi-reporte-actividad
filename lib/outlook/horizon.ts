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

/** La lista de meses futuros que corresponde a un horizonte. */
export function remainingMonthsFor(currentMonth: string, horizonMonths: number | null): string[] {
  const n = horizonMonths ?? monthsToDecember(currentMonth);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(addMonths(currentMonth, i));
  return out;
}

const ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function etiquetaMes(ym: string): string {
  return `${ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}
