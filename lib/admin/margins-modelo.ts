/*
 * ============================================================================
 * MARGINS — EL MODELO, SIN BASE Y SIN REACT (etapa ADM3)
 * ============================================================================
 *
 * Todo lo de acá es PURO: recibe filas de `margins.branch_margin` y devuelve la
 * grilla vigente y el historial. Sin cliente de Supabase y sin componentes, así
 * que se prueba sin navegador -- que es lo que hace que las cuatro reglas de
 * abajo tengan una prueba de verdad y no una captura.
 *
 * La lectura y la escritura viven en `margins.ts`, que importa esto.
 *
 * ---------------------------------------------------------------------------
 * ⚠ TRES COSAS QUE EL DATO HACE Y QUE UNA PANTALLA INGENUA ROMPERÍA
 * ---------------------------------------------------------------------------
 * Medido el 2026-10-01 sobre las 726 filas de la tabla:
 *
 *   1. LA GRILLA NO ES 14x3. `Broker out` existe sólo desde v2 y sólo en los 5
 *      branches que tienen v2; `Region` la tienen 5 de 21 --702, 703, 721, 728 y
 *      776--; y `Recruitment - BM` tiene SÓLO el nivel Branch. Dibujar el
 *      producto completo le inventaría filas Region a 16 branches.
 *
 *   2. LA CELDA VACÍA NO ES UN VALOR NULO: es una fila que no existe. Cero
 *      nulos en 726 filas.
 *
 *   3. Y LOS 14 CEROS QUE HAY ESTÁN TODOS EN `Region`, que es justamente la
 *      columna vacía para 16 branches. O sea que el cero y la ausencia conviven
 *      en la misma columna y significan cosas distintas: «se decidió que no
 *      suma» contra «este branch no tiene ese nivel».
 */

/** Los tres niveles, en el orden en que se leen. Las columnas de la tabla. */
export const NIVELES = ['Branch', 'Division', 'Region'] as const;
export type Nivel = (typeof NIVELES)[number];

/** Una fila cruda de `margins.branch_margin`. */
export interface MarginRow {
  margin_key: string;
  branch_code: string;
  loan_type: string;
  tipo_de_margen: string;
  version: string;
  /**
   * ⚠ NULLABLE EN LA TABLA, y es lo que ordena todo.
   *
   * Una fila sin `version_num` no se puede ubicar entre versiones --ni para lo
   * vigente ni para el historial-- así que se descarta y se cuenta, en vez de
   * caer a 0 y mezclarse con v1. Hoy no hay ninguna.
   */
  version_num: number | null;
  /** Llega como texto desde PostgREST (`numeric`), se convierte al leer. */
  valor_bps: string | number | null;
  origen: string;
  changed_by: string | null;
  changed_at: string | null;
  reason: string | null;
}

/** Una línea de la grilla, ya resuelta a número. */
export interface Linea {
  loanType: string;
  nivel: Nivel;
  valor: number | null;
  versionNum: number;
  origen: string;
}

/** La celda tal como la dibuja la tabla: puede no existir. */
export type Celda = Linea | null;

/** El valor como número, o `null` si la fila no lo trae. */
export function aNumero(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function esNivel(v: string): v is Nivel {
  return (NIVELES as readonly string[]).includes(v);
}

/**
 * El orden de los tipos de préstamo en la tabla.
 *
 * ⚠ ALFABÉTICO Y NO EL DEL ARCHIVO. La tabla no tiene columna de posición, así
 * que el único orden estable es uno que la pantalla declare: si se dejara el
 * orden de llegada, dos branches podrían listar sus filas distinto.
 */
export function ordenarTipos(tipos: Iterable<string>): string[] {
  return [...tipos].sort((a, b) => a.localeCompare(b));
}

/**
 * ⚠ EL ORDEN DE LOS BRANCHES NO ES EL ALFABÉTICO PELADO.
 *
 * Diecinueve son numéricos y dos son texto --`Recruitment - BM` y
 * `Recruitment - LO Only`--. Ordenando como texto, los dos de reclutamiento
 * caen en el medio de los números porque `'7' > 'R'` es falso. Los numéricos van
 * primero y por número, el resto después y alfabético.
 */
export function ordenarBranches(codigos: Iterable<string>): string[] {
  const num = (c: string) => (/^\d+$/.test(c) ? Number(c) : null);
  return [...codigos].sort((a, b) => {
    const na = num(a);
    const nb = num(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return a.localeCompare(b);
  });
}

/**
 * ============================================================================
 * LA GRILLA VIGENTE DE UN BRANCH
 * ============================================================================
 *
 * Lo que la tabla dibuja, y lo que una edición tiene que reescribir COMPLETO.
 *
 * ⚠ ES LA MISMA DEFINICIÓN QUE `margins.branch_margin_vigente`: el `version_num`
 * más alto de cada (tipo, nivel) -- no la última versión del branch. La
 * diferencia aparece si una versión omite una línea: ahí la vista sigue
 * sirviendo la vieja, y una pantalla que mostrara «la última versión» diría que
 * esa línea no existe.
 *
 * Y es la ÚNICA definición de «lo vigente» del módulo: las tres ventanas de
 * edición leen el valor actual de acá y no de una segunda consulta. Dos lecturas
 * de lo mismo son dos copias de la misma decisión, y divergen con el primer
 * cambio -- no con el tercer llamador.
 */
export interface Grilla {
  /** Los tipos de préstamo que este branch tiene, ordenados. */
  tipos: string[];
  /** Los niveles que este branch tiene, en el orden de `NIVELES`. */
  niveles: Nivel[];
  /** La celda de cada (tipo, nivel). `null` = este branch no tiene esa línea. */
  celda: (tipo: string, nivel: Nivel) => Celda;
  /** Todas las líneas que existen, que es lo que un guardado reescribe. */
  lineas: Linea[];
  /** El `version_num` más alto del branch. El próximo es éste más uno. */
  versionMaxima: number;
}

const SEP = '\u0000';
const clave = (tipo: string, nivel: string) => tipo + SEP + nivel;

export function grillaVigente(filas: MarginRow[]): Grilla {
  const ultima = new Map<string, MarginRow>();
  const tipos = new Set<string>();
  const niveles = new Set<Nivel>();
  let versionMaxima = 0;

  for (const f of filas) {
    if (f.version_num === null) continue;
    if (!esNivel(f.tipo_de_margen)) continue;
    versionMaxima = Math.max(versionMaxima, f.version_num);
    tipos.add(f.loan_type);
    niveles.add(f.tipo_de_margen);
    const k = clave(f.loan_type, f.tipo_de_margen);
    const previa = ultima.get(k);
    if (previa === undefined || (previa.version_num ?? 0) < f.version_num) ultima.set(k, f);
  }

  const lineas: Linea[] = [...ultima.values()].map((f) => ({
    loanType: f.loan_type,
    nivel: f.tipo_de_margen as Nivel,
    valor: aNumero(f.valor_bps),
    versionNum: f.version_num as number,
    origen: f.origen,
  }));
  const porClave = new Map(lineas.map((l) => [clave(l.loanType, l.nivel), l]));

  return {
    tipos: ordenarTipos(tipos),
    niveles: NIVELES.filter((n) => niveles.has(n)),
    celda: (tipo, nivel) => porClave.get(clave(tipo, nivel)) ?? null,
    lineas,
    versionMaxima,
  };
}

/**
 * ============================================================================
 * EL HISTORIAL — de dónde sale «de cuánto a cuánto»
 * ============================================================================
 *
 * La tabla guarda VALORES, no diferencias. El «antes» de una línea es el valor
 * que estaba VIGENTE para esa misma combinación (tipo, nivel) -- o sea la misma
 * partición que usa la vista.
 *
 * ⚠ Y LA PARTICIÓN ES LA DECISIÓN, no un detalle de implementación. Si el
 * historial comparara contra «la versión anterior del branch», una versión que
 * omita una línea se leería como un cambio, y la vista seguiría sirviendo el
 * valor viejo para esa combinación sin que nadie lo vea. Comparando por
 * combinación, la omisión es un estado propio y se puede avisar.
 *
 * De ahí salen CUATRO estados, y los cuatro hacen falta:
 *
 *   cambio     había anterior y es distinto      434 -> 469
 *   igual      había anterior y es el mismo      se colapsa en «N sin cambio»
 *   alta       no había anterior                 la línea no existía
 *   omitida    estaba vigente y esta versión no la escribió
 *
 * ⚠ EL TERCERO NO ES COSMÉTICO. El branch 711 no tiene v1: su v2 son 28 altas.
 * Sin distinguir «alta» de «cambio», esa pantalla muestra 28 filas de `— -> x`
 * como si alguien hubiera cambiado todo.
 *
 * ⚠ Y EL CUARTO HOY NO OCURRE NI UNA VEZ. Medido el 2026-10-01: cero
 * combinaciones de v1 que falten en v2, en los cinco branches que tienen v2. Una
 * rama que nunca se ejerció es exactamente la que hay que probar con un caso
 * construido -- `margins.test.mjs` arma esa versión incompleta a propósito.
 */
export type EstadoDeLinea = 'cambio' | 'igual' | 'alta' | 'omitida';

export interface LineaDeHistorial {
  loanType: string;
  nivel: Nivel;
  estado: EstadoDeLinea;
  antes: number | null;
  despues: number | null;
}

export interface VersionDeHistorial {
  versionNum: number;
  version: string;
  /** La fecha declarada de la versión. Las filas de una versión comparten la suya. */
  changedAt: string | null;
  changedBy: string | null;
  reason: string | null;
  origen: string;
  lineas: LineaDeHistorial[];
  cambios: LineaDeHistorial[];
  altas: LineaDeHistorial[];
  /** Las que se copiaron igual. Se cuentan, no se listan. */
  igualNum: number;
  /** Las que la versión dejó de escribir. Vacío en los datos de hoy. */
  omitidas: LineaDeHistorial[];
  /** La primera versión de un branch no es un cambio: es su carga. */
  esPrimera: boolean;
}

function ordenarLineas(ls: LineaDeHistorial[]): LineaDeHistorial[] {
  return [...ls].sort(
    (a, b) =>
      a.loanType.localeCompare(b.loanType) || NIVELES.indexOf(a.nivel) - NIVELES.indexOf(b.nivel)
  );
}

/** El historial de un branch, de la versión más nueva a la más vieja. */
export function historial(filas: MarginRow[]): VersionDeHistorial[] {
  const versiones = new Map<number, MarginRow[]>();
  for (const f of filas) {
    if (f.version_num === null) continue;
    if (!esNivel(f.tipo_de_margen)) continue;
    versiones.set(f.version_num, [...(versiones.get(f.version_num) ?? []), f]);
  }
  const numeros = [...versiones.keys()].sort((a, b) => a - b);

  /*
   * El valor vigente de cada combinación ANTES de la versión que se clasifica.
   * Se construye de la más vieja a la más nueva, que es lo que hace que «el
   * anterior» signifique «el que estaba vigente» aunque una versión intermedia
   * haya omitido la línea.
   */
  const vigente = new Map<string, number | null>();
  const salida: VersionDeHistorial[] = [];

  for (const [i, num] of numeros.entries()) {
    const delaVersion = versiones.get(num) ?? [];
    const escritasAhora = new Set<string>();
    const lineas: LineaDeHistorial[] = [];

    for (const f of delaVersion) {
      const nivel = f.tipo_de_margen as Nivel;
      const k = clave(f.loan_type, nivel);
      escritasAhora.add(k);
      const despues = aNumero(f.valor_bps);
      const habia = vigente.has(k);
      const antes = habia ? (vigente.get(k) as number | null) : null;
      const estado: EstadoDeLinea = !habia ? 'alta' : antes === despues ? 'igual' : 'cambio';
      lineas.push({ loanType: f.loan_type, nivel, estado, antes, despues });
    }

    /*
     * Las omitidas no son una línea de esta versión --por eso se calculan
     * aparte-- pero son lo que hay que avisar: la vista las sigue sirviendo con
     * el valor viejo, así que la pantalla muestra un número que esta versión no
     * escribió.
     */
    const omitidas: LineaDeHistorial[] = [];
    if (i > 0) {
      for (const [k, valor] of vigente.entries()) {
        if (escritasAhora.has(k)) continue;
        const [loanType, nivel] = k.split(SEP);
        omitidas.push({
          loanType,
          nivel: nivel as Nivel,
          estado: 'omitida',
          antes: valor,
          despues: null,
        });
      }
    }

    for (const f of delaVersion) {
      vigente.set(clave(f.loan_type, f.tipo_de_margen), aNumero(f.valor_bps));
    }

    const porEstado = (e: EstadoDeLinea) => lineas.filter((l) => l.estado === e);
    const primera = delaVersion[0];
    salida.push({
      versionNum: num,
      version: primera?.version ?? 'v' + num,
      changedAt: primera?.changed_at ?? null,
      changedBy: primera?.changed_by ?? null,
      reason: primera?.reason ?? null,
      origen: primera?.origen ?? 'archivo',
      lineas,
      cambios: ordenarLineas(porEstado('cambio')),
      altas: ordenarLineas(porEstado('alta')),
      igualNum: porEstado('igual').length,
      omitidas: ordenarLineas(omitidas),
      esPrimera: i === 0,
    });
  }

  return salida.reverse();
}

/**
 * ============================================================================
 * LAS FILAS DE UNA VERSIÓN NUEVA
 * ============================================================================
 *
 * ⚠ LAS TRES FORMAS DE EDITAR ESCRIBEN LO MISMO. Una celda, una fila o el branch
 * entero cambian cuántos valores trae la persona, no cuántas filas se escriben:
 * la versión nueva lleva TODAS las líneas vigentes del branch. Si omitiera las
 * que no cambiaron, la vista serviría la versión vieja para esas combinaciones
 * --porque su partición es por combinación-- y la omisión quedaría escondida
 * detrás de un número que se ve correcto.
 *
 * Es puro para poder probarlo: que la versión sea completa, que la clave no
 * contradiga a sus partes y que `origen` sea `app` son tres cosas que se
 * verifican sin tocar la base.
 */
export interface CambioPedido {
  loanType: string;
  nivel: Nivel;
  valor: number;
}

export interface FilaNueva {
  margin_key: string;
  branch_code: string;
  loan_type: string;
  tipo_de_margen: Nivel;
  version: string;
  version_num: number;
  valor_bps: number | null;
  origen: 'app';
  changed_by: string;
  changed_at: string;
  reason: string;
}

/** Los cambios que no caen sobre una línea vigente del branch. */
export function cambiosHuerfanos(grilla: Grilla, cambios: CambioPedido[]): CambioPedido[] {
  return cambios.filter((c) => grilla.celda(c.loanType, c.nivel) === null);
}

export function filasDeLaVersion(
  branchCode: string,
  grilla: Grilla,
  cambios: CambioPedido[],
  motivo: string,
  autor: string,
  cuando: string
): FilaNueva[] {
  const nuevos = new Map(cambios.map((c) => [clave(c.loanType, c.nivel), c.valor]));
  const versionNum = grilla.versionMaxima + 1;
  const version = 'v' + versionNum;

  return grilla.lineas.map((l) => {
    const pedido = nuevos.get(clave(l.loanType, l.nivel));
    return {
      /*
       * ⚠ LA CLAVE SE ARMA DE LAS MISMAS PARTES QUE VAN EN LAS COLUMNAS, y el
       * `with check` de la policy comprueba esa igualdad. Una clave que diga
       * `FHA` en una fila cuyo `loan_type` sea `VA` entraría igual --la PK sería
       * única-- y chocaría meses después con el FHA de verdad.
       */
      margin_key: branchCode + '|' + l.loanType + '|' + l.nivel + '|' + version,
      branch_code: branchCode,
      loan_type: l.loanType,
      tipo_de_margen: l.nivel,
      version,
      version_num: versionNum,
      valor_bps: pedido === undefined ? l.valor : pedido,
      /*
       * ⚠ `'app'` NO ES UNA ETIQUETA: es lo que impide que el sync revierta esta
       * fila al valor del Excel en su próxima corrida.
       */
      origen: 'app',
      changed_by: autor,
      changed_at: cuando,
      reason: motivo,
    };
  });
}
