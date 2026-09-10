'use client';

/**
 * ============================================================================
 * EL ANFITRIÓN DE LA MÁSCARA
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * Separa DOS cosas que el layout raíz no puede hacer juntas:
 *
 *   · leer los datos de la revisión, que necesita hooks de cliente;
 *   · quedar montado al cruzar de módulo, que necesita el layout raíz.
 *
 * El layout raíz es un componente de SERVIDOR --lee los claims con
 * `getServerClient`-- así que no puede llamar hooks. Éste es el pedazo de
 * cliente que va adentro.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NO CONSULTA NADA SI LA PERSONA NO PUEDE TENER UNA REVISIÓN
 * ---------------------------------------------------------------------------
 * Está en el layout raíz, así que se monta en las CUATRO pantallas del portal y
 * para todo el mundo. Sin este corte, cada carga de cualquier página del portal
 * dispararía cuatro consultas a `review` para las 97 personas que no son del BP
 * Team — y las cuatro devolverían cero filas por RLS, que es la forma más caras
 * de no hacer nada.
 *
 * El corte lo decide el SERVIDOR y llega por prop: `puedeRevisar`. Se resuelve
 * con el claim, que es el mismo dato que ya se lee para el header.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { cerrarSesion, guardarPaso, moverCursor } from '@/lib/review/actions';
import { sameStep } from '@/lib/review/progress';
import {
  requiereDecisionDeFunnel,
  stepArrows,
  stepOpenEditor,
  stepTarget,
} from '@/lib/review/gates';
import ReviewArrow from './ReviewArrow';
import { buscarBranches, rutaDelModulo } from '@/lib/review/branches';
import { useReviewTarget } from '@/lib/review/useReviewTarget';
import { useReview } from './ReviewProvider';
import ReviewMask from './ReviewMask';
import ReviewStepPanel from './ReviewStepPanel';
import ReviewSummary from './ReviewSummary';

/*
 * ⚠ SIN PROPS. `puedeRevisar` se movió al proveedor, que es quién consulta:
 * dejarlo acá también habría sido la misma decisión en dos lugares.
 */
export default function ReviewMaskHost() {
  const { script, recorriendo, recargar, salirDeLaRevision, habilitado } = useReview();
  const pathname = usePathname();
  const router = useRouter();

  /*
   * ⚠ UNA SOLA LECTURA DE «CUÁL ES LA REVISIÓN EN CURSO».
   *
   * Había tres `find` idénticos --el lugar del paso, el funnel de la fase 3 y el
   * render-- y son tres cálculos del mismo hecho, libres de divergir. Es el
   * mismo criterio que hizo derivar el avance en vez de guardarlo.
   *
   * `myReviews` y no `reviews`: la sesión en curso que importa es LA PROPIA. Con
   * la lista completa, quien tiene `review_admin` veía la barra de la revisión
   * de otra persona.
   */
  /*
   * ⚠ `recorriendo` Y NO «la en curso de myReviews» — etapa RV5.
   *
   * La diferencia es `Save and exit`: la sesión sigue `in_progress` --como debe,
   * cerrarla es `Finish`-- y aun así la máscara tiene que soltarse. Buscarla acá
   * era lo que hacía que el botón no hiciera nada visible.
   */
  const activo = recorriendo;
  /* A quién se revisa. Sale de la única lectura de arriba. */
  const loEnCurso = activo?.session?.lo_employee_key ?? null;

  const [branchesDelLo, setBranchesDelLo] = useState<string[]>([]);
  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (loEnCurso === null) {
        if (!cancelado) setBranchesDelLo([]);
        return;
      }
      const codigos = await buscarBranches(loEnCurso);
      if (!cancelado) setBranchesDelLo(codigos);
    })();
    return () => {
      cancelado = true;
    };
  }, [loEnCurso]);


  /*
   * ══════════════════════════════════════════════════════════════════════
   * EL LUGAR DEL PASO — etapa RV2, punto 3
   * ══════════════════════════════════════════════════════════════════════
   *
   * El desplazamiento y el resaltado viven ACÁ y no en el panel, y por una
   * razón concreta: el panel se REMONTA en cada cambio de paso --se lo pide su
   * `key`-- y un efecto que se desmonta le saca el resaltado a la sección justo
   * cuando la está poniendo. El anfitrión no se desmonta nunca; su efecto
   * vuelve a correr porque el selector cambia, que es lo que hace falta.
   *
   * ⚠ Los hooks se llaman ANTES del corte por `habilitado`: llamarlos
   * condicionalmente rompe el orden de hooks de React. Sin sesión el selector
   * es `null` y el hook no hace nada.
   */
  /*
   * ⚠ TRES ESTADOS, Y EL TERCERO HACÍA FALTA — RV7.
   *
   * Arrancaba en `null`, que es exactamente lo que significa «no tiene funnel».
   * Con el lugar del paso ahora atado a ese estado, la primera lectura mandaba
   * al catálogo a alguien que ya tenía uno.
   *
   *   `undefined` = todavía no se leyó
   *   `null`      = se leyó y no tiene
   *   string      = el nombre del funnel activo
   *
   * Es la misma distinción de siempre --no vino no es vino vacío-- y la que
   * `useReviewTarget` ya hace con `enSitio`.
   */
  const [funnelActual, setFunnelActual] = useState<string | null | undefined>(undefined);
  const [tickFunnel, setTickFunnel] = useState(0);
  /*
   * ⚠ CUÁNTO TRABAJO TIENE EL PLAN, para poder decir qué se pierde al cambiarlo.
   *
   * `undefined` = no se leyó todavía, y es la misma distinción de siempre: un
   * «cero pasos hechos» dicho antes de leer sería una mentira tranquilizadora
   * justo en la pantalla que ofrece destruirlos.
   */
  /*
   * ⚠ Y LA CLAVE DEL ENROLAMIENTO VIAJA CON EL CONTEO, no aparte — RV12.
   *
   * El número que se dice --«borra 2 pasos hechos»-- y el plan que se va a
   * cancelar tienen que salir de la MISMA lectura: dos consultas del mismo dato
   * pueden diferir, y ésta es la que autoriza un borrado. Es la misma razón por
   * la que el catálogo saca `doneCount` del mismo hook que muestra el plan.
   */
  const [pasosDelPlan, setPasosDelPlan] = useState<
    { hechos: number; total: number; enrollmentKey: number } | undefined
  >(undefined);

  const pasoActual =
    script && activo?.session
      ? script.steps.find((s) =>
          sameStep(s, {
            phase_no: activo.session!.current_phase,
            step_in_phase: activo.session!.current_step_in_phase,
          })
        ) ?? null
      : null;

  /*
   * ══════════════════════════════════════════════════════════════════
   * LAS FLECHAS DEL PASO, Y EL OK INTERMEDIO — etapa RV14
   * ══════════════════════════════════════════════════════════════════
   *
   * `arrows` es un arreglo, así que el sub-paso no es un mecanismo aparte: es
   * el índice dentro del arreglo. Con una sola flecha no hay OK y no hay nada
   * que avanzar; con dos, la primera lo ofrece.
   *
   * ⚠ EL ÍNDICE NO SE GUARDA, y es deliberado. Un sub-paso persistido sería un
   * cursor dentro de un cursor --hoy el cursor son dos columnas-- y tendría
   * tres estados que mantener: «no llegué», «llegué y no confirmé»,
   * «confirmé». Y sobre todo: el OK no es evidencia de nada. La evidencia del
   * paso es el comentario y la fila del presupuesto; esto es un movimiento de
   * atención, y al retomar la sesión que la flecha vuelva al primer ancla
   * cuesta dos segundos de relectura y nunca está mal.
   *
   * ⚠ SE REINICIA AL CAMBIAR DE PASO, Y SE DERIVA -- no se copia con un
   * efecto. El índice se guarda JUNTO A LA CLAVE DEL PASO en el que se avanzó,
   * así que si la clave actual no es ésa, el índice vale 0 sin que nadie tenga
   * que ponerlo en cero.
   *
   * La primera versión era `useEffect(() => setFlechaIdx(0), [clave])` y eslint
   * la rechazó con la regla que este archivo ya documenta más arriba: un
   * `setState` sincrónico en un efecto dispara renders en cascada, y este
   * componente vive en el layout raíz -- ese costo lo paga todo el portal.
   *
   * Y el reinicio importa: entrar a un paso de una flecha después de haber
   * avanzado en otro de dos dejaría el índice en 1 y no se dibujaría ninguna.
   * La flecha desaparecería sin que nada falle, que es el defecto que este
   * repo lleva persiguiendo toda la serie.
   */
  const flechas = pasoActual === null ? [] : stepArrows(pasoActual, activo?.session?.lo_employee_key);
  const claveDelPaso =
    pasoActual === null ? null : pasoActual.phase_no + ':' + pasoActual.step_in_phase;
  const [avance, setAvance] = useState<{ clave: string | null; idx: number }>({
    clave: null,
    idx: 0,
  });
  const flechaIdx = avance.clave === claveDelPaso ? avance.idx : 0;
  const flechaActual = flechas[Math.min(flechaIdx, Math.max(0, flechas.length - 1))] ?? null;

  /*
   * ⚠ EL LUGAR DEPENDE DE SI LA ACCIÓN ESTÁ HECHA. Sin funnel, el paso 3.1 se
   * hace en el catálogo; con funnel, se confirma en el perfil. Ver `stepTarget`.
   *
   * Y `=== null` estricto: con `undefined` --todavía sin leer-- manda el lugar
   * de siempre, que es donde la máscara deja a la persona.
   */
  const accionPendiente =
    pasoActual !== null && requiereDecisionDeFunnel(pasoActual) && funnelActual === null;
  const selectorDelPaso = pasoActual ? stepTarget(pasoActual, accionPendiente) : null;

  /*
   * ⚠ EL LUGAR ES LA SECCIÓN *Y* LA PERSONA.
   *
   * `gate_config.target` es un selector de sección --`.bp-chart-card`-- y esa
   * clase existe en el perfil de CUALQUIER Loan Officer: es la misma pantalla
   * con otros datos. Medido: con sólo el selector, estando en el perfil de Jose
   * Arango el panel ofrecía el campo de comentario del paso de Adriana.
   *
   * Así que el lugar es la sección, en la pantalla del módulo de la fase, de la
   * persona que se revisa. Y `startsWith` para los sub-caminos del perfil
   * --`/plan`, `/funnel`--, que son parte de la misma revisión.
   */
  const branchPrincipal = branchesDelLo.length > 0 ? branchesDelLo[0] : null;
  /*
   * ⚠ LA RUTA NO SE SABE TODAVÍA es distinto de «es /outlook». Mientras la fase
   * apunte a Outlook y el branch no haya llegado, `rutaDelPaso` queda en `''` y
   * el panel NO ofrece link: uno que lleva a la lista en vez del branch es peor
   * que ninguno, porque parece correcto.
   */
  const faseDelPaso = activo?.session
    ? script?.phases.find((f) => f.phase_no === activo.session!.current_phase)?.module ?? ''
    : '';
  const rutaSinResolver = faseDelPaso === 'outlook' && branchPrincipal === null;
  const rutaDelPaso = activo?.session && !rutaSinResolver
    ? rutaDelModulo(
        script?.phases.find((f) => f.phase_no === activo.session!.current_phase)?.module ?? '',
        activo.session.lo_employee_key,
        branchPrincipal
      )
    : '';
  const enRuta =
    rutaDelPaso !== '' && (pathname === rutaDelPaso || pathname.startsWith(rutaDelPaso + '/'));

  /* Fuera de la ruta no se busca nada: sin esto el efecto resaltaría la sección
     homónima del perfil de otra persona, que es peor que no resaltar. */
  const { enSitio: enSitioDom, buscando: buscandoDom } = useReviewTarget(
    enRuta ? selectorDelPaso : null,
    pathname
  );
  /*
   * `false` fuera de la ruta. `null` sólo cuando estamos en la ruta y el paso NO
   * declara lugar -- que es «no hay requisito», y sigue siendo distinto de «hay
   * lugar y no es acá».
   */
  const enSitio = enRuta ? enSitioDom : false;

  /*
   * ══════════════════════════════════════════════════════════════════
   * EL EDITOR QUE EL PASO PIDE ABIERTO — etapa RV4, punto 3
   * ══════════════════════════════════════════════════════════════════
   *
   * Viaja POR LA URL y no por un contexto compartido, y es deliberado:
   *
   *   · la pantalla de Outlook no tiene que importar nada de la revisión para
   *     obedecerlo -- lee un parámetro, como cualquier pantalla;
   *   · sobrevive a una recarga, que es donde se pierden los estados en memoria
   *     (el agujero que tenían los clics del paso 4);
   *   · y se puede verificar desde afuera mirando la barra de direcciones.
   *
   * `replace` y no `push`: agregar una entrada al historial por abrir un editor
   * haría que el botón de atrás del navegador «cierre el editor» en vez de
   * volver a la pantalla anterior.
   */
  const editorDelPaso = pasoActual ? stepOpenEditor(pasoActual) : null;
  useEffect(() => {
    if (!enRuta || editorDelPaso === null || loEnCurso === null) return;
    const actual = new URLSearchParams(window.location.search);
    if (actual.get('rvOpen') === editorDelPaso && actual.get('rvLo') === String(loEnCurso)) return;
    actual.set('rvOpen', editorDelPaso);
    actual.set('rvLo', String(loEnCurso));
    router.replace(pathname + '?' + actual.toString());
  }, [enRuta, editorDelPaso, loEnCurso, pathname, router]);


  /*
   * ══════════════════════════════════════════════════════════════════
   * ⚠ EL PRESUPUESTO SE COMPRUEBA, NO SE DECLARA — etapa RV4, punto 5
   * ══════════════════════════════════════════════════════════════════
   *
   * Había una casilla: «I saved the budget for X in Outlook». Una casilla que uno
   * se marca a sí mismo no verifica nada -- aparenta ser una compuerta y no lo
   * es, igual que el círculo que parecía un check.
   *
   * La evidencia es una FILA NUEVA en cualquiera de las tablas donde vive el
   * presupuesto de una persona, escrita después de que arrancó la sesión.
   * Todas son append-only y tienen `created_at`, así que «durante esta sesión»
   * es `created_at >= session.started_at`. Cualquiera alcanza: el editor
   * guarda lo que cambió, y pedir todas obligaría a tocar cosas que no hacía
   * falta tocar.
   *
   * ══════════════════════════════════════════════════════════════════
   * ⚠ LA COMPUERTA ESPERABA EN TABLAS DONDE YA NADIE ESCRIBE
   * ══════════════════════════════════════════════════════════════════
   *
   * Isabella quedó trabada: guardaba el presupuesto, la compuerta no lo
   * reconocía, y la revisión no avanzaba. Medido cuando pasó:
   *
   *   person_budget_breakdown   12 filas · la última, minutos antes
   *   person_budget_total        8 filas · la última, minutos antes
   *   growth_rule              190 filas · la última, del día anterior
   *   monthly_target            19 filas · la última, del día anterior
   *   strategy_benchmark         2 filas · la última, del 1 de septiembre
   *
   * OL26 movió el presupuesto a `person_budget_*` y la compuerta siguió
   * mirando las tres viejas. El editor escribía, la fila aparecía, y la
   * consulta la buscaba en otro lado. Nada falló: es el mismo patrón que
   * `open_editor: 'Own Production'` -- el camino sigue existiendo y lo que
   * cambia es dónde termina.
   *
   * ⚠ Y SE MIRA EL DESGLOSE, NO SÓLO EL TOTAL, y eso es a propósito: la etapa
   * OL26g convierte el total en un valor DERIVADO --la suma de las celdas del
   * desglose-- así que `person_budget_total` puede dejar de recibir filas.
   * `person_budget_breakdown` se escribe en los dos modelos. Arreglar esto
   * mirando sólo el total habría vuelto a romper la compuerta en la etapa
   * siguiente, que es el defecto que vino a arreglar.
   *
   *   outlook.person_budget_breakdown   el desglose por bucket   ← OL26
   *   outlook.person_budget_total       el total                 ← OL26
   *   outlook.strategy_benchmark        el benchmark de la estrategia
   *   outlook.growth_rule               la regla de crecimiento
   *   outlook.monthly_target            los meses uno por uno
   *
   * Las tres viejas se quedan como respaldo y no se borran: siguen recibiendo
   * escrituras --`growth_rule` tenía 190 filas, la última del día anterior--
   * y alguien puede proyectar por regla de crecimiento sin tocar el desglose.
   *
   * ⚠ Y UN RESPALDO QUE NO PUEDE DISPARARSE NO ES UN RESPALDO:
   * `strategy_benchmark` tiene 2 filas y NINGUNA con `employee_key`, así que
   * ese brazo nunca se cumplió para una persona. Se deja porque la columna
   * existe y mañana puede llenarse, pero queda dicho para que nadie lo cuente
   * como cobertura.
   *
   * ⚠ SE RECONSULTA CADA 4s MIENTRAS EL PASO ESTÉ ABIERTO. El guardado ocurre en
   * OTRO componente --el editor de Outlook-- y el botón del panel está apagado
   * hasta que la fila aparece, así que sin reconsultar la persona guardaría y no
   * pasaría nada. Se corta al salir del paso.
   *
   * ⚠ Y SI EL PRESUPUESTO YA ESTABA BIEN Y NO HAY QUE CAMBIARLO: el botón del
   * editor dice «Confirm as reviewed» y escribe una revisión de
   * `person_budget_total` con autor y fecha que NO FIJA NINGÚN NÚMERO
   * --`confirmed_only`, `total` nulo, etapa RV15--. Para esta consulta es una
   * fila como cualquier otra, que es todo lo que pide; para la proyección no
   * existe, así que confirmar no le cambia el gobierno a nadie. Es más de lo
   * que daba la casilla, no menos.
   */
  const [presupuestoGuardado, setPresupuestoGuardado] = useState(false);
  const pidePresupuesto = pasoActual?.gate_kind === 'budget';
  const arranco = activo?.session?.started_at ?? null;
  useEffect(() => {
    if (!pidePresupuesto || loEnCurso === null || arranco === null) return;
    let vivo = true;
    const mirar = async () => {
      const ol = getSupabaseClient().schema('outlook');
      /* La misma consulta cinco veces: una fila, de esta persona, escrita
         después de que arrancó la sesión. Lo único que cambia es la tabla. */
      const enEstaSesion = (tabla: string) =>
        ol
          .from(tabla)
          .select('created_at')
          .eq('employee_key', loEnCurso)
          .gte('created_at', arranco)
          .limit(1);
      const tablas = [
        /* Primero las de OL26, que son donde escribe el editor de hoy. */
        'person_budget_breakdown',
        'person_budget_total',
        /* Y las tres viejas, como respaldo. */
        'strategy_benchmark',
        'growth_rule',
        'monthly_target',
      ];
      const res = await Promise.all(tablas.map(enEstaSesion));
      if (!vivo) return;
      /*
       * ⚠ UN ERROR NO ES UN «NO HAY».
       *
       * Con `data?.length ?? 0` una consulta que falla --una tabla renombrada,
       * una policy que cambió-- se lee igual que «la persona no guardó», y la
       * compuerta se traba sin decir por qué. Es justo lo que acaba de pasar,
       * pero por otra causa. Si alguna falla, se avisa en consola: la compuerta
       * sigue cerrada, y queda el rastro de que fue un error y no una ausencia.
       */
      const fallidas = res
        .map((r, i) => (r.error ? tablas[i] + ': ' + r.error.message : null))
        .filter((x): x is string => x !== null);
      if (fallidas.length > 0) {
        console.warn('[review] la compuerta del presupuesto no pudo leer: ' + fallidas.join(' | '));
      }
      setPresupuestoGuardado(res.some((r) => (r.data?.length ?? 0) > 0));
    };
    mirar();
    const timer = setInterval(mirar, 4000);
    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, [pidePresupuesto, loEnCurso, arranco]);

  /*
   * Fuera de la ruta NO se busca nada, así que ahí no hay espera: el aviso de
   * «andate al paso» sale enseguida, que es lo correcto -- en esa pantalla no
   * hay nada que hacer. La espera existe sólo estando en la ruta.
   */
  const buscandoSitio = enRuta && buscandoDom;

  /*
   * ═══════════════════════════════════════════════════════════════
   * ⚠ LA BARRA NO AVISA QUE UN MÓDULO ESTÁ CARGANDO, Y ES DELIBERADO
   * ═══════════════════════════════════════════════════════════════
   *
   * Acá había un aviso, y se sacó: el módulo ya muestra su propio `Loading...`,
   * así que un segundo aviso es UNA SEGUNDA FUENTE PARA EL MISMO HECHO. Y ya
   * sabemos cómo termina eso -- las dos discrepan, y la de la barra miente
   * porque mide otra cosa.
   *
   * Medído: el que estaba se encendía al cambiar la ruta y se apagaba en el
   * cuadro siguiente, pero el módulo tarda SEGUNDOS en traer sus datos. En la
   * captura el perfil decía `Loading...` y la barra no decía nada. Medía el
   * pintado de la ruta, no la llegada de los datos.
   *
   * Y las dos formas de arreglarlo eran peores que no tenerlo: una duración
   * mínima inventa un tiempo, y mirar el indicador propio de cada módulo acopla
   * la máscara a los tres.
   *
   * Si la espera molesta, la respuesta no es avisarla mejor: es que Outlook no
   * traiga 4.800 préstamos al entrar. Eso es una etapa aparte y ya está en la
   * lista.
   */

  /*
   * El funnel activo del Loan Officer revisado, para la fase 3.
   *
   * Se lee ACA y no en el panel porque el panel se remonta al cambiar de paso y
   * volveria a consultar; y se lee solo cuando hay una sesion, que es cuando la
   * pregunta existe. `null` = no tiene funnel, que es uno de los dos casos que
   * la fase 3 tiene que distinguir.
   */
  /* La fase 3 es la que pregunta por el funnel. Fuera de ella no se consulta. */
  const pideFunnel = pasoActual?.phase_no === 3;
  /*
   * ══════════════════════════════════════════════════════════════════
   * EL BENCHMARK VIGENTE, PARA EL PASO 2 — etapa RV3
   * ══════════════════════════════════════════════════════════════════
   *
   * El campo del paso 2 aparecía vacío, así que parecía que no había ninguno
   * --Adriana tenía 1 desde el 21 de agosto--.
   *
   * ⚠ EL ORDEN ES EL MISMO QUE USA EL PERFIL, y eso es lo que importa más que
   * ser teóricamente más correcto: `effective_from` ascendente con `set_at`
   * como desempate, y gana la última. El panel se dibuja ENCIMA del perfil, al
   * lado de ese número; si aplicara otra regla, los dos podrían mostrar
   * distinto y ninguno estaría mal.
   *
   * (La subtileza que eso arrastra, y que es anterior a esta etapa: una fila con
   * `effective_from` futuro gana igual, aunque todavía no esté en vigencia. Hoy
   * no hay ninguna. Cambiarlo es cambiar el número del perfil también, y eso es
   * otra etapa.)
   */
  /*
   * ══════════════════════════════════════════════════════════════════
   * EL BRANCH DEL LOAN OFFICER — etapa RV4, punto 2
   * ══════════════════════════════════════════════════════════════════
   *
   * La fase 2 visita Outlook, y Outlook no tiene una pantalla por persona: tiene
   * una por BRANCH. Mandar a `/outlook` dejaba a Isabella en la lista de las
   * trece, con los targets del paso --`.ol-topbar`, `.ol-editor`-- sin matchear
   * y el panel diciendo «esto se contesta en otra pantalla» estando en Outlook.
   *
   * ⚠ SALE DE `org.employee_branch`, que es la misma fuente que usa el loader
   * del Business Plan para decir «Branch 710» en el perfil. No de una tabla de
   * Outlook: el branch de una persona es del roster, no del presupuesto.
   *
   * ⚠ Y UNA PERSONA PUEDE ESTAR EN VARIOS. `branchCodes` del loader es un array
   * ordenado por eso mismo. Acá se guardan todos y se usa el primero, y el panel
   * lo dice cuando hay más de uno: elegir en silencio sería mandar a una
   * pantalla que puede no ser la que la revisión quiere.
   */
  const [benchmarkActual, setBenchmarkActual] = useState<number | null>(null);
  /* Se relee cuando el panel escribe uno: sin esto, volver al paso 2 mostraria
     el valor viejo, que es la misma clase de mentira que el campo vacio. */
  const [tickBench, setTickBench] = useState(0);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (loEnCurso === null) {
        if (!cancelado) setBenchmarkActual(null);
        return;
      }
      const { data } = await getSupabaseClient()
        .schema('org')
        .from('employee_benchmark')
        .select('monthly_benchmark, effective_from, set_at')
        .eq('employee_key', loEnCurso)
        .order('effective_from', { ascending: true })
        .order('set_at', { ascending: true });
      if (cancelado) return;
      const filas = data ?? [];
      const ultima = filas.length === 0 ? null : filas[filas.length - 1];
      /* `null` si no hay ninguna: no tener benchmark es distinto de tener 0. */
      setBenchmarkActual(ultima === null ? null : Number(ultima.monthly_benchmark));
    })();
    return () => {
      cancelado = true;
    };
  }, [loEnCurso, tickBench]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      /*
       * ⚠ EL `setState` VA ADENTRO DEL ASYNC, no en el cuerpo del efecto.
       *
       * Lo tenía arriba, en el camino de "no hay sesión", y eslint lo marcó con
       * `react-hooks/set-state-in-effect`: un setState sincrónico en un efecto
       * puede disparar renders en cascada. Este componente vive en el layout
       * raíz y se monta en las cuatro pantallas del portal, así que ese costo lo
       * pagaría todo el mundo.
       */
      if (loEnCurso === null) {
        /*
         * ⚠ `undefined` Y NO `null` — ESTA LÍNEA TRABABA LA FASE 3.
         *
         * `loEnCurso === null` significa «todavía no sé a quién se revisa»: la
         * lista de revisiones no llegó. Escribirlo como `null` lo hacía
         * indistinguible de «se leyó y no tiene funnel», así que en CADA carga
         * la secuencia era `undefined → null → valor` -- y ese `null → valor`
         * es justo lo que el efecto de más abajo lee como «el funnel se acaba
         * de activar», así que navegaba.
         *
         * En el catálogo sacaba a la persona de la pantalla donde tenía que
         * elegir. Y en el perfil era un `replace` a la pantalla donde ya
         * estaba: remonta el árbol, reinicia la carga del perfil y vuelve a
         * arrancar la búsqueda de 12s, una vuelta encima de la otra. De ahi el
         * panel diciendo «andate al perfil» DESDE el perfil.
         *
         * Le pasó a Adriana, a Armando y a Ana: tres veces el mismo paso.
         */
        /* Y el conteo se va con el nombre: los dos describen al mismo plan, y
           dejar uno viejo mientras el otro dice «no lo sé» es la ventana que
           esta etapa vino a cerrar. */
        if (!cancelado) {
          setFunnelActual(undefined);
          setPasosDelPlan(undefined);
        }
        return;
      }
      const bp = getSupabaseClient().schema('business_plan');
      const { data } = await bp
        .from('enrollment')
        .select('enrollment_key, funnel_name')
        .eq('employee_key', loEnCurso)
        .eq('status', 'active')
        /* Con `order` y no solo `limit(1)`: hoy el indice unico garantiza uno,
           y la consulta no tiene por que depender de una garantia que vive en
           otro archivo. Es el defecto que `useEnrollment` todavia tiene. */
        .order('activated_at', { ascending: false })
        .limit(1);
      const activo = (data ?? [])[0] ?? null;
      /*
       * ⚠ UN SOLO LUGAR CALCULA EL NOMBRE, y sale de la lectura.
       *
       * Los tres caminos de abajo publican ESTA variable. Que no haya un
       * `null` escrito a mano en ninguno no es estilo: `verificar:estados`
       * prohíbe el literal justamente porque un `null` puesto a mano es una
       * afirmación hecha sin haber leído --«no tiene funnel» dicho cuando lo
       * que pasa es «no sé»--, y eso trabó la fase 3 a tres personas. Derivado
       * de `activo`, el mismo valor significa lo único que puede significar:
       * se leyó, y no hay.
       */
      const nombre = activo?.funnel_name ?? null;

      /*
       * ══════════════════════════════════════════════════════════════
       * ⚠ EL NOMBRE SE PUBLICA JUNTO CON EL CONTEO, NO ANTES — RV12
       * ══════════════════════════════════════════════════════════════
       *
       * Acá había un `setFunnelActual` suelto, dos consultas antes de
       * `setPasosDelPlan`. Los dos salen de la MISMA lectura, pero llegaban a
       * React en momentos distintos, así que entre uno y otro había una ventana
       * en la que el nombre era el nuevo y la clave todavía la vieja.
       *
       * No es teórico: la evidencia del primer cambio ejercido quedó con
       * `funnel_name` del funnel nuevo y `enrollment_key: 96`, que es el
       * enrolamiento que `cancel_funnel` acababa de BORRAR. Una referencia
       * colgada, y encima dentro del registro que existe para poder volver.
       *
       * Publicar los dos al final cuesta que el panel tarde dos consultas más
       * en decir «Done — X is selected». Vale: antes de eso no sabe qué plan
       * es, y decirlo era justamente el error.
       */
      /*
       * ══════════════════════════════════════════════════════════════
       * ⚠ CUÁNTO SE PIERDE SI LO CAMBIAN — etapa RV11
       * ══════════════════════════════════════════════════════════════
       *
       * `change_funnel` cancela y activa otro, y `cancel_funnel` BORRA: el plan,
       * sus nodos, sus milestones y sus notas. Ofrecer «cambiarlo» sin decir
       * cuánto trabajo se tira es ofrecer una puerta callando lo que hay del
       * otro lado.
       *
       * ⚠ ES EL TERCER LUGAR QUE CUENTA MILESTONES --están `doneCount` en el
       * catálogo y `doneMilestones` en `loadData`-- y no se reusa ninguno a
       * propósito: `loadData` trae el branch entero, y esta máscara vive en el
       * layout raíz, o sea en las cuatro pantallas del portal. Lo que SÍ es
       * común es la definición de «completado»: `status = 'completed'`. Si eso
       * cambia, cambian los tres.
       */
      if (activo === null) {
        if (!cancelado) {
          setFunnelActual(nombre);
          setPasosDelPlan(undefined);
        }
        return;
      }
      const { data: nodos } = await bp
        .from('enrollment_node')
        .select('enrollment_node_key')
        .eq('enrollment_key', activo.enrollment_key);
      const claves = ((nodos ?? []) as { enrollment_node_key: number }[]).map(
        (x) => x.enrollment_node_key
      );
      if (claves.length === 0) {
        if (!cancelado) {
          setFunnelActual(nombre);
          setPasosDelPlan({ hechos: 0, total: 0, enrollmentKey: activo.enrollment_key });
        }
        return;
      }
      const { data: hitos } = await bp
        .from('enrollment_milestone')
        .select('status')
        .in('enrollment_node_key', claves);
      const filas = (hitos ?? []) as { status: string }[];
      if (!cancelado) {
        setFunnelActual(nombre);
        setPasosDelPlan({
          hechos: filas.filter((m) => m.status === 'completed').length,
          total: filas.length,
          enrollmentKey: activo.enrollment_key,
        });
      }
    })();
    return () => {
      cancelado = true;
    };
    /*
     * ⚠ `pideFunnel` EN LAS DEPENDENCIAS, Y UN TICK QUE LO REPITE.
     *
     * Con sólo `[loEnCurso]` esto se leía UNA vez, y `loEnCurso` no cambia al
     * activar un funnel: después de elegirlo el panel seguía diciendo «no tiene
     * funnel activo» hasta una recarga completa. La activación ocurre en OTRA
     * pantalla --la del catálogo-- así que acá no hay evento que avise.
     *
     * Es el mismo caso que el presupuesto del paso 2.2, y la misma respuesta:
     * mientras el paso que necesita el dato esté abierto, se vuelve a preguntar.
     */
  }, [loEnCurso, pideFunnel, tickFunnel]);

  /*
   * El tick, sólo mientras la fase 3 esté en curso. Fuera de ella no se
   * pregunta nada: el dato no lo usa nadie.
   */
  useEffect(() => {
    if (!pideFunnel) return;
    const t = setInterval(() => setTickFunnel((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [pideFunnel]);

  /*
   * ══════════════════════════════════════════════════════════════════════
   * ⚠ ACÁ VIVÍA EL RETORNO AUTOMÁTICO, Y SE FUE EN RV10
   * ═════════════════════════════════════════════════════════════════════
   *
   * RV5 lo puso para que elegir el funnel no dejara a la persona en una
   * pantalla sin campo, y RV8 lo convirtió en una navegación DURA porque los
   * datos del Business Plan quedaban rancios. Las dos razones se fueron con el
   * flujo nuevo:
   *
   *   · el paso ya no se contesta en el perfil, así que no hay a dónde volver;
   *   · `activate_funnel` deja a la persona en `/plan?activated=1`, que es
   *     exactamente donde el paso 6 del brief la quiere. La última pantalla es
   *     el plan, y para eso alcanza con NO navegar.
   *
   * ⚠ Y HABRÍA BORRADO EL COMENTARIO. Una navegación dura es una carga
   * completa, y el comentario que se escribe en el catálogo vive en el estado
   * del panel: volver al perfil así se llevaba puesto justo lo que el paso 4
   * vino a registrar. Dejarlo «por si acaso» no era neutral.
   *
   * Lo que ocupa su lugar es la pantalla de confirmación del panel, que se
   * dibuja donde la persona esté.
   */

  /*
   * ⚠ EL RESUMEN ES UN ESTADO DE LA MÁSCARA, no una ruta.
   *
   * Aparece encima de la pantalla del módulo igual que el panel, y por el mismo
   * motivo: la revisión guía sobre lo que se está mirando, no lo reemplaza. Una
   * ruta propia dejaría el último paso lejos de los números que lo justifican.
   */
  const [enResumen, setEnResumen] = useState(false);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);

  /*
   * ══════════════════════════════════════════════════════════════════════
   * EL RELLENO AL PIE — etapa RV17
   * ══════════════════════════════════════════════════════════════════════
   *
   * El panel es `position: fixed` abajo a la derecha, así que tapa lo último de
   * la página y no hay forma de desplazarse más: el documento se termina antes.
   * Isabella pidió que la página deje ese espacio.
   *
   * Se resuelve AGREGANDO ESPACIO al final del contenido y no moviendo el
   * panel: `--rv-relleno` se publica en el `<html>` y `review.css` la consume
   * como `padding-bottom` de `.hub-canvas`. Con eso el scroll llega más abajo y
   * lo último de la página puede quedar por encima del panel.
   *
   * ⚠ EL ALTO NO SE PUEDE CLAVAR. El panel crece con el prompt del paso, con el
   * aviso de la compuerta, con el campo de comentario abierto o cerrado y con
   * la lista de clics del 1.4. Un número fijo queda corto justo en los pasos
   * que más dicen, que son los que más tapan. Así que se MIDE con un
   * `ResizeObserver` sobre el propio panel.
   *
   * ⚠ Y SE MIDE LA BANDA, NO EL ALTO: `innerHeight - top` incluye los 18px de
   * `bottom` que el panel tiene en CSS. Sumar el alto y volver a escribir el 18
   * acá sería la misma constante en dos lugares, libre de divergir en cuanto
   * alguien mueva el panel.
   *
   * ⚠ NO PASA POR ESTADO DE REACT, y no es por gusto: un `setState` en un
   * efecto dispara renders en cascada --la regla que este archivo ya se comió
   * una vez-- y acá el anfitrión vive en el layout raíz, así que ese costo lo
   * paga todo el portal. La medida va directo a una custom property, que es
   * justo lo que el CSS necesita.
   *
   * ⚠ Y SIN PANEL NO HAY RELLENO: la property se saca al desmontar, así que sin
   * sesión el `padding-bottom` de `.hub-canvas` vuelve a `0px` por el valor de
   * respaldo de `var()`. No queda un rastro que ocupe espacio en la app normal.
   */
  const hayPanel = Boolean(script && activo?.session && !enResumen);
  useEffect(() => {
    const raiz = document.documentElement;
    if (!hayPanel) {
      raiz.style.removeProperty('--rv-relleno');
      return;
    }
    const panel = document.querySelector('.rv-panel');
    if (panel === null) {
      raiz.style.removeProperty('--rv-relleno');
      return;
    }
    const AIRE = 12;
    const medir = () => {
      const banda = window.innerHeight - panel.getBoundingClientRect().top + AIRE;
      raiz.style.setProperty('--rv-relleno', Math.max(0, Math.ceil(banda)) + 'px');
    };
    medir();
    /* El observer cubre el resize de la ventana además del crecimiento del
       panel: su `max-height` es `70vh`, así que la ventana lo cambia de alto y
       eso llega como un cambio de tamaño del elemento. */
    const ro = new ResizeObserver(medir);
    ro.observe(panel);
    return () => {
      ro.disconnect();
      raiz.style.removeProperty('--rv-relleno');
    };
    /* `claveDelPaso` está en las dependencias porque el panel se REMONTA en
       cada paso --se lo pide su `key`-- y el elemento observado deja de existir:
       sin esto el observer quedaría mirando un nodo huérfano y el relleno se
       congelaría en el alto del paso anterior. */
  }, [hayPanel, claveDelPaso]);

  /*
   * ══════════════════════════════════════════════════════════════════════
   * ¿LA BARRA ESTÁ TAPANDO ALGO QUE MINIMIZAR MOSTRARÍA? — etapa RV19
   * ══════════════════════════════════════════════════════════════════════
   *
   * Sale del merge de RV18 con BP52: esa etapa hizo la tarjeta de métricas más
   * alta --260x301 a 280x419-- y en el paso 1.5 dejó de haber una posición de
   * scroll que muestre el objetivo del paso Y la tarjeta entera. La cuenta, a
   * 900px de ventana: banda libre 693px contra 67 del veredicto + 424 de hueco
   * + 419 de la tarjeta = 910. No entra, y ninguna de las dos etapas está mal.
   *
   * La decisión fue no mover la pantalla para todos por un paso de ocho, sino
   * que la barra LO DIGA: minimizar deja 41px y el cruce en cero.
   *
   * ⚠ SE CALCULA, NO SE CLAVA AL 1.5. Una condición sobre `phase 1 step 5`
   * quedaría vieja sin avisar en cuanto otra etapa cambie el alto de la
   * tarjeta -- y el paso que no cabe pasaría a ser otro.
   *
   * ⚠ Y NO ES «CUALQUIER BLOQUE CORTADO», que fue el primer intento y estaba
   * mal: medido, esa condición se cumple casi siempre --una página larga
   * siempre sigue debajo de la barra-- y el aviso salía también en el 1.2, con
   * la tarjeta entera a la vista. Un aviso que aparece cuando no falta nada
   * enseña a ignorarlo.
   *
   * Lo que se pregunta es si LA TARJETA DE NÚMEROS está cortada por el borde de
   * arriba de la barra. Nombra un elemento --`.bp-stats`, los números que el
   * módulo pone siempre en el mismo lugar-- y NO un paso: si mañana esa tarjeta
   * cambia de alto, el aviso aparece solo en los pasos donde ahora no entra,
   * sin tocar nada acá. Eso es lo que lo hace una medición y no un caso
   * especial.
   *
   * ⚠ Y SE APAGA SOLO AL MINIMIZAR: con la barra en 41px la tarjeta deja de
   * estar cortada en los pasos donde el aviso aparecía. La misma cuenta que lo
   * enciende lo apaga, sin una condición extra sobre `minimizado`.
   */
  const [tapaAlgo, setTapaAlgo] = useState(false);
  useEffect(() => {
    if (!hayPanel) return;
    const mirar = () => {
      const panel = document.querySelector('.rv-panel');
      const numeros = document.querySelector('.bp-stats');
      if (panel === null) return;
      /* Sin tarjeta en pantalla no hay nada que avisar: el 2.1, el 2.2 y el
         3.1 no la tienen. */
      if (numeros === null) {
        setTapaAlgo((antes) => (antes === false ? antes : false));
        return;
      }
      const barra = panel.getBoundingClientRect().top;
      const r = numeros.getBoundingClientRect();
      /* Cortada: empieza arriba del borde de la barra y termina abajo. Si está
         entera arriba --o entera abajo, fuera de pantalla-- no hay aviso. */
      const hay = r.top < barra && r.bottom > barra;
      setTapaAlgo((antes) => (antes === hay ? antes : hay));
    };
    /*
     * ⚠ EN UN `requestAnimationFrame` Y NO SINCRÓNICO: un `setState` en el
     * cuerpo de un efecto dispara renders en cascada, y este anfitrión vive en
     * el layout raíz. Es la regla que este archivo ya se comió una vez.
     */
    const primera = requestAnimationFrame(mirar);
    /* Capture en el scroll por lo mismo que la flecha: el contenedor que
       scrollea puede no ser la ventana. Y un tick, porque el alto de la barra
       cambia con lo que la persona escribe en el comentario. */
    window.addEventListener('scroll', mirar, { capture: true, passive: true });
    window.addEventListener('resize', mirar);
    const tick = setInterval(mirar, 1000);
    return () => {
      cancelAnimationFrame(primera);
      clearInterval(tick);
      window.removeEventListener('scroll', mirar, { capture: true });
      window.removeEventListener('resize', mirar);
    };
  }, [hayPanel, claveDelPaso]);

  const onSaveAndExit = useCallback(() => {
    /*
     * No escribe NADA EN LA BASE: cada paso ya se guardó al completarse, así que
     * salir no tiene que confirmar nada.
     *
     * ⚠ LO QUE SÍ HACE es soltar la máscara, y eso antes faltaba: llamaba sólo a
     * `recargar()`, la sesión seguía abierta y la barra volvía a dibujarse con el
     * panel del paso donde iba. El botón no hacía lo que decía.
     *
     * Y el resumen se cierra también: salir desde ahí dejaría el estado local
     * abierto para la próxima entrada.
     */
    salirDeLaRevision();
    setEnResumen(false);
    recargar();
  }, [recargar, salirDeLaRevision]);

  if (!habilitado) return null;

  return (
    <>
      <ReviewMask activo={activo} onSaveAndExit={onSaveAndExit} />
      {/*
        La flecha del paso. Se dibuja sólo con sesión y paso en curso, así que
        al pasar al siguiente se desmonta -- no queda como adorno. Y si su
        ancla no está en esta pantalla, el componente no dibuja nada.
      */}
      {activo?.session && flechaActual !== null && (
        <ReviewArrow
          flecha={flechaActual}
          hayOtra={flechaIdx < flechas.length - 1}
          onOk={() => setAvance({ clave: claveDelPaso, idx: flechaIdx + 1 })}
        />
      )}
      {/*
        El panel del paso va JUNTO A LA BARRA y no en cada pantalla, por el
        mismo motivo: es lo unico que tiene la sesion en curso y sobrevive al
        cruce de modulo. Y no se dibuja sin sesion -- ni el, ni su campo de
        comentario, que es el unico del portal.
      */}
      {script && activo?.session && !enResumen && (
        <ReviewStepPanel
          /*
           * ⚠ EL `key` ES EL PASO, y no es cosmetico: hace que React remonte el
           * panel al cambiar de paso, y con eso el borrador se rehace sin un
           * efecto que llame setState. Ver la nota del panel.
           */
          key={activo.session.current_phase + ':' + activo.session.current_step_in_phase}
          script={script}
          session={activo.session}
          responses={activo.responses}
          loName={activo.loName}
          funnelActual={funnelActual}
          pasosDelPlan={pasosDelPlan}
          enSitio={enSitio}
          buscandoSitio={buscandoSitio}
          benchmarkActual={benchmarkActual}
          presupuestoGuardado={presupuestoGuardado}
          /* La medición vive acá --el anfitrión ya mide el panel para el
             relleno-- y el panel sólo la dibuja: si la hiciera él, habría dos
             lugares midiendo la misma geometría. */
          tapaAlgo={tapaAlgo}
          branchesDelLo={branchesDelLo}
          onBenchmarkGuardado={() => setTickBench((t) => t + 1)}
          /* La misma ruta que decide `enRuta`, no una segunda cuenta: el botón
             tiene que llevar exactamente a donde el panel se habilita. */
          rutaDelPaso={rutaDelPaso}
          onResumen={() => {
            recargar();
            setEnResumen(true);
          }}
          onGuardar={async (paso, revision, comment, gate) => {
            const r = await guardarPaso(activo.session!.session_key, paso, revision, comment, gate);
            if (!r.ok) return r.error;
            recargar();
            return null;
          }}
          onIrAlPaso={async (destino) => {
            const r = await moverCursor(activo.session!.session_key, destino);
            if (!r.ok) return r.error;
            recargar();
            /*
             * La fase puede cambiar de modulo: se navega al del destino.
             *
             * ⚠ Y AHORA TAMBIÉN CUANDO EL MÓDULO NO CAMBIA. La comparación por
             * módulo alcanzaba mientras Outlook era una sola pantalla; con la
             * ruta del BRANCH, estar «en outlook» ya no significa estar donde el
             * paso apunta -- Isabella quedó en la lista de los trece branches. Se
             * compara la RUTA, que es lo que el paso declara.
             *
             * `rutaDelModulo` del destino y no `rutaDelPaso`: `rutaDelPaso` sale
             * del cursor de ARRIBA, que en este momento todavía es el paso viejo.
             */
            const fase = script!.phases.find((f) => f.phase_no === destino.phase_no);
            if (fase) {
              /*
               * ⚠ EL BRANCH SE RESUELVE ACÁ, ESPERÁNDOLO, y no se lee del estado.
               *
               * Medido: el estado tarda hasta OCHO SEGUNDOS en llegar, y hasta
               * entonces `branchPrincipal` es `null` -- que cae al respaldo
               * `/outlook`, la lista de los trece branches. Es exactamente la
               * pantalla que Isabella vio en vez del branch de Adriana.
               *
               * Una acción de un solo disparo no tiene por qué depender de que un
               * estado haya llegado: pide el dato y lo espera. El estado sigue
               * existiendo para el LINK del panel, que se redibuja solo.
               */
              const codigos =
                branchesDelLo.length > 0
                  ? branchesDelLo
                  : await buscarBranches(activo.session!.lo_employee_key);
              const destinoRuta = rutaDelModulo(
                fase.module,
                activo.session!.lo_employee_key,
                codigos.length > 0 ? codigos[0] : null
              );
              if (pathname !== destinoRuta && !pathname.startsWith(destinoRuta + '/')) {
                router.push(destinoRuta);
              }
            }
            return null;
          }}
        />
      )}

      {/*
        EL RESUMEN. Reemplaza al panel mientras está abierto: dos cajas ancladas
        en la misma esquina compiten, y además el paso ya está contestado -- lo
        que queda es leer y decidir.
      */}
      {script && activo?.session && enResumen && (
        <ReviewSummary
          script={script}
          responses={activo.responses}
          loName={activo.loName}
          ocupado={cerrando}
          error={errorCierre}
          onCorregir={async (paso) => {
            setErrorCierre(null);
            setCerrando(true);
            const r = await moverCursor(activo.session!.session_key, paso);
            setCerrando(false);
            if (!r.ok) {
              setErrorCierre(r.error);
              return;
            }
            recargar();
            /* Se vuelve al panel, en el paso a corregir. */
            setEnResumen(false);
          }}
          onCerrar={async () => {
            setErrorCierre(null);
            setCerrando(true);
            const r = await cerrarSesion(activo.session!.session_key);
            setCerrando(false);
            if (!r.ok) {
              setErrorCierre(r.error);
              return;
            }
            setEnResumen(false);
            recargar();
            router.push('/review');
          }}
        />
      )}
    </>
  );
}

/**
 * ⚠ LA RUTA DE OUTLOOK ES LA DEL BRANCH, no la lista — etapa RV4.
 *
 * Con `branchCode` en `null` cae a `/outlook`, que es lo que hacía antes: es el
 * respaldo de «todavía no sé en qué branch está» o «no está en ninguno». Y se
 * ejerce de verdad --el branch llega de la base, unos cientos de ms después de
 * montar-- así que no es un respaldo muerto.
 */
/*
 * ⚠ ACÁ ESTABA `moduloActual`, y se fue con su único llamador.
 *
 * Comparaba el primer segmento de la ruta contra el módulo de la fase para
 * decidir si navegar. Era correcto mientras Outlook fuera una sola pantalla;
 * desde que la fase 2 apunta al branch de la persona, «ya estás en outlook» no
 * dice nada sobre estar donde el paso apunta -- y eso es exactamente lo que
 * dejó a Isabella en la lista de los trece branches con el panel diciendo que
 * no era esa pantalla.
 *
 * Ahora se compara la RUTA completa. Una función que respondía la pregunta
 * equivocada no se arregla: se saca.
 */

