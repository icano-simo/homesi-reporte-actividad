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
import { stepOpenEditor, stepTarget } from '@/lib/review/gates';
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
  const { script, myReviews, recargar, habilitado } = useReview();
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
  const activo = (myReviews ?? []).find((r) => r.session?.status === 'in_progress') ?? null;
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
  const pasoActual =
    script && activo?.session
      ? script.steps.find((s) =>
          sameStep(s, {
            phase_no: activo.session!.current_phase,
            step_in_phase: activo.session!.current_step_in_phase,
          })
        ) ?? null
      : null;
  const selectorDelPaso = pasoActual ? stepTarget(pasoActual) : null;

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
   * La evidencia es una FILA NUEVA en cualquiera de las tres tablas donde vive
   * el presupuesto de una persona, escrita después de que arrancó la sesión:
   *
   *   outlook.strategy_benchmark    el benchmark de la estrategia
   *   outlook.growth_rule           la regla de crecimiento
   *   outlook.monthly_target        los meses uno por uno
   *
   * Las tres son append-only y tienen `created_at`, así que «durante esta
   * sesión» es `created_at >= session.started_at`. Cualquiera de las tres
   * alcanza: el editor guarda lo que cambió, y pedir las tres obligaría a tocar
   * cosas que no hacía falta tocar.
   *
   * ⚠ SE RECONSULTA CADA 4s MIENTRAS EL PASO ESTÉ ABIERTO. El guardado ocurre en
   * OTRO componente --el editor de Outlook-- y el botón del panel está apagado
   * hasta que la fila aparece, así que sin reconsultar la persona guardaría y no
   * pasaría nada. Se corta al salir del paso.
   *
   * ⚠ Y SI EL PRESUPUESTO YA ESTABA BIEN Y NO HAY QUE CAMBIARLO: guardarlo otra
   * vez escribe una fila con autor y fecha, y ESO es la confirmación. Es más de
   * lo que daba la casilla, no menos.
   */
  const [presupuestoGuardado, setPresupuestoGuardado] = useState(false);
  const pidePresupuesto = pasoActual?.gate_kind === 'budget';
  const arranco = activo?.session?.started_at ?? null;
  useEffect(() => {
    if (!pidePresupuesto || loEnCurso === null || arranco === null) return;
    let vivo = true;
    const mirar = async () => {
      const ol = getSupabaseClient().schema('outlook');
      const [b, g, t] = await Promise.all([
        ol.from('strategy_benchmark').select('created_at')
          .eq('employee_key', loEnCurso).gte('created_at', arranco).limit(1),
        ol.from('growth_rule').select('created_at')
          .eq('employee_key', loEnCurso).gte('created_at', arranco).limit(1),
        ol.from('monthly_target').select('created_at')
          .eq('employee_key', loEnCurso).gte('created_at', arranco).limit(1),
      ]);
      if (!vivo) return;
      const hay =
        (b.data?.length ?? 0) > 0 || (g.data?.length ?? 0) > 0 || (t.data?.length ?? 0) > 0;
      setPresupuestoGuardado(hay);
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
  const [funnelActual, setFunnelActual] = useState<string | null>(null);
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
        if (!cancelado) setFunnelActual(null);
        return;
      }
      const { data } = await getSupabaseClient()
        .schema('business_plan')
        .from('enrollment')
        .select('funnel_name')
        .eq('employee_key', loEnCurso)
        .eq('status', 'active')
        /* Con `order` y no solo `limit(1)`: hoy el indice unico garantiza uno,
           y la consulta no tiene por que depender de una garantia que vive en
           otro archivo. Es el defecto que `useEnrollment` todavia tiene. */
        .order('activated_at', { ascending: false })
        .limit(1);
      if (!cancelado) setFunnelActual((data ?? [])[0]?.funnel_name ?? null);
    })();
    return () => {
      cancelado = true;
    };
  }, [loEnCurso]);

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

  const onSaveAndExit = useCallback(() => {
    /*
     * No escribe nada: cada paso ya se guardó al completarse, así que salir no
     * tiene que confirmar nada. Sólo hace falta releer, y ahora el proveedor es
     * uno solo -- así que esto también actualiza la lista de la otra pantalla.
     */
    recargar();
  }, [recargar]);

  if (!habilitado) return null;

  return (
    <>
      <ReviewMask activo={activo} onSaveAndExit={onSaveAndExit} />
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
          enSitio={enSitio}
          buscandoSitio={buscandoSitio}
          benchmarkActual={benchmarkActual}
          presupuestoGuardado={presupuestoGuardado}
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
          onContinuar={async (destino) => {
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

/**
 * A donde manda cada modulo. Duplicado a proposito con la pagina de arranque:
 * son dos momentos distintos --entrar y avanzar-- y compartirlo obligaria a un
 * archivo mas para tres lineas. Si aparece un tercer llamador, se extrae.
 */
/**
 * ══════════════════════════════════════════════════════════════════════
 * EN QUÉ BRANCHES ESTÁ UNA PERSONA — una sola definición
 * ══════════════════════════════════════════════════════════════════════
 *
 * La usan DOS: el efecto que alimenta el link del panel, y la navegación al
 * avanzar de fase. Dos consultas separadas del mismo hecho quedan libres de
 * discrepar, y acá discrepar significa mandar a una pantalla y ofrecer otra.
 *
 * `dim_branch` completa y no filtrada por clave: son trece filas, y filtrar
 * pidiendo `in` con las claves de la persona sería una segunda consulta
 * dependiente de la primera. Trece filas se leen una vez.
 */
async function buscarBranches(loEmployeeKey: number): Promise<string[]> {
  const sb = getSupabaseClient().schema('org');
  const [asig, ramas] = await Promise.all([
    sb.from('employee_branch').select('branch_key').eq('employee_key', loEmployeeKey),
    sb.from('dim_branch').select('branch_key, branch_code'),
  ]);
  const codigoDe = new Map(
    ((ramas.data ?? []) as { branch_key: number; branch_code: string }[]).map((b) => [
      b.branch_key,
      b.branch_code,
    ])
  );
  return ((asig.data ?? []) as { branch_key: number }[])
    .map((a) => codigoDe.get(a.branch_key))
    .filter((c): c is string => typeof c === 'string' && c !== '')
    /* Ordenados, para que «el primero» sea siempre el mismo: sin `order` la
       respuesta de PostgREST no promete un orden. */
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function rutaDelModulo(modulo: string, loEmployeeKey: number, branchCode: string | null): string {
  if (modulo === 'business-plan') return '/business-plan/lo/' + loEmployeeKey;
  if (modulo === 'outlook') {
    return branchCode === null ? '/outlook' : '/outlook/branch/' + encodeURIComponent(branchCode);
  }
  return '/review';
}
