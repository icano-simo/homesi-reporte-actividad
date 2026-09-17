import { apportionByWeight } from '../pipeline/aggregate.ts';

/**
 * ============================================================================
 * LO QUE APORTA CADA REALTOR NPPM A SU LOAN OFFICER — etapa BP54, ARCHIVO NUEVO
 * ============================================================================
 *
 * ⚠ POR QUÉ EXISTE, y es un ciclo de imports y no una preferencia de estilo.
 *
 * El perfil del Loan Officer tiene que mostrar el MISMO presupuesto que Outlook,
 * y desde OL48 ese número puede venir del piso de sus realtors --
 * `presupuestoDePersona`--. Pero el piso se derivaba adentro del loader de
 * Outlook, y el perfil no puede pedírselo:
 *
 *     lib/outlook/loadData.ts:26   import { loadBusinessPlanData } from
 *                                  '@/lib/business-plan/loadData'
 *
 * Outlook importa Business Plan. Que Business Plan llamara a `loadOutlookData`
 * cerraría el ciclo. Por eso Business Plan sólo importa los módulos PUROS de
 * Outlook --`gobierno`, `project`-- y por eso el piso tiene que ser otro.
 *
 * ⚠ Y LA EXTRACCIÓN ES LIMPIA PORQUE EL DATO LO DICE: las cuatro entradas de
 * este cálculo --`org.nppm_realtor`, `outlook.nppm_realtor_owner`,
 * `outlook.nppm_benchmark` y los cierres del realtor-- no salen de Business
 * Plan. No hay nada que este módulo necesite del otro lado del ciclo.
 *
 * ---------------------------------------------------------------------------
 * LAS CUATRO REGLAS QUE CODIFICA, Y NINGUNA ES NUEVA
 * ---------------------------------------------------------------------------
 *
 *   1. SÓLO DONDE PROYECTA HOY — OL30. Un realtor que se mudó sigue teniendo
 *      fila en el branch viejo con su producción real, y no suma ahí. El
 *      reparto es POR BRANCH, entre los que proyectan en ese branch.
 *   2. SIN DUEÑO NO SUMA EN NINGÚN LADO — OL42. Repartirlo o colgarlo del
 *      branch sería inventar una decisión que nadie tomó.
 *   3. UN VÍNCULO VIEJO TAMPOCO SUMA — OL45. `org.nppm_realtor` lo mueve RRHH y
 *      `nppm_realtor_owner` no se entera: un realtor que cambió de branch queda
 *      atado a un Loan Officer del branch anterior, y su presupuesto sumaría
 *      donde el realtor ya no está. Se descarta, y la fila lo dice.
 *   4. MANDA LO FIJADO, Y SI NO HAY, LO PROYECTADO — OL46. La misma regla que
 *      OL39 para las personas. De los trece NPPM del roster hay exactamente UNO
 *      con filas en `budget_total`; los otros doce proyectan por su benchmark, y
 *      antes de OL46 ese número no llegaba a ningún bucket.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL REDONDEO VA ACÁ Y NO EN CADA LLAMADOR
 * ---------------------------------------------------------------------------
 *
 * Medio préstamo no existe, así que el total del branch se redondea y se reparte
 * con `apportionByWeight`, que garantiza que las partes sumen ese total. Si cada
 * loader redondeara por su cuenta, los dos números serían «casi iguales» y
 * diferirían por un caso de medio punto sin que nada lo dijera -- que es la
 * forma exacta en que este proyecto ya pagó dos cascadas de redondeo.
 */

/** Un realtor NPPM, con lo que hace falta para proyectar su aporte. */
export interface RealtorParaPiso {
  realtorCode: string;
  displayName: string;
  /**
   * El branch donde proyecta HOY. El reparto es por branch: dos realtors de
   * branches distintos no compiten por el mismo redondeo.
   */
  branchCode: string;
  /** Su benchmark vigente: el guardado, o el promedio de sus 3 meses cerrados. */
  benchmark: number;
}

/** A qué Loan Officer se le suma un realtor. */
export interface DuenoDeRealtor {
  realtorCode: string;
  ownerEmployeeKey: number;
  /**
   * El branch PRIMARIO del dueño. Si no coincide con el del realtor, el vínculo
   * quedó viejo y no suma -- regla 3.
   */
  ownerPrimaryBranch: string;
}

/** Lo que un realtor le aporta a su Loan Officer, mes a mes. */
export interface AporteDeRealtor {
  realtorCode: string;
  displayName: string;
  byMonth: Record<string, number>;
  /** De dónde salió: un total fijado, o su proyección. */
  fuente: 'fixed' | 'projection';
}

/**
 * Lo que proyecta cada realtor, repartido por branch.
 *
 * Se exporta aparte porque la FILA del realtor muestra este mismo número, y
 * calcularlo dos veces es cómo las dos pantallas terminan diciendo distinto.
 */
export function proyeccionPorRealtor(
  realtors: readonly RealtorParaPiso[],
  months: readonly string[]
): Map<string, Record<string, number>> {
  const salida = new Map<string, Record<string, number>>();
  const porBranch = new Map<string, RealtorParaPiso[]>();
  for (const r of realtors) {
    porBranch.set(r.branchCode, [...(porBranch.get(r.branchCode) ?? []), r]);
  }
  for (const [, deEsteBranch] of porBranch) {
    for (const r of deEsteBranch) if (!salida.has(r.realtorCode)) salida.set(r.realtorCode, {});
    const suma = deEsteBranch.reduce((a, r) => a + r.benchmark, 0);
    for (const m of months) {
      const partes = apportionByWeight(Math.round(suma), deEsteBranch.map((r) => r.benchmark));
      partes.forEach((v, i) => {
        const dest = salida.get(deEsteBranch[i].realtorCode);
        if (dest) dest[m] = v;
      });
    }
  }
  return salida;
}

/**
 * El aporte de los realtors a cada Loan Officer: `employee_key` → sus realtors.
 *
 * Lo que devuelve es exactamente lo que `presupuestoDePersona` necesita como
 * `pisoDeRealtors` --sumando los `byMonth` del mes-- y lo que la tarjeta de
 * composición muestra como detalle. Un solo cálculo para los dos.
 */
export function aportesPorPersona(input: {
  realtors: readonly RealtorParaPiso[];
  duenos: readonly DuenoDeRealtor[];
  /** `realtorCode` → mes → total fijado. Lo que gobierna cuando existe. */
  fijados: Readonly<Record<string, Record<string, number>>>;
  months: readonly string[];
}): Map<number, AporteDeRealtor[]> {
  const proyectado = proyeccionPorRealtor(input.realtors, input.months);
  const porCodigo = new Map(input.realtors.map((r) => [r.realtorCode, r]));
  const salida = new Map<number, AporteDeRealtor[]>();

  for (const d of input.duenos) {
    const r = porCodigo.get(d.realtorCode);
    /* Regla 1: si no está entre los que proyectan, no hay nada que sumar. */
    if (r === undefined) continue;
    /* Regla 3: el vínculo quedó en otro branch. */
    if (d.ownerPrimaryBranch !== r.branchCode) continue;

    /* Regla 4: manda lo fijado. */
    const fijado = input.fijados[d.realtorCode];
    const byMonth = fijado ?? proyectado.get(d.realtorCode) ?? {};
    if (Object.keys(byMonth).length === 0) continue;

    salida.set(d.ownerEmployeeKey, [
      ...(salida.get(d.ownerEmployeeKey) ?? []),
      {
        realtorCode: r.realtorCode,
        displayName: r.displayName,
        byMonth: { ...byMonth },
        fuente: fijado === undefined ? 'projection' : 'fixed',
      },
    ]);
  }
  /* Regla 2 no necesita código: un realtor sin dueño no está en `duenos`. */
  return salida;
}
