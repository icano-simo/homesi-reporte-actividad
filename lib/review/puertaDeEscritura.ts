/*
 * ============================================================================
 * LA PUERTA — por dónde sale TODO lo que un paso escribe hacia afuera (RV24)
 * ============================================================================
 *
 * Una sesión de práctica recorre el proceso entero y no ensucia el registro.
 * Eso no lo puede resolver una columna: el problema no es la sesión, son los
 * pasos que escriben en OTRAS tablas.
 *
 * Son TRES, no dos, y no son la misma clase de escritura:
 *
 *   1.2  Benchmark   -> org.employee_benchmark      cambia el veredicto del perfil
 *   2.2  Budget      -> outlook.budget_total        cambia el pronostico del branch
 *   3.1  Funnel      -> business_plan.enrollment    REEMPLAZA el plan activo
 *
 * El 3.1 es el peor porque no agrega ruido: `enrollment_one_active_idx` deja un
 * solo plan activo por persona, asi que una practica no ensucia -- sustituye.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ UNA PUERTA Y NO TRES RAMAS
 * ---------------------------------------------------------------------------
 * Tres `if (esPractica)` en tres archivos son tres copias de la misma decision
 * con un llamador cada una, y este repo tiene nueve casos escritos de que eso
 * diverge con el primer edit -- no con el tercer llamador.
 *
 * Y lo que decide es el cuarto paso: el dia que alguien agregue un paso que
 * escriba, con tres ramas se olvida y con una puerta no puede, porque
 * `verificar:practica` compara el registro de abajo contra los pasos que la
 * base declara con `gate_kind` de escritura.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ LA PRÁCTICA ESCRIBE EN SU PROPIA SESIÓN Y NO EN LAS TABLAS REALES
 * ---------------------------------------------------------------------------
 * La otra opcion era marcar las filas reales con `is_practice` y filtrarlas al
 * leer. Las dos tienen el mismo olvido --un lector que no filtra-- y fallan
 * para lados opuestos:
 *
 *   marcando las filas reales  ->  el que se olvida muestra un numero de
 *                                  practica COMO REAL
 *   escribiendo en la sesion   ->  el que se olvida muestra el REAL
 *
 * La segunda falla hacia la verdad. Es la unica diferencia entre las dos, y
 * alcanza para decidir.
 */

/** Los pasos que escriben algo fuera de `review`. La clave es `fase.paso`. */
export const PASOS_QUE_ESCRIBEN = {
  '1.2': { destino: 'org.employee_benchmark', que: 'benchmark' },
  '2.2': { destino: 'outlook.budget_total', que: 'budget' },
  '3.1': { destino: 'business_plan.enrollment', que: 'funnel' },
} as const;

export type PasoQueEscribe = keyof typeof PASOS_QUE_ESCRIBEN;

/**
 * El contexto de la sesión desde la que se está escribiendo.
 *
 * ⚠ `esPractica` NO es opcional y no tiene valor por defecto, a proposito. Un
 * `esPractica = false` por omision convierte «no me pasaron el contexto» en
 * «esto es real», que es la unica confusion que esta puerta no puede permitir:
 * seria un valor que significa «no lo se» indistinguible de uno que significa
 * «no lo es», escribiendo en una tabla de negocio.
 */
export interface ContextoDeSesion {
  esPractica: boolean;
  /** La sesión desde la que se escribe. En práctica es a dónde va el valor. */
  sessionKey: number;
}

/** A dónde va esta escritura. */
export type Destino =
  | { modo: 'real' }
  /**
   * El valor no sale de `review`: viaja en el `gate` de la respuesta que cierra
   * el paso, que ya es append-only y ya es por sesión. No se escribe una fila
   * aparte -- seria una segunda fila por respuesta y `review.response` ya tiene
   * su regla de «vale la ultima por (session_key, phase_no, step_in_phase)».
   */
  | { modo: 'practica'; gate: Record<string, unknown> };

/**
 * Decide el destino de lo que un paso va a escribir.
 *
 * Pura: no toca la base ni la sesión. Es lo que se puede probar en seco, y es
 * donde vive la decisión -- las tres escrituras de verdad son tres llamadas
 * distintas a tres módulos distintos, pero el CRITERIO es este y es uno solo.
 *
 * @param ctx   de qué sesión sale la escritura
 * @param paso  `fase.paso`, como lo nombra `review.step`
 * @param valor lo que el paso quiere escribir, ya validado por su editor
 */
export function decidirDestino(
  ctx: ContextoDeSesion,
  paso: PasoQueEscribe,
  valor: unknown
): Destino {
  if (!ctx.esPractica) return { modo: 'real' };
  const { que } = PASOS_QUE_ESCRIBEN[paso];
  /*
   * Bajo `practica` y no en la raiz del `gate`: el `gate` ya guarda la
   * evidencia de la compuerta --los clics del paso 1.4-- y mezclar las dos
   * cosas haria que un lector de la evidencia tuviera que saber cuales de sus
   * claves son de practica. Un contenedor propio no obliga a nadie a saberlo.
   */
  return { modo: 'practica', gate: { practica: { [que]: valor } } };
}

/**
 * Lo que la práctica guardó para este paso, leído de la respuesta.
 *
 * ⚠ DEVUELVE `undefined` CUANDO NO HAY, y nunca un valor por defecto. Quien lo
 * llama tiene que caer al valor REAL, que es lo que hace que un lector que se
 * olvide de llamar a esto muestre el real y no una practica -- la propiedad
 * entera por la que se eligio este diseño.
 */
export function valorDePractica(
  gate: unknown,
  paso: PasoQueEscribe
): unknown | undefined {
  if (gate === null || typeof gate !== 'object') return undefined;
  const practica = (gate as Record<string, unknown>).practica;
  if (practica === null || typeof practica !== 'object') return undefined;
  const { que } = PASOS_QUE_ESCRIBEN[paso];
  const v = (practica as Record<string, unknown>)[que];
  return v === undefined ? undefined : v;
}
