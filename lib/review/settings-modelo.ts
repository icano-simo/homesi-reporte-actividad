/**
 * ============================================================================
 * LA LISTA DE COACH SETTINGS: filtros, secciones y conteos — etapa RV35
 * ============================================================================
 *
 * ARCHIVO NUEVO, y es lógica PURA a propósito: con 42 asignaciones de 11
 * revisores la pantalla pasó a tener filtros combinables, separación de
 * prácticas y agrupación por branch, y todo eso se puede equivocar en silencio
 * -- un conteo que suma de más se ve bien por su cuenta.
 *
 * Acá no se importa React ni Supabase, así que su prueba corre con Node y sin
 * levantar nada, igual que `lib/admin/margins-modelo.ts`.
 */
/*
 * ⚠ RUTA RELATIVA Y CON `.ts`, las dos cosas por el mismo motivo: este archivo
 * lo importa Node DIRECTO en su prueba --sin bundler-- y Node no resuelve ni el
 * alias `@/` ni una ruta sin extensión. `allowImportingTsExtensions` ya estaba
 * en el `tsconfig`, así que la misma línea le sirve a los dos.
 */
import { seccionesDeBranch, ordenarBranches, type RosterParaBranches } from '../admin/margins-modelo.ts';
import type { MyReview } from './types';

/**
 * El estado de una asignación, derivado de su sesión.
 *
 * ⚠ TRES VALORES Y NINGUNO ES AMBIGUO. `not_started` es «no hay sesión», que no
 * es lo mismo que una sesión sin respuestas -- esa distinción ya la hace
 * `MyReview.session` y acá se respeta en vez de volver a colapsarla.
 */
export type EstadoAsignacion = 'in_progress' | 'completed' | 'not_started';

export function estadoDe(fila: MyReview): EstadoAsignacion {
  if (fila.session === null) return 'not_started';
  return fila.session.status === 'completed' ? 'completed' : 'in_progress';
}

/** Lo que los tres filtros de la pantalla piden. `null` = sin filtrar. */
export interface FiltroDeLista {
  estado: EstadoAsignacion | null;
  /** `employee_key` del revisor. */
  coach: number | null;
  /** Texto libre sobre el nombre del coachee. */
  busqueda: string;
}

export const SIN_FILTRO: FiltroDeLista = { estado: null, coach: null, busqueda: '' };

/**
 * Los tres filtros, combinados con Y.
 *
 * ⚠ SE COMBINAN, no se eligen. Un filtro por coach que ignorara el de estado
 * --o al revés-- daría una lista correcta para una pregunta que nadie hizo, y
 * el conteo de arriba la respaldaría. Por eso la prueba ejerce los tres juntos
 * y no sólo uno por vez: dos filtros que funcionan por separado no dicen nada
 * de los dos puestos a la vez.
 */
export function filtrar(filas: MyReview[], f: FiltroDeLista): MyReview[] {
  const texto = f.busqueda.trim().toLowerCase();
  return filas.filter((fila) => {
    if (f.estado !== null && estadoDe(fila) !== f.estado) return false;
    if (f.coach !== null && fila.assignment.reviewer_employee_key !== f.coach) return false;
    if (texto !== '' && !fila.loName.toLowerCase().includes(texto)) return false;
    return true;
  });
}

/**
 * Las reales y las prácticas, separadas.
 *
 * ⚠ Y EL CONTEO DE LAS REALES NO LAS INCLUYE, que es el punto: hoy la pantalla
 * dice `42` sobre una lista donde once no cuentan para el registro de nadie.
 * Devolver dos listas --en vez de una con un flag-- hace que el conteo de cada
 * sección sea el largo de la suya y no un filtro que alguien puede olvidar.
 */
export function separarPracticas(filas: MyReview[]): { reales: MyReview[]; practicas: MyReview[] } {
  const reales: MyReview[] = [];
  const practicas: MyReview[] = [];
  for (const f of filas) {
    if (f.assignment.is_practice) practicas.push(f);
    else reales.push(f);
  }
  return { reales, practicas };
}

/** Un grupo de la lista: un branch con sus asignaciones. */
export interface GrupoDeBranch {
  /** El código, o `null` para las personas sin branch asignado. */
  branch: string | null;
  filas: MyReview[];
}

export interface ListaAgrupada {
  /** Branches con al menos un productor activo en el roster. */
  activos: GrupoDeBranch[];
  /**
   * El resto de los branches del roster, y los que no están en él.
   *
   * ⚠ VAN JUNTOS ACÁ Y EN MARGINS NO, y la diferencia tiene razón: allá la
   * sección decide qué se le puede fijar a quién --a una oficina con gente se
   * le fija un margen esperando producción, a un branch vacío no-- y acá sólo
   * ordena una lista de personas. Partirla en tres secciones de una fila cada
   * una haría más difícil de leer lo que esta etapa viene a hacer legible.
   */
  inactivos: GrupoDeBranch[];
  /** Los que no tienen branch: van al final, con su motivo en pantalla. */
  sinBranch: GrupoDeBranch | null;
}

/**
 * Agrupa por branch y ordena las secciones con la regla DEL PORTAL.
 *
 * ⚠ `seccionesDeBranch` ES LA DE MARGINS, importada y no copiada. «Activo» ya
 * está decidido una vez --al menos un productor activo en el roster, que es
 * `isInactive` de `lib/outlook/loadData.ts`-- y una segunda definición acá
 * tendría que decidir lo mismo y divergiría con el primer cambio. El disparador
 * para compartir no es el tercer llamador: es el primer edit.
 *
 * Vive en `lib/admin/` por dónde nació, no por a quién le sirve. Moverla sería
 * una etapa aparte; importarla desde acá es lo que el pedido pide: no armar una
 * regla nueva.
 */
export function agruparPorBranch(
  filas: MyReview[],
  branchDe: (employeeKey: number) => string | null,
  roster: RosterParaBranches[]
): ListaAgrupada {
  const porBranch = new Map<string, MyReview[]>();
  const sueltas: MyReview[] = [];
  for (const f of filas) {
    const b = branchDe(f.assignment.lo_employee_key);
    if (b === null || b.trim() === '') {
      sueltas.push(f);
      continue;
    }
    porBranch.set(b, [...(porBranch.get(b) ?? []), f]);
  }

  const codigos = ordenarBranches(porBranch.keys());
  const sec = seccionesDeBranch(codigos, roster);
  /*
   * ⚠ Los MARCADORES de reclutamiento vuelven a la lista de inactivos acá, y no
   * es un descuido: `Recruitment - BM` es un cubo de márgenes, no un branch, así
   * que ninguna persona puede estar asignada a él. Si alguna vez aparece uno,
   * que se vea en la pantalla en vez de desaparecer de los tres grupos.
   */
  const grupo = (b: string): GrupoDeBranch => ({ branch: b, filas: porBranch.get(b) ?? [] });
  return {
    activos: sec.activos.map(grupo),
    inactivos: [...sec.inactivos, ...sec.sinRoster, ...sec.marcadores].map(grupo),
    sinBranch: sueltas.length > 0 ? { branch: null, filas: sueltas } : null,
  };
}

/**
 * Cuántas filas hay en una lista agrupada.
 *
 * Existe para que el conteo del encabezado salga de LO QUE SE DIBUJA y no de la
 * lista de antes de agrupar: si un branch se perdiera por el camino, el número
 * lo diría en vez de taparlo.
 */
export function contarAgrupadas(l: ListaAgrupada): number {
  const suma = (gs: GrupoDeBranch[]) => gs.reduce((a, g) => a + g.filas.length, 0);
  return suma(l.activos) + suma(l.inactivos) + (l.sinBranch?.filas.length ?? 0);
}
