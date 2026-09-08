'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import OutlookTopBar from '@/app/outlook/components/OutlookTopBar';
import { RECRUITMENT_BRANCH } from '@/app/outlook/components/RecruitEditor';
import { composeYear, currentMonthByBranch, projectBranch, type OutlookData } from '@/lib/outlook/loadData';
import { remainingMonthsFor } from '@/lib/outlook/horizon';
import { fmt, sumOfShown } from '@/lib/outlook/format';
import { useOutlookDataContext } from '@/lib/outlook/useOutlookData';

/**
 * ============================================================================
 * OUTLOOK — VISTA 1: todas las branches × LOS DOCE MESES (etapas OL1 y OL3)
 * ============================================================================
 *
 * Las branches por fila; por columna, los doce meses del año y el total.
 *
 * ⚠ NINGUNA celda se calcula acá. Los meses reales vienen leídos de
 * `loan_records_v2`, el mes en curso es el pronóstico que ya calcula Forecast, y
 * los meses futuros salen de `projectBranch`, que es la suma de los Loan
 * Officers, que es la suma de sus cinco estrategias. Esta pantalla formatea y
 * rotula; `composeYear` es la que decide qué pedazo va en cada mes.
 *
 * ---------------------------------------------------------------------------
 * LAS TRES BANDAS SON UNA PARTICIÓN, Y ESO ES EL PUNTO — etapa OL3
 * ---------------------------------------------------------------------------
 * real (ene–jul) · pronóstico (agosto) · presupuesto (sep–dic). Cada mes está en
 * una sola banda, así que el total del año no puede contar nada dos veces.
 *
 * La versión anterior --`YTD | mes en curso | sep..dic`-- sí podía, y lo hacía:
 * ver el bloque del doble conteo en `composeYear`. Las bandas se rotulan en una
 * fila de cabecera propia porque tres tipos de número distintos en una misma
 * fila, sin decir cuál es cuál, invitan a compararlos como si fueran lo mismo.
 *
 * Nada de esto está escrito a mano: los meses salen de `monthsOfYear` y la
 * frontera de `currentMonth`, así que en enero la banda real queda vacía y en
 * diciembre queda vacía la del presupuesto, sin tocar este archivo.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(ym: string): string {
  return MONTH_ABBR[Number(ym.split('-')[1]) - 1];
}

/**
 * Entero cuando lo es, un decimal cuando no. Tres estados y no dos:
 *   `—` no se puede saber · `–` cero · el número
 */
/** La banda a la que pertenece un mes. Es también su clase de color. */
function bandOf(month: string, currentMonth: string): 'actual' | 'forecast' | 'budget' {
  return month < currentMonth ? 'actual' : month === currentMonth ? 'forecast' : 'budget';
}

/* `rampaTexto` se fue con la barra, a `OutlookTopBar` -- etapa OL22. */

/* `PersonaFila` se fue con el filtro -- revertido en OL22-C. */

export default function OutlookPage() {
  const router = useRouter();
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ LOS DOS BLOQUES DEL FONDO, COLAPSADOS — etapa OL23
   * ══════════════════════════════════════════════════════════════════════════
   *
   * `Inactive` y `Not assigned yet` arrancan cerrados: son diez filas que casi
   * siempre están en cero y competían por la atención con los catorce branches
   * que operan.
   *
   * ⚠ COLAPSADO NO ES EXCLUIDO, y es la parte que hay que no romper. Sus
   * números siguen sumando al total de la división: `totalByMonth` recorre
   * `rows`, que son los tres bloques juntos, y NO la lista que se dibuja. Eso
   * es exactamente lo que OL21 vino a arreglar cuando Outlook decía 340 y
   * Commercial Activity 355; si al colapsar el total se moviera, sería el mismo
   * defecto de vuelta por otra puerta.
   *
   * Por eso la barra muestra el SUBTOTAL del bloque aunque esté cerrado: se ve
   * cuánto aporta sin tener que abrirlo, y un total que no cuadra con la suma
   * visible queda explicado en la misma línea.
   */
  const [bloquesAbiertos, setBloquesAbiertos] = useState<Set<string>>(new Set());
  const alternarBloque = (t: string) =>
    setBloquesAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  /*
   * El panel abierto: la rampa global o el alta a mano -- etapa OL21. Los dos
   * son del módulo, así que su estado vive en esta vista y no en un branch.
   *
   * ⚠ El hook va ANTES de los early returns. React exige el mismo orden de
   * hooks en cada render, y abajo hay dos `return` que salen antes de la tabla.
   */
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ ACÁ VIVÍA EL FILTRO DE ESTRATEGIA Y SE FUE — revertido en OL22-C
   * ══════════════════════════════════════════════════════════════════════════
   *
   * OL21 lo puso sobre esta tabla: elegir una estrategia y ver los números DE
   * esa estrategia en cada branch, con su gente al abrir la fila. Funcionaba y
   * estaba verificado contra la vista 2 celda por celda.
   *
   * Se saca por una reformulación del pedido, no por un defecto: lo que hace
   * falta no es un filtro sobre esta tabla sino una SECCIÓN ANALÍTICA propia --
   * elegir una estrategia y ver las personas que la abren con su branch y su
   * proyección, mostrando sólo los branches que la tienen, y pudiendo mirar
   * actual + forecast + outlook o sólo outlook.
   *
   * ⚠ Y NO SE CONSTRUYE TODAVÍA, a propósito: hoy los quince reclutas y las dos
   * Account Executives de Affinity no tienen benchmark, y las personas del
   * roster tienen provisionales. Esa sección mostraría ceros, y una pantalla
   * nueva que muestra ceros no se puede evaluar -- no se distingue "está mal"
   * de "todavía no hay datos".
   *
   * ⚠ LO QUE NO SE FUE, y es la mitad que importaba: `lib/outlook/strategyRows.ts`
   * se queda. Nació para este filtro, pero desde OL22 es la ÚNICA
   * implementación del cálculo por estrategia y la usa la vista de un branch.
   * Borrarla con el filtro habría devuelto la duplicación que OL22 vino a
   * cerrar. La sección analítica, cuando se plantee, ya la tiene lista.
   */
  /* Los datos vienen del contexto del layout: una sola carga para las dos
     vistas. Ver `lib/outlook/useOutlookData.tsx`. */
  const { data, error, horizonMonths } = useOutlookDataContext();

  if (error) {
    return (
      <div className="hub-container">
        <div className="bp-empty">Could not load Outlook: {error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hub-container">
        <div className="bp-empty">Loading the year&apos;s outlook…</div>
      </div>
    );
  }

  /*
   * ⚠ LOS MESES SALEN DEL HORIZONTE DEL MODULO — etapa OL22, no de `data`.
   *
   * `data.monthsOfYear` es siempre el ano calendario. Con el selector arriba,
   * esta tabla tiene que estirarse igual que la de un branch: si no, el control
   * estaria ahi sin hacer nada en la mitad del modulo -- el "lapiz que no hacia
   * nada" otra vez.
   *
   * Por defecto (`horizonMonths === null`) da exactamente los doce meses del
   * ano, asi que quien no lo toca ve lo de antes.
   */
  const { actualMonths, currentMonth } = data;
  const remainingMonths = remainingMonthsFor(currentMonth, horizonMonths);
  const monthsOfYear = [...actualMonths, currentMonth, ...remainingMonths];
  const year = currentMonth.split('-')[0];

  /*
   * ⚠ Branches con producción y SIN nadie que proyecte -- se define antes de
   * armar las filas porque la celda del mes en curso depende de esto.
   *
   * La proyección se carga al branch del ROSTER de cada persona, así que un
   * branch donde nadie está rosterizado no proyecta nada aunque tenga cerrados.
   * AFFINITY es el caso, y 741 y 771 aparecieron solos al generalizarlo.
   *
   * No se calcula distinto -- se EXPLICA. Un YTD de 31 con proyección cero y sin
   * texto se reporta como bug, y quien lo reporta tiene razón en preguntar.
   * A quién pertenece ese presupuesto es una decisión de negocio pendiente.
   */
  /*
   * ⚠ AHORA SALE DEL LOADER Y NO DE `loanOfficers` — etapa OL21.
   *
   * Antes se preguntaba "¿alguien de la lista tiene este branch como primario?",
   * que no es lo mismo: `loanOfficers` incluye a los `outsiders` de OL16 --gente
   * cuyo branch de roster es otro y que cerró acá-- así que un branch con un
   * cierre ajeno podía contestar que sí. Medido: el 741 tiene 2 cierres de
   * Nathan Martinez, que en el roster no es del 741.
   *
   * `isInactive` le pregunta al ROSTER, que es quien decide. Y la regla es por
   * dato: el 741 vuelve a activo solo el día que le asignen a alguien.
   */
  const isInactive = (code: string) => data.branches.find((b) => b.branchCode === code)?.isInactive ?? false;

  /*
   * ============================================================================
   * ⚠ LA CELDA DEL MES EN CURSO — el pronóstico, o lo real cuando no hay ninguno
   * ============================================================================
   *
   * Etapa OL3. El pronóstico se atribuye por el branch del ROSTER de cada persona;
   * lo cerrado, por el branch del PRÉSTAMO. Son dos criterios distintos y los dos
   * legítimos -- ya está dicho para las otras columnas.
   *
   * En el mes en curso eso tiene una consecuencia que la primera versión de esta
   * tabla se comió: un branch donde NADIE está rosterizado tiene pronóstico 0, así
   * que su mes en curso salía en 0 y sus cierres reales del mes desaparecían.
   * Medido: AFFINITY cerró 5 en agosto, su YTD de referencia es 31 y la fila
   * sumaba 26. Cinco préstamos reales, borrados por una proyección que nadie pidió.
   *
   * La regla: si hay pronóstico, manda el pronóstico --que YA incluye lo cerrado
   * del mes, así que no se le suma nada--; si no hay, se muestra lo cerrado del
   * mes, que es un piso real y no un pronóstico. Y el tooltip dice siempre las dos
   * lecturas, para que una diferencia entre ellas se vea en vez de deducirse.
   */
  /*
   * Entero, y repartido para que la columna sume el total. Ver
   * `currentMonthByBranch` en el loader: la misma función la usa la tabla de un
   * branch, así que las dos pantallas muestran el mismo número.
   */
  const currentByBranch = currentMonthByBranch(data);
  const currentCell = (b: OutlookData['branches'][number]) => currentByBranch.get(b.branchCode) ?? 0;

  /*
   * La fila de doce meses de cada branch, armada por la misma función.
   *
   * ⚠ CON FILTRO, LA FILA ES LA DE LA ESTRATEGIA, y sale de `strategyRowsOf` --
   * la MISMA función que usa la vista de un branch. No se recalcula acá: dos
   * cálculos del mismo número se separan en el primer arreglo que se haga en uno
   * solo, y nada avisa porque cada uno suma bien por su cuenta.
   *
   * Un branch sin esa estrategia devuelve `null` y su fila sale vacía --no en
   * cero-- porque no tiene esa estrategia, no tiene cero de esa estrategia.
   */
  /* La fila de doce meses de cada branch, armada por la misma función. */
  const rows = data.branches.map((b) => ({
    branch: b,
    year: composeYear(monthsOfYear, currentMonth, b.actualByMonth, currentCell(b), projectBranch(b, remainingMonths)),
  }));

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ DOS BLOQUES, Y LOS INACTIVOS AL FINAL — etapa OL21
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Pedido de Isabella, y la razón es de lectura: un branch que produjo cuatro
   * préstamos en enero y no tiene a nadie desde entonces, puesto entre los que
   * operan, se lee como un branch que anda mal. Puesto aparte se lee como lo que
   * es -- historia.
   *
   * ⚠ SIGUEN SUMANDO AL TOTAL DE LA DIVISIÓN. Separarlos es de presentación, no
   * de cuenta: la fila `Total` recorre `rows`, que son los dos bloques juntos.
   * Si algún día alguien filtra la lista, tiene que filtrar `rows` y no cada
   * bloque, o el total deja de ser el de la división -- que es exactamente el
   * defecto que esta etapa vino a arreglar.
   *
   * El orden DENTRO de cada bloque es el que ya traía el loader (por YTD), así
   * que no se reordena nada: sólo se parte en dos.
   */
  /*
   * ⚠ Y `Recruitment` NO ES NINGUNO DE LOS DOS, así que va en su propio bloque.
   *
   * Cumple la regla de `isInactive` --no tiene ni un productor en el roster-- y
   * aun así llamarlo "Inactive" seria falso: nunca estuvo activo. Es el marcador
   * de la gente en contratación que todavía no tiene branch asignado, así que su
   * fila en cero no es un branch que dejó de producir, es una cola de espera.
   *
   * Meterlo en el bloque `Inactive` lo ponía al lado del 741 --que sí produjo y
   * sí se quedó sin nadie-- y las dos filas se leían como lo mismo.
   */
  const esMarcador = (code: string) => code === RECRUITMENT_BRANCH;
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ⚠ AFFINITY OPERA, ASÍ QUE VA CON LOS ACTIVOS — etapa OL22
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Cumple `isInactive` --no tiene ni una fila en `org.roster_current`-- y aun
   * así llamarlo inactivo es falso: cerró 32 préstamos en ocho meses del año,
   * de enero a agosto, más que nueve de los branches que sí tienen gente. Lo
   * que no tiene es gente PROPIA: su producción la abren dos Account Executives
   * --Shirley Camargo y David Álvarez-- que pertenecen al roster de otros
   * branches.
   *
   * ⚠ ESO LO DISTINGUE DEL 741 Y DEL 771, que también cumplen `isInactive`: esos
   * produjeron y se quedaron sin nadie. AFFINITY nunca tuvo gente propia y sigue
   * produciendo. La regla del roster no alcanza para separarlos, así que la
   * excepción se escribe -- y se escribe con su motivo, no con su nombre.
   */
  const operaSinRoster = (code: string) => code === 'AFFINITY';
  const rowsActivos = rows.filter(
    (r) => (!r.branch.isInactive || operaSinRoster(r.branch.branchCode)) && !esMarcador(r.branch.branchCode)
  );
  const rowsInactivos = rows.filter(
    (r) => r.branch.isInactive && !operaSinRoster(r.branch.branchCode) && !esMarcador(r.branch.branchCode)
  );
  const rowsMarcador = rows.filter((r) => esMarcador(r.branch.branchCode));

  /**
   * El contenido de una celda de mes.
   *
   * ⚠ SÓLO CAMBIA PARA LOS INACTIVOS, y sólo a `null`. Un branch activo sigue
   * mostrando su cero: ahí un cero SÍ es información --estaba y no cerró-- y
   * vaciarlo perdería la diferencia con un mes que todavía no llegó.
   *
   * ⚠ Y NO TOCA `totalByMonth`. El total suma `y.byMonth`, que es el número de
   * verdad; esto es de presentación. Si el total se calculara sobre esto, vaciar
   * una celda haría bajar el total de la división -- y el 741 dejaría de aportar
   * sus 4 cierres, que es justo lo contrario de lo que la etapa vino a hacer.
   */
  const celda = (
    b: OutlookData['branches'][number],
    y: { byMonth: Record<string, number | null> },
    m: string
  ): number | null => {
    const v = y.byMonth[m] ?? null;
    if (!b.isInactive) return v;
    return v === 0 ? null : v;
  };

  /*
   * Los totales de la fila final son la suma de las filas, sin recalcular. El
   * del AÑO se calcula al mostrarlo, sumando lo que se ve -- ver `sumOfShown`.
   */
  const totalByMonth: Record<string, number | null> = {};
  for (const m of monthsOfYear) {
    totalByMonth[m] = rows.reduce((a, r) => a + (r.year.byMonth[m] ?? 0), 0);
  }

  return (
    <div className="hub-container ol-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Outlook</h1>
          <p className="page-head__subtitle">
            {year} month by month — {actualMonths.length} closed, {monthLabel(currentMonth)} forecast,{' '}
            {remainingMonths.length} budgeted
          </p>
        </div>

        {/*
          ⚠ ACA ESTABA LA TARJETA `647 · Total projection` Y SE FUE — etapa OL24.

          La puso OL23 para que la primera pregunta de la pantalla no se
          contestara scrolleando. Estorbaba: 26px en --coral al lado de un titulo
          de 22px, asi que el encabezado se leia como si el numero fuera el
          titulo. Y desde que la fila de totales quedo anclada al fondo del
          viewport, el mismo numero ya esta siempre a la vista sin competir con
          nada -- que era el problema que la tarjeta venia a resolver.
        */}
      </div>

      {/*
        ⚠ LA BARRA, DEBAJO DEL ENCABEZADO — etapa OL25.

        Vivia en el layout, arriba del titulo y con su propia columna de 1600px
        contra los 1380 del contenido: medido, la etiqueta `Project through`
        arrancaba 110px a la izquierda del breadcrumb. Aca hereda la columna del
        contenido y se alinea sola.

        El encabezado queda con titulo y subtitulo, y los controles debajo, que
        es el orden en que se leen: primero que pantalla es, despues que se puede
        hacer con ella.
      */}
      <OutlookTopBar />

      {/*
        ⚠ El aviso dice "no se puede LEER", no "no está aplicado". La diferencia
        importa y costó un rato: el esquema puede estar creado y sembrado --185
        reglas-- y aun así devolver 406, porque PostgREST sólo sirve los schemas
        de "Exposed schemas". Un aviso que dijera "no está aplicado" mandaría a
        alguien a correr un SQL que ya corrió.
      */}
      {!data.diagnostics.outlookTablesAvailable && (
        <div className="bp-notice bp-notice--warn">
          The <code>outlook</code> schema cannot be read, so there are no strategy benchmarks or growth rules and the
          budget columns fall back to the Own Production benchmark. Closed months and the current month are still real.
          If <code>docs/sql/2026-08-outlook-schema.sql</code> has already been applied, what is missing is the step that
          is not SQL: <b>Settings → API → Exposed schemas → add <code>outlook</code></b>.
        </div>
      )}

      {/*
        Producción real con mes posterior al actual: hoy imposible, y si pasara
        la tabla estaría tapándola con el presupuesto. Se avisa en vez de dejar
        que aparezca como una diferencia sin causa.
      */}
      {data.diagnostics.actualsAfterCurrentMonth > 0 && (
        <div className="bp-notice bp-notice--warn">
          <b>{data.diagnostics.actualsAfterCurrentMonth}</b> closed loan(s) have a month later than{' '}
          {monthLabel(currentMonth)}. Those columns are showing the budget, so that real production is not visible.
          Check <code>closing_month</code> before using the year total.
        </div>
      )}

      <div className="tbl-scroll">
        <table className="piv bp-table--los ol-year">
          <thead>
            {/*
              La fila de bandas. `colSpan` sale de la longitud de cada banda, no
              de un número escrito: en enero la banda real es 0 columnas y su
              <th> no se dibuja.
            */}
            <tr className="yr-row">
              <th className="lbl"></th>
              {actualMonths.length > 0 && (
                <th className="bp-center ol-band ol-band--actual" colSpan={actualMonths.length}>
                  Actual — closed
                </th>
              )}
              <th className="bp-center ol-band ol-band--forecast">Forecast</th>
              {remainingMonths.length > 0 && (
                <th className="bp-center ol-band ol-band--budget" colSpan={remainingMonths.length}>
                  Budget
                </th>
              )}
              <th className="bp-center"></th>
            </tr>
            <tr className="mo-row">
              <th className="lbl">Branch</th>
              {monthsOfYear.map((m) => (
                <th key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {monthLabel(m)}
                </th>
              ))}
              <th className="bp-center totcol">{year}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { titulo: null, nota: null, lista: rowsActivos },
              /*
                ⚠ RECRUITMENT VA ANTES QUE LOS INACTIVOS — etapa OL22.
                Estaba al final y se leia como si fuera del mismo grupo. Es lo
                contrario: los inactivos dejaron de producir y esta es gente que
                todavia no empezo. El orden dice de que lado del tiempo esta
                cada bloque.
              */
              {
                titulo: 'Not assigned yet',
                nota: 'people in hiring with no branch decided · they project here until someone assigns them',
                lista: rowsMarcador,
              },
              {
                titulo: 'Inactive',
                nota: 'no active producer on the roster · counts in the division total · nothing to set here',
                lista: rowsInactivos,
              },
            ].map(({ titulo, nota, lista }) => (
              <Fragment key={titulo ?? 'active'}>
                {/*
                  El encabezado del bloque. No se dibuja si el bloque esta vacio:
                  un "Inactive" solo, sin filas debajo, se lee como un error de
                  la pantalla -- y el dia que a los cinco branches les asignen
                  gente, el bloque tiene que desaparecer solo.
                */}
                {titulo !== null && lista.length > 0 && (
                  <tr className="ol-acc">
                    <td colSpan={monthsOfYear.length + 2}>
                      {/*
                        ⚠ UN `button` Y NO UN `div` CON `onClick`: es un control
                        que abre y cierra, así que tiene que llegarle al teclado
                        y decirle a un lector de pantalla en qué estado está.
                        `aria-expanded` es la mitad de eso.
                      */}
                      <button
                        type="button"
                        className="ol-acc__bar"
                        aria-expanded={bloquesAbiertos.has(titulo)}
                        onClick={() => alternarBloque(titulo)}
                        title={nota ?? undefined}
                      >
                        <span className="ol-acc__caret" aria-hidden="true">
                          {bloquesAbiertos.has(titulo) ? '▾' : '▸'}
                        </span>
                        <span className="ol-acc__lbl">{titulo}</span>
                        <span className="ol-acc__count">
                          {lista.length} {titulo === 'Inactive' ? 'inactive branches / out of division' : 'in hiring'}
                          {' — click to '}
                          {bloquesAbiertos.has(titulo) ? 'collapse' : 'expand'}
                        </span>
                        {/*
                          ⚠ EL SUBTOTAL, AUNQUE ESTÉ CERRADO. Sin esto, cerrar el
                          bloque haría que la suma de las filas visibles no diera
                          el total de la división y nada lo explicaría -- el
                          descuadre sin causa que el módulo evita en todos lados.
                          Sale de las MISMAS filas que suman al total, no de una
                          cuenta aparte.
                        */}
                        <span className="ol-acc__sub">
                          {fmt(
                            sumOfShown(
                              monthsOfYear.map((m) => lista.reduce((a, r) => a + (r.year.byMonth[m] ?? 0), 0))
                            )
                          )}{' '}
                          in the division total
                        </span>
                      </button>
                    </td>
                  </tr>
                )}
                {(titulo === null || bloquesAbiertos.has(titulo)) &&
                  lista.map(({ branch: b, year: y }) => (
              <Fragment key={b.branchCode}>
              <tr
                className="metric bp-row-link"
                tabIndex={0}
                role="link"
                onClick={() => router.push('/outlook/branch/' + b.branchCode)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.currentTarget.click();
                  }
                }}
              >
                {/*
                  ⚠ ACÁ HABÍA UN "+N SIN ATRIBUIR" Y SE FUE — etapa OL11.

                  Contaba los préstamos cerrados en el branch por gente que no es
                  Loan Officer de la división, para explicar por qué este número
                  no coincide con Commercial Activity. La explicación sigue
                  haciendo falta, pero no acá: en una lista de dieciséis branches
                  son dieciséis etiquetas compitiendo con el código, y la pregunta
                  --"¿por qué el 747 marca 47 y allá 51?"-- se hace mirando UN
                  branch, no la lista.

                  Vive en el subtítulo de la vista del branch, donde además está
                  el otro "+N" con el que se confundía: los cerrados por Loan
                  Officers de OTRO branch.
                */}
                <td
                  className="lbl"
                  title={
                    b.unattributed > 0
                      ? `${b.unattributed} more closed in this branch by people who are not division Loan Officers. ` +
                        `Open the branch to see it broken down.`
                      : undefined
                  }
                >
                  {b.branchCode}
                </td>
                {monthsOfYear.map((m) => (
                  <td
                    key={m}
                    className={
                      /* Sin `.zero`: un cero ya se distingue por ser un 0 y no un numero. */
                      'bp-center ol-m ol-m--' + bandOf(m, currentMonth)
                    }
                    title={
                      m === currentMonth
                        ? isInactive(b.branchCode)
                          ? `No forecast: nobody has this branch on their roster, and the month's forecast is charged ` +
                            `to each person's roster branch. What is shown is what already closed this month ` +
                            `(${b.actualByMonth[currentMonth] ?? 0}) — a real floor, not a forecast.`
                          : `Month forecast: ${b.closedToDate} already closed (per Forecast, by roster) and the rest is ` +
                            `pipeline with its rate. Closings are INSIDE this number, not next to it. Activity counts ` +
                            `${b.actualByMonth[currentMonth] ?? 0} closing(s) in this branch this month, attributed by ` +
                            `loan — the two criteria differ and both are legitimate.`
                        : m > currentMonth && isInactive(b.branchCode)
                          ? `${b.branchCode} does not project: no Loan Officer has this branch on their roster. Its ` +
                            `${b.ytd} closings this year are real; the projection is charged to each person's roster ` +
                            `branch. Who owns this budget is still to be decided.`
                          : undefined
                    }
                  >
                    {/*
                      ⚠ VACÍO Y NO CERO en un branch inactivo — etapa OL21.

                      Un cero afirmaría que el branch estaba y no cerró nada. No
                      estaba: no tiene a nadie asignado. Los meses en que SÍ
                      produjo muestran su número, que es la parte que importa --
                      el 741 muestra 2 en enero y 2 en febrero, y el resto vacío.

                      Es la misma distinción que el módulo usa en todas partes:
                      cero es una decisión, vacío es que no hay ninguna.
                    */}
                    {fmt(celda(b, y, m))}
                  </td>
                ))}
                <td className="bp-center totcol">
                  {/* La suma de lo MOSTRADO -- ver `sumOfShown`. */}
                  {fmt(sumOfShown(monthsOfYear.map((m) => celda(b, y, m))))}
                  {/*
                    ⚠ DECÍA "no LOs assigned" Y AHORA DICE "Inactive" — OL21.

                    El texto viejo describía la CAUSA --nadie asignado-- y lo que
                    hace falta leer de un tirón es el ESTADO. La causa sigue
                    estando, en el tooltip de la celda y en el bloque en el que
                    la fila vive.
                  */}
                  {/*
                    ⚠ TRES ESTADOS Y NO DOS — etapa OL22. `isInactive` es una
                    sola pregunta al roster, pero contesta lo mismo para cosas
                    distintas: el 741 se quedo sin nadie, AFFINITY nunca tuvo
                    gente propia y sigue produciendo, y Recruitment es una cola
                    de espera. Una etiqueta unica los nombraria igual.
                  */}
                  {isInactive(b.branchCode) && !esMarcador(b.branchCode) && (
                    <span className="bp-muted ol-tag">
                      {/*
                        ⚠ AFFINITY YA NO LLEVA NOTA — etapa OL25. Ver el branch:
                        la nota repetia lo que la tabla ya muestra. Aca ademas
                        AFFINITY esta en el bloque de activos, asi que no
                        necesita ninguna etiqueta -- opera como los demas.
                      */}
                      {operaSinRoster(b.branchCode) ? '' : 'Inactive'}
                    </span>
                  )}
                </td>
              </tr>
              </Fragment>
                ))}
              </Fragment>
            ))}
            {/*
              ⚠ LA FILA DE TOTALES SE ANCLA AL FONDO — etapa OL23.

              El `sticky` va en las CELDAS y no en el `<tr>`: `position: sticky`
              sobre una fila no lo soportan todos los motores, sobre una celda
              sí. Y el contenedor `.tbl-scroll` de esta vista pasa a tener alto
              de viewport, porque un `sticky bottom` pinea al fondo del
              SCROLLPORT: con el contenedor del alto de su contenido, la fila
              habría quedado en su lugar de siempre y el efecto sería ninguno.
            */}
            <tr className="metric ol-total ol-total--pin">
              <td className="lbl">Total</td>
              {monthsOfYear.map((m) => (
                <td key={m} className={'bp-center ol-m ol-m--' + bandOf(m, currentMonth)}>
                  {fmt(totalByMonth[m] ?? null)}
                </td>
              ))}
              <td className="bp-center totcol ol-total__year">
                {fmt(sumOfShown(monthsOfYear.map((m) => totalByMonth[m])))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/*
        ⚠ LA BARRA DE RECLUTAMIENTO SE FUE A LA BARRA DEL MODULO — etapa OL22.
        En OL21 subio del branch a esta vista; ahora sube un escalon mas, al
        layout, para que este tambien dentro de un branch. Y el boton dice el
        estado --cuantos hay en proceso y cuantos con benchmark-- porque esas
        quince personas viven repartidas en cuatro branches y no habia forma de
        saber que existian sin recorrerlos.
      */}

      {/*
        ⚠ ACÁ HABÍA UN PÁRRAFO LARGO, Y SE FUE A PROPÓSITO — etapa OL6.
      
        Explicaba la jerarquía, la excepción del mes en curso, cómo se atribuye
        cada cosa y qué significa cada modo. Ocupaba más alto que la tabla que
        venía a explicar.
      
        Lo que decía no se perdió: vive donde se busca cuando hace falta.
          · el detalle del cálculo de cada celda, en su tooltip
          · el motivo de un branch que no proyecta, en `sin LO asignados` y en
            su tooltip
          · el porqué de cada regla, en las cabeceras de `lib/outlook/*.ts`
      
        Si algo de la tabla necesita un párrafo para entenderse, el problema
        está en la tabla.
      */}

      {/*
        ══════════════════════════════════════════════════════════════════════
        ⚠ ACÁ HABÍA CINCO RENGLONES DE DIAGNÓSTICO Y SE FUERON — etapa OL22
        ══════════════════════════════════════════════════════════════════════

        Decían las bandas, las filas leídas contra las contadas, los benchmarks
        y reglas cargados, las dos lecturas del mes en curso, los productores
        del roster y los cierres sin resolver. Cinco líneas debajo de la tabla,
        que sólo se leen la primera vez.

        Es el criterio de RPT4 y el mismo que ya vació este pie en OL6 y OL12:
        si algo necesita cinco renglones para explicarse, no va en la pantalla.

        ⚠ DÓNDE VIVE AHORA CADA COSA, porque no se perdió ninguna:

          las bandas            en la fila de cabecera de la tabla, que las
                                rotula y las separa con una línea
          desde cuándo rigen    en el editor, que lo dice al guardar
          los dos conteos del   en el tooltip de la celda del mes en curso, que
          mes en curso          dice siempre las dos lecturas
          los sin resolver      en la fila `LO out of branch` de cada branch y en
                                `outOfDivision`, CON NOMBRE -- que es más útil
                                que el conteo, y desde OL21 además ya no son "no
                                contados": suman al total de la división
          los productores y     en `data.diagnostics`, para quien lo mire desde
          las filas leídas      el código; ninguna decisión de la pantalla
                                depende de esos números

        ⚠ Lo único que NO se puede mirar en un tooltip es el estado del
        reclutamiento, así que ese subió al botón de la barra:
        `15 in process · 0 with target`.
      */}
    </div>
  );
}
