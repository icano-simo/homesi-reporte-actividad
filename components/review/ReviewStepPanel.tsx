'use client';

/**
 * ============================================================================
 * EL PANEL DEL PASO EN CURSO
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 * Etapa RV2 — un solo botón, y el campo sólo en el lugar del paso.
 *
 * Va anclado abajo, encima de la pantalla del módulo que la fase visita. La
 * persona ve el gráfico de cierres real y el paso arriba: la máscara guía, no
 * reemplaza.
 *
 * ---------------------------------------------------------------------------
 * ⚠ LOS CAMPOS DE COMENTARIO SÓLO EXISTEN ACÁ, Y SÓLO EN SU LUGAR
 * ---------------------------------------------------------------------------
 * No hay un campo de comentario de revisión en ninguna pantalla del portal: el
 * único vive en este componente, que sólo se monta con una sesión en curso.
 *
 * Y desde RV2 tampoco alcanza con que haya sesión. El campo aparece cuando:
 *
 *   · el paso NO declara lugar (`gate_config.target` vacío) — no hay requisito;
 *   · o el lugar del paso está en ESTA página.
 *
 * Estando en el perfil de otra persona, o en otra pantalla del módulo, el panel
 * dice a dónde ir y NO ofrece dónde escribir. Un comentario contestado lejos de
 * lo que se está mirando es un comentario sobre otra cosa.
 *
 * Lleva `data-review-comment` para que se pueda VERIFICAR desde afuera que no
 * aparece en la app normal. La aserción existe desde antes que el campo.
 *
 * ⚠ Y HAY OTRO CAMPO EN EL PERFIL QUE NO ES ÉSTE: el de `NotesPanel`, las notas
 * del Business Plan --«What was discussed with this loan officer»--, que existe
 * desde BP20 y no tiene nada que ver con la revisión. Medido: sin sesión en
 * curso hay CERO campos de revisión y ése sigue estando. Que los dos pregunten
 * casi lo mismo es lo que confunde, y está reportado aparte.
 *
 * ---------------------------------------------------------------------------
 * ⚠ UN SOLO BOTÓN: `OK` GUARDA Y AVANZA
 * ---------------------------------------------------------------------------
 * En RV1 eran dos acciones separadas y quedaba `Save again` junto a `Continue`
 * -- dos botones donde va uno, y el de guardar permanente sobre un paso ya
 * guardado. Probado por Isabella: escribió, dio `OK`, y se quedó en el paso.
 *
 * Ahora `OK` guarda y mueve el cursor en un gesto. Y si el comentario ya está
 * guardado, editarlo es ENTRAR de nuevo --un `Edit` que trae el campo-- y no un
 * botón de guardar que vive ahí para siempre.
 *
 * Lo que RV1 quería proteger sigue en pie: `Continue` no navega solo. Nada se
 * mueve sin que alguien apriete algo; lo que cambió es que ese algo es uno.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangleIcon } from '@/components/ui/icons';
import {
  allowsSecondFunnel,
  gateEvidence,
  gateLink,
  gateStatus,
  requiredClicks,
  requiresFunnel,
  enPalabras,
  type StepDraft,
} from '@/lib/review/gates';
import { latestResponse, orderedSteps, sameStep } from '@/lib/review/progress';
import { fijarBenchmark } from '@/lib/business-plan/benchmark';
/* `useEffect` queda para el listener de clics, que SÍ es una suscripción. */
import type { ReviewResponse, ReviewScript, ReviewSession, StepRef } from '@/lib/review/types';

export interface ReviewStepPanelProps {
  script: ReviewScript;
  session: ReviewSession;
  responses: ReviewResponse[];
  loName: string;
  /** El funnel activo del Loan Officer, para la fase 3. `null` = no tiene. */
  funnelActual: string | null;
  /**
   * Si estamos donde el paso apunta. Lo resuelve `useReviewTarget` en el
   * anfitrión, que es quien puede mirar el DOM de la página entera.
   *
   * `null` = el paso no declara lugar, así que no hay requisito.
   */
  enSitio: boolean | null;
  /**
   * `true` mientras la sección del paso se está buscando en esta página.
   *
   * ⚠ Sin este tercer estado el panel MIENTE durante los primeros segundos: el
   * perfil trae sus datos después de pintar la ruta, así que la sección no
   * existe todavía y `enSitio` es `false` -- «andate a la pantalla del paso»,
   * dicho en la pantalla del paso.
   */
  buscandoSitio: boolean;
  /** A dónde ir cuando el lugar del paso no está acá. */
  rutaDelPaso: string;
  /**
   * El benchmark mensual vigente del Loan Officer, o `null` si no tiene.
   *
   * ⚠ `null` Y `0` NO SON LO MISMO: cero cierres por mes es una decisión, y
   * `null` es que nadie decidió. Es la distinción que sostiene la tabla, y por
   * eso el campo arranca vacío sólo en el segundo caso.
   */
  benchmarkActual: number | null;
  /** Para que el anfitrión relea el vigente después de que este panel lo cambie. */
  onBenchmarkGuardado: () => void;
  /**
   * ⚠ SI EL PRESUPUESTO SE GUARDÓ DE VERDAD DURANTE ESTA SESIÓN.
   *
   * Lo mide el anfitrión contra las tres tablas de Outlook. Reemplaza a la
   * casilla «I saved the budget for X in Outlook», que era una declaración de la
   * propia persona: aparentaba ser una compuerta y no lo era.
   */
  presupuestoGuardado: boolean;
  /**
   * En qué branches está el Loan Officer. Con más de uno, la revisión manda al
   * primero y el panel lo DICE -- elegir en silencio sería mandar a una pantalla
   * que puede no ser la que hace falta.
   */
  branchesDelLo: readonly string[];
  /** Guarda el paso. Devuelve el error, o `null` si salió bien. */
  onGuardar: (paso: StepRef, revision: number, comment: string, gate: Record<string, unknown> | null) => Promise<string | null>;
  /** Mueve el cursor. Lo dispara `OK`, en el mismo gesto que el guardado. */
  onContinuar: (destino: StepRef) => Promise<string | null>;
  /**
   * ⚠ EL ÚLTIMO PASO NO CIERRA: PIDE EL RESUMEN — etapa RV4.
   *
   * Cerrar era el último gesto y no había dónde mirar lo que se había escrito.
   * Ahora el último `OK` guarda y muestra todo, con la sesión TODAVÍA abierta --
   * que es la única forma de poder corregir: `response_insert` exige
   * `status = 'in_progress'`.
   */
  onResumen: () => void;
}

export default function ReviewStepPanel({
  script,
  session,
  responses,
  loName,
  funnelActual,
  enSitio,
  buscandoSitio,
  rutaDelPaso,
  benchmarkActual,
  onBenchmarkGuardado,
  presupuestoGuardado,
  branchesDelLo,
  onGuardar,
  onContinuar,
  onResumen,
}: ReviewStepPanelProps) {
  /* Sólo para no ofrecer «andá al catálogo» estando en el catálogo. El resto de
     la decisión de lugar la resuelve el anfitrión, que ve el DOM entero. */
  const pathname = usePathname();
  const cursor: StepRef = {
    phase_no: session.current_phase,
    step_in_phase: session.current_step_in_phase,
  };
  const paso = script.steps.find((s) => sameStep(s, cursor)) ?? null;
  const texto = script.prompts.find((t) => paso && sameStep(t, paso)) ?? null;
  const yaContestado = latestResponse(responses, cursor);

  /*
   * ⚠ EL BORRADOR SE REHACE REMONTANDO, NO CON UN EFECTO.
   *
   * Arranca con lo YA CONTESTADO si el paso tiene respuesta: volver a un paso
   * cerrado tiene que mostrar lo que se escribió, y un campo vacío sobre un paso
   * completo se lee como que se perdió.
   *
   * Al cambiar de paso hay que rehacer estos cinco estados: sin eso, el
   * comentario del paso anterior queda escrito en el siguiente, que es la forma
   * más rápida de guardar la respuesta equivocada.
   *
   * Lo escribí como un `useEffect` que llamaba a cinco `setState`, y eslint lo
   * marcó con `react-hooks/set-state-in-effect`. Tenía razón, y el arreglo no
   * es callar la regla: el ANFITRIÓN le pasa un `key` con el paso, así que React
   * desmonta y vuelve a montar el panel y estos valores iniciales hacen el
   * trabajo solos.
   *
   * Mismo criterio que el `:has()` del corrimiento de la barra: si la presencia
   * del componente ya dice el estado, no hay nada que sincronizar.
   */
  const [comment, setComment] = useState(yaContestado?.comment ?? '');
  /*
   * ══════════════════════════════════════════════════════════════════
   * EL CAMPO ARRANCA CON EL BENCHMARK QUE YA HAY — etapa RV3
   * ══════════════════════════════════════════════════════════════════
   *
   * Venía vacío, así que parecía que no había ninguno --y Adriana tenía 1 desde
   * el 21 de agosto--. Un campo vacío sobre un dato que existe es la misma clase
   * de mentira que un `—` mientras la pantalla carga.
   *
   * El remonte por `key` hace el trabajo: al entrar al paso 2 este valor inicial
   * ya es el vigente, sin un efecto que lo copie.
   */
  /*
   * ⚠ Y SE DERIVA, NO SE COPIA. Escribirlo como valor inicial del estado no
   * alcanzaba: el anfitrión lee el benchmark de la base y eso llega DESPUÉS de
   * que el panel monta, así que el valor inicial era `''` y no se corregía nunca
   * -- el remonte por `key` sólo ocurre al cambiar de paso.
   *
   * Medido: el campo quedaba vacío igual que antes del arreglo. La misma forma
   * que el resto de esta etapa -- un estado capturado antes de que el dato
   * llegue -- y la misma respuesta que el avance de la revisión: derivar.
   *
   * `null` = nadie lo tocó, así que manda el de la base. Un string --incluso
   * vacío-- es una decisión de quien escribe y le gana.
   */
  const [numeroEscrito, setNumeroEscrito] = useState<string | null>(null);
  const numero =
    numeroEscrito ?? (benchmarkActual === null ? '' : String(benchmarkActual));
  const setNumero = setNumeroEscrito;
  /*
   * ══════════════════════════════════════════════════════════════════
   * LOS CLICS SOBREVIVEN A UNA RECARGA — etapa RV3
   * ══════════════════════════════════════════════════════════════════
   *
   * Tres orígenes, en este orden:
   *
   *   1. la respuesta ya guardada -- `response.gate.clicked`, que es la fuente
   *      definitiva y la única que cruza de máquina;
   *   2. lo que quedó en ESTE navegador de un intento sin cerrar;
   *   3. nada.
   *
   * ⚠ EL PASO 2 NO EXISTIA, y era un agujero real: el paso 4 pide abrir dos
   * números, y hasta que el paso se cierra esa evidencia no tiene fila en
   * ninguna tabla. Vivia sólo en memoria, así que una recarga --o cerrar el
   * modal con F5, o que se caiga la conexión-- obligaba a volver a abrir los
   * dos sin decir por qué.
   *
   * `sessionStorage` y no `localStorage` a propósito: es la evidencia de ESTA
   * sentada. Si la persona vuelve dentro de una semana, que tenga que volver a
   * mirar los números es lo correcto -- no son un trámite, son el paso.
   *
   * Y NO reemplaza a `response.gate`: eso sigue siendo lo que queda escrito.
   * Esto es un borrador, con el alcance de un borrador.
   */
  const claveClics =
    'rv-clicks:' + session.session_key + ':' + cursor.phase_no + ':' + cursor.step_in_phase;
  const [clicks, setClicks] = useState<string[]>(() => {
    if (Array.isArray(yaContestado?.gate?.clicked)) return yaContestado.gate.clicked as string[];
    try {
      const crudo = sessionStorage.getItem(claveClics);
      const arr = crudo === null ? null : JSON.parse(crudo);
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      /* Sin almacenamiento --modo privado, permisos-- se arranca vacío. Es una
         pérdida de comodidad, no de corrección. */
      return [];
    }
  });
  /*
   * ⚠ ACÁ HABÍA UN `useState` PARA LA CASILLA, y se fue con ella.
   *
   * `budgetListo` ya no es algo que la persona marque: es lo que el anfitrión
   * MIDIÓ contra `outlook.strategy_benchmark`, `growth_rule` y `monthly_target`.
   * Un paso ya contestado se da por bueno igual que antes -- si se cerró, la
   * evidencia estaba.
   *
   * Que sea una prop y no un estado es la mitad que importa: un estado local se
   * puede poner en `true` desde la pantalla, y eso es exactamente lo que la
   * casilla permitía.
   */
  const budgetListo = presupuestoGuardado || yaContestado !== null;
  /*
   * ⚠ `editando` ES EL ESTADO QUE REEMPLAZA AL BOTÓN `Save again`.
   *
   * Un paso sin contestar entra editando: hay que escribir algo. Un paso ya
   * contestado entra CERRADO --se lee lo que se dijo-- y volver a abrirlo es un
   * gesto explícito. Así no queda un campo de comentario abierto sobre un paso
   * que ya está guardado, que es lo que hacía que `Save again` pareciera
   * obligatorio.
   */
  const [editando, setEditando] = useState(yaContestado === null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * ⚠ LOS CLICS SE ESCUCHAN EN `document`, EN CAPTURA.
   *
   * Los números que el paso 4 pide abrir viven en la pantalla de Business Plan,
   * que no sabe nada de la revisión. En vez de tocar cinco pantallas para que
   * avisen, el panel escucha: cualquier elemento con `data-review-click="id"`
   * cuenta como abierto.
   *
   * En CAPTURA y no en burbujeo: varios de esos controles llaman
   * `stopPropagation` --el menú de la tarjeta de nodo lo hace-- y en burbujeo
   * este listener no se enteraría. Y no cancela nada: el clic sigue su camino y
   * abre lo que tenía que abrir.
   *
   * ⚠ ESTO SIGUE SIN VERIFICARSE. Necesita llegar al paso 4 dentro de una
   * sesión, y eso espera al recorrido de Isabella. Declarado como no medido.
   */
  /*
   * ⚠ SIN `useMemo`. Lo había envuelto en uno con `[paso]` como dependencia, y
   * `paso` sale de un `find`: es una referencia nueva en cada render, así que el
   * memo se recalculaba siempre -- no memoizaba nada y encima eslint lo marcaba
   * con `react-hooks/preserve-manual-memoization`.
   *
   * Filtrar un array de dos elementos es más barato que el memo. Lo que SÍ
   * necesita ser estable es la dependencia del efecto, y para eso se serializa.
   */
  const pedidos = paso ? requiredClicks(paso) : [];
  const pedidosClave = pedidos.join(',');

  /* Guardar el borrador de clics. Es sincronizar con un sistema externo, que es
     para lo que un efecto está: no calcula nada de la vista. */
  useEffect(() => {
    try {
      if (clicks.length === 0) sessionStorage.removeItem(claveClics);
      else sessionStorage.setItem(claveClics, JSON.stringify(clicks));
    } catch {
      /* Ver la nota del estado inicial. */
    }
  }, [claveClics, clicks]);

  /*
   * ══════════════════════════════════════════════════════════════════
   * ⚠ UNA MARCA QUE NO EXISTE SE DICE EN PANTALLA — etapa RV3
   * ══════════════════════════════════════════════════════════════════
   *
   * Este efecto existe por el defecto que lo hizo falta: `data-review-click` no
   * estaba escrito en NINGUN elemento de la app. El listener de abajo escuchaba
   * una marca que nadie llevaba, así que los clics de Isabella no se contaban y
   * el paso 4 no se podía cerrar. Nada fallaba: el botón apagado y un aviso
   * pidiendo los dos números que ella acababa de abrir.
   *
   * Lo que lo hacía invisible es que las dos mitades son correctas por separado
   * --la pantalla dibuja sus tarjetas, el panel pide sus clics-- y nadie
   * comprobaba que se conocieran. Ahora el panel lo comprueba y lo dice, con los
   * identificadores exactos: es un error de cableado, y quien lo lea tiene que
   * poder distinguirlo de algo que hizo mal.
   *
   * Se mira DESPUES del plazo y no en el primer cuadro, por la misma razon de
   * siempre: una pantalla que no cargo no tiene las tarjetas todavia.
   */
  const [marcasAusentes, setMarcasAusentes] = useState<string[]>([]);
  useEffect(() => {
    if (pedidosClave === '') return;
    const lista = pedidosClave.split(',');
    let vivo = true;
    /*
     * El plazo se cuenta en INTENTOS y no con `Date.now()`: eslint marca la
     * llamada impura con `react-hooks/purity`, y tenía razón en que no hacía
     * falta — lo que se espera es «la pantalla terminó de dibujar sus
     * tarjetas», y eso se cuenta en vueltas del reintento, no en reloj.
     */
    const MAX_INTENTOS = 20; /* × 500ms = 10s */
    let intentos = 0;
    const mirar = () => {
      const faltan = lista.filter(
        (id) => document.querySelector('[data-review-click="' + id + '"]') === null
      );
      if (!vivo) return true;
      if (faltan.length === 0) {
        setMarcasAusentes([]);
        return true;
      }
      intentos += 1;
      if (intentos >= MAX_INTENTOS) {
        setMarcasAusentes(faltan);
        return true;
      }
      return false;
    };
    if (mirar()) return;
    const t = setInterval(() => {
      if (mirar()) clearInterval(t);
    }, 500);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [pedidosClave]);

  useEffect(() => {
    const lista = pedidosClave === '' ? [] : pedidosClave.split(',');
    if (lista.length === 0) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const marca = t.closest('[data-review-click]');
      const id = marca?.getAttribute('data-review-click');
      if (id && lista.includes(id)) {
        setClicks((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, [pedidosClave]);

  if (!paso || !texto) {
    /*
     * El cursor apunta a un paso que el guion no tiene. No puede pasar --hay
     * una FK compuesta que lo impide-- pero si pasara, decirlo es mejor que un
     * panel en blanco.
     */
    return (
      <div className="rv-panel" role="region" aria-label="Review step">
        <p className="rv-panel__gate">
          <AlertTriangleIcon size={13} /> This review points at a step that is not in the script
          any more. Nothing was lost — ask for the script to be checked.
        </p>
      </div>
    );
  }

  const orden = orderedSteps(script);
  const i = orden.findIndex((s) => sameStep(s, cursor));
  const siguiente = i >= 0 && i + 1 < orden.length ? orden[i + 1] : null;
  const esUltimo = siguiente === null;

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * ⚠ SIN FUNNEL NO SE CIERRA, Y EL PASO LLEVA AL CATÁLOGO — etapa RV6
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Isabella cerró la revisión de Armando Tejeda sin elegirle ningún funnel: la
   * compuerta pedía sólo el comentario, y la fase 3 existe justamente para que
   * se elija uno. `requiresFunnel` lo exige ahora, y esto es la mitad de la
   * pantalla -- guiar a dónde se elige, y no dibujar el campo de comentario
   * hasta que haya funnel.
   *
   * ⚠ `faltaFunnel` SE DERIVA de la prop, no se copia a un estado. `funnelActual`
   * lo relee el anfitrión cada 4s mientras la fase 3 esté abierta (RV5), así que
   * un estado local quedaría viejo justo en el momento que importa: el de
   * volver del catálogo con el funnel ya activo.
   */
  const requiereFunnel = requiresFunnel(paso);
  const faltaFunnel = requiereFunnel && funnelActual === null;
  /*
   * El catálogo es un sub-camino del perfil, así que `enRuta` del anfitrión ya
   * lo cubre: llegar acá no saca a nadie del lugar del paso. Por eso alcanza con
   * el link, sin tocar `rutaDelModulo`.
   */
  const rutaDelCatalogo = '/business-plan/lo/' + session.lo_employee_key + '/funnel';
  const enElCatalogo = pathname === rutaDelCatalogo;

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * EL PASO NO SE CONTESTA DESDE ACÁ — punto 1 y 3 del brief de RV2
   * ═══════════════════════════════════════════════════════════════════════
   *
   * `enSitio === false` es «el paso declara un lugar y no es esta página».
   * Distinto de `null`, que es «no declara ninguno». Ver `stepTarget`.
   *
   * Se dibuja la cabecera y la pregunta --así sabe qué viene-- y nada donde
   * escribir. El link lleva al módulo de la fase.
   */
  /*
   * ⚠ BUSCANDO: no se afirma nada todavía.
   *
   * Va ANTES del corte de `enSitio === false`, porque mientras se busca
   * `enSitio` tambien es `false` -- y decir «esto se contesta en otra pantalla»
   * estando en la correcta es la mentira que este estado vino a sacar.
   *
   * Se dibuja el paso y su pregunta, que ya son ciertos, y nada mas: ni el campo
   * ni el aviso de irse. Sin un «cargando» propio, que seria una segunda fuente
   * para lo que el modulo ya dice.
   */
  if (buscandoSitio) {
    return (
      <div className="rv-panel rv-panel--buscando" role="region" aria-label="Review step">
        <div className="rv-panel__head">
          <span className="rv-panel__step">
            Phase {paso.phase_no} · step {paso.step_in_phase}
          </span>
          <span className="rv-panel__label">{paso.label}</span>
          {yaContestado && <span className="rv-panel__done">answered</span>}
        </div>
        <p className="rv-panel__prompt">{texto.prompt}</p>
      </div>
    );
  }

  if (enSitio === false) {
    return (
      <div className="rv-panel rv-panel--lejos" role="region" aria-label="Review step">
        <div className="rv-panel__head">
          <span className="rv-panel__step">
            Phase {paso.phase_no} · step {paso.step_in_phase}
          </span>
          <span className="rv-panel__label">{paso.label}</span>
          {yaContestado && <span className="rv-panel__done">answered</span>}
        </div>
        <p className="rv-panel__prompt">{texto.prompt}</p>
        {/*
          ⚠ EL AVISO GENÉRICO NO ALCANZABA EN LA FASE 3 — etapa RV5.
          La acción de este paso --elegir un funnel-- termina en la pantalla del
          plan, donde el lugar del paso no existe. Isabella quedó ahí y el octavo
          comentario nunca se escribió. El aviso ahora dice qué pasó y qué falta,
          en vez de sólo que ésta no es la pantalla.
        */}
        {paso.phase_no === 3 && funnelActual !== null ? (
          <p className="rv-panel__gate">
            {loName} is on <strong>{funnelActual}</strong> — the funnel is chosen and nothing was
            lost. What is left is the comment, and that goes on the profile.
          </p>
        ) : faltaFunnel ? (
          /*
            ⚠ Y SIN FUNNEL EL AVISO NOMBRA LA ACCIÓN — etapa RV6. El genérico
            «esto se contesta en la pantalla que el paso señala» no dice que lo
            que falta es ELEGIR, así que se lee como un problema de navegación y
            no como el paso. Isabella terminó la revisión sin elegir ninguno.
          */
          <p className="rv-panel__gate">
            <AlertTriangleIcon size={13} /> {loName} has no active funnel yet, and this step is
            where one gets picked. Open the catalog and press <strong>Select this funnel</strong>.
          </p>
        ) : (
          <p className="rv-panel__gate">
            This step is answered on the screen it points at, and that is not this one. The comment
            box lives there.
          </p>
        )}
        {/*
          ⚠ Y SI LA PERSONA ESTÁ EN VARIOS BRANCHES, SE DICE. La revisión manda
          al primero por orden de código, y eso puede no ser el que hace falta:
          decirlo es lo que permite corregir el rumbo a mano en vez de revisar
          el presupuesto del branch equivocado sin enterarse.
        */}
        {branchesDelLo.length > 1 && (
          <p className="rv-panel__helper">
            {loName} is in {branchesDelLo.length} branches ({branchesDelLo.join(', ')}). This takes
            you to {branchesDelLo[0]}; open another one yourself if the budget you need is there.
          </p>
        )}
        <div className="rv-panel__actions">
          {/*
            ⚠ SIN RUTA NO HAY BOTÓN. `rutaDelPaso` viene en `''` mientras el
            anfitrión no sabe a qué pantalla lleva el paso -- en la fase 2 eso
            depende del branch de la persona, que tarda segundos en llegar.
            Un botón que lleva a la lista de los trece branches en vez del de
            Adriana es peor que ninguno, porque parece correcto.
          */}
          {faltaFunnel ? (
            /* Lo que falta es elegir, así que el botón lleva a donde se elige y
               no al lugar donde después se escribe el comentario. */
            <Link className="bp-btn bp-btn--primary bp-btn--small" href={rutaDelCatalogo}>
              Open the funnel catalog →
            </Link>
          ) : rutaDelPaso === '' ? (
            <span className="rv-panel__next">working out which screen this step is on…</span>
          ) : (
            <Link className="bp-btn bp-btn--primary bp-btn--small" href={rutaDelPaso}>
              Go to the step →
            </Link>
          )}
        </div>
      </div>
    );
  }

  const draft: StepDraft = {
    comment,
    numero: numero.trim() === '' ? null : Number(numero),
    clicks,
    budgetListo,
    /* De la base, vía el anfitrión: `business_plan.enrollment`. La pantalla no
       lo puede poner en `true`, igual que el presupuesto. */
    funnelListo: funnelActual !== null,
  };
  const estado = gateStatus(paso, draft);
  const link = gateLink(paso);
  const rotuloSiguiente = siguiente
    ? script.steps.find((s) => sameStep(s, siguiente))?.label ?? null
    : null;

  /**
   * ⚠ GUARDAR Y AVANZAR, EN UN GESTO.
   *
   * Y en este orden, con corte: si el guardado falla no se mueve el cursor. Si
   * el guardado sale y el movimiento falla, el paso QUEDA GUARDADO y el error
   * habla del movimiento -- que es la verdad, y es recuperable apretando otra
   * vez.
   */
  async function guardarYSeguir() {
    if (!estado.ok || ocupado) return;
    setOcupado(true);

    /*
     * ═════════════════════════════════════════════════════════════════
     * EL BENCHMARK SE ESCRIBE DE VERDAD — etapa RV3
     * ═════════════════════════════════════════════════════════════════
     *
     * En RV1 el número del paso 2 no iba a ninguna parte: la compuerta pedia
     * "escribi un número" y la evidencia guardaba `benchmark_set: true`. El
     * número se escribía en el perfil, aparte. Con el campo ACÁ, eso es un paso
     * de teatro -- se tipea un valor que no cambia nada.
     *
     * ⚠ Y SIGUE HABIENDO UNA SOLA FUENTE DEL NÚMERO: `org.employee_benchmark`.
     * `response.gate` guarda que se fijó, no cuánto. Copiar el número ahí daría
     * dos lugares libres de discrepar, que es lo que RV1 evitó a propósito.
     *
     * ⚠ Y EL ORDEN IMPORTA: primero el benchmark, después la respuesta. Si el
     * benchmark falla, el paso NO se cierra -- cerrarlo diría que se fijó uno
     * que no se fijó. Al revés, un paso cerrado sin su benchmark es una
     * revisión que miente sobre lo que hizo.
     */
    /* `typeof` y no `!== null`: en `StepDraft` el número es opcional, así que
       descartar sólo `null` deja pasar `undefined` -- lo dijo el typechecker. */
    const nro = draft.numero;
    if (paso!.gate_kind === 'number' && typeof nro === 'number' && nro !== benchmarkActual) {
      const rb = await fijarBenchmark(session.lo_employee_key, nro, comment);
      if (!rb.ok) {
        setError(rb.error ?? 'The benchmark was not saved.');
        setOcupado(false);
        return;
      }
      onBenchmarkGuardado();
    }

    const errGuardar = await onGuardar(cursor, texto!.revision, comment, gateEvidence(paso!, draft));
    if (errGuardar) {
      setError(errGuardar);
      setOcupado(false);
      return;
    }
    if (esUltimo) {
      /* Guardado el último paso, se muestra todo antes de soltar la máscara. */
      setOcupado(false);
      onResumen();
      return;
    }
    setError(await onContinuar(siguiente!));
    setOcupado(false);
  }

  return (
    <div className="rv-panel" role="region" aria-label="Review step">
      <div className="rv-panel__head">
        <span className="rv-panel__step">
          Phase {paso.phase_no} · step {paso.step_in_phase}
        </span>
        <span className="rv-panel__label">{paso.label}</span>
        {yaContestado && <span className="rv-panel__done">answered</span>}
      </div>

      <p className="rv-panel__prompt">{texto.prompt}</p>
      {texto.helper && <p className="rv-panel__helper">{texto.helper}</p>}

      {/* El link del paso 2: se abre y se acuerda el número ahí mismo. */}
      {link && (
        <p className="rv-panel__helper">
          <a href={link} target="_blank" rel="noreferrer">
            Open MMI
          </a>{' '}
          to agree on the number with {loName}.
        </p>
      )}

      {/*
        LA FASE 3, EN SUS DOS FORMAS. Con funnel activo se CONFIRMA el que hay;
        sin funnel se elige. Ni se salta ni se cambia a la fuerza: cambiarlo
        llama a `cancel_funnel`, que BORRA el plan -- y hay planes con steps
        completados. Una revisión no puede destruir trabajo de costado.

        ⚠ EL BRIEF DE RV1 PIDE OTRO ORDEN, Y ESE ORDEN NUNCA SE CONSTRUYÓ.

        El brief dice «el comentario habilita `Select this funnel`»: el botón de
        elegir viviría EN el panel, apagado hasta que hubiera comentario. Lo que
        existe es lo contrario: elegir vive en `/business-plan/lo/[id]/funnel`,
        se llega desde la barra de decisión del perfil, y el panel sólo CIERRA el
        paso después. «Elegilo allá y cerrá el paso acá.» Este panel no tiene
        --ni tuvo nunca-- un botón `Select this funnel`.

        Son dos diseños distintos, y el segundo funciona: se midió en RV5 y el
        paso se cierra. Queda escrito porque **el brief sigue diciendo el otro**,
        así que quien lo lea y busque el botón en este archivo no lo va a
        encontrar, y la ausencia parece un bug en vez de una decisión.
      */}
      {paso.phase_no === 3 && (
        <div className="rv-panel__funnel">
          {funnelActual === null ? (
            /*
              ⚠ ACÁ HABÍA UN MENSAJE: «Pick one on the profile, then close this
              step.» Decía dónde ir y no llevaba, y el paso se podía cerrar
              igual -- las dos mitades del punto 2 del brief de RV6.
            */
            <>
              <p className="rv-panel__gate">
                <AlertTriangleIcon size={13} /> {loName} has no active funnel, and this step is
                where one gets picked. Open a funnel from the catalog and press{' '}
                <strong>Select this funnel</strong>. The comment box shows up once it is active.
              </p>
              {!enElCatalogo && (
                <div className="rv-panel__actions">
                  <Link className="bp-btn bp-btn--primary bp-btn--small" href={rutaDelCatalogo}>
                    Open the funnel catalog →
                  </Link>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="rv-panel__helper">
                {loName} is on <strong>{funnelActual}</strong>. Confirming keeps it — nothing is
                cancelled.
              </p>
              {!allowsSecondFunnel(paso) && (
                <p className="rv-panel__gate">
                  <AlertTriangleIcon size={13} /> Adding a second funnel is not available yet:
                  today the app shows one plan per person, so a second one would be invisible.
                  Changing this funnel instead would cancel the current plan and its completed
                  steps.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {paso.gate_kind === 'number' && editando && (
        <label className="rv-panel__field">
          <span className="rv-panel__fieldlabel">
            Benchmark
            {/*
              Que el vigente se DIGA, y no sólo se precargue: un número en un
              campo no dice si es el que hay o uno que alguien tipeó y no
              guardó. Y que editarlo reemplaza, porque reemplaza.
            */}
            {benchmarkActual === null ? (
              <span className="rv-panel__hintline">no benchmark set yet</span>
            ) : (
              <span className="rv-panel__hintline">
                now {benchmarkActual} / month · saving a different number replaces it
              </span>
            )}
          </span>
          <input
            className="field"
            type="number"
            min="0"
            step="0.5"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="closings per month"
          />
        </label>
      )}

      {pedidos.length > 0 && (
        <ul className="rv-panel__clicks">
          {pedidos.map((c) => (
            <li key={c} className={clicks.includes(c) ? 'is-done' : ''}>
              <span aria-hidden="true">{clicks.includes(c) ? '✓' : '○'}</span> {enPalabras(c)}
            </li>
          ))}
        </ul>
      )}

      {/*
        ═══════════════════════════════════════════════════════════
        ⚠ EL PRESUPUESTO, LEÍDO DE LA BASE — etapa RV4, punto 5
        ═══════════════════════════════════════════════════════════

        Acá estaba la casilla «I saved the budget for X in Outlook». No verificaba
        nada: la persona se la marcaba a sí misma.

        Ahora es un ESTADO que se lee, con las dos caras dichas: lo que falta
        --guardar-- o lo que ya pasó. Y no es clicable, porque no hay nada que
        clickear: se satisface guardando el presupuesto en el editor de al lado.
      */}
      {paso.gate_kind === 'budget' && (
        <p
          className={'rv-panel__evid' + (budgetListo ? ' is-done' : '')}
          role="status"
          data-review-budget={budgetListo ? 'saved' : 'pending'}
        >
          <span aria-hidden="true">{budgetListo ? '✓' : '○'}</span>{' '}
          {budgetListo
            ? "Budget saved for " + loName + " during this review."
            : 'Save the budget for ' + loName + ' in the editor on this screen. This step waits ' +
              'for the saved row, not for a tick box.'}
        </p>
      )}

      {/*
        ⚠ EL CAMPO SÓLO EXISTE EDITANDO. Un paso ya guardado muestra lo que se
        dijo, y volver a abrirlo es el `Edit` de abajo. Es lo que reemplaza al
        `Save again` permanente.
      */}
      {/*
        ⚠ Y SIN FUNNEL NO HAY CAMPO. Es el orden del brief: primero se elige,
        después se comenta. Un campo abierto sobre un paso cuya acción no se hizo
        invita a cerrarlo escribiendo algo, que es exactamente lo que pasó.
      */}
      {faltaFunnel ? null : editando ? (
        <label className="rv-panel__field">
          <span className="rv-panel__fieldlabel">Comment</span>
          <textarea
            className="field rv-panel__text"
            data-review-comment=""
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What did you discuss?"
          />
        </label>
      ) : (
        <div className="rv-panel__saved">
          <p className="rv-panel__savedtext">{comment}</p>
          <button
            type="button"
            className="rv-panel__edit"
            onClick={() => setEditando(true)}
            disabled={ocupado}
          >
            Edit this comment
          </button>
        </div>
      )}

      {/*
        ⚠ EL CABLEADO ROTO, DICHO. Un paso que pide un clic cuya marca no existe
        en la pantalla no se puede cerrar nunca, y sin esto no se puede saber por
        que. Le pasó a Isabella con los dos números del paso 4.
      */}
      {marcasAusentes.length > 0 && (
        <p className="rv-panel__gate" role="alert">
          <AlertTriangleIcon size={13} /> This step waits for{' '}
          {marcasAusentes.map(enPalabras).join(' and ')} to be opened, but{' '}
          {marcasAusentes.length === 1 ? 'that number is' : 'those numbers are'} not marked on this
          screen — so the step cannot register the click. That is a wiring bug between the script
          and the page, not something you did. Report it with this step number.
        </p>
      )}

      {error && (
        <p className="rv-panel__gate" role="alert">
          <AlertTriangleIcon size={13} /> {error}
        </p>
      )}

      {/*
        ⚠ EL MOTIVO AL LADO DEL BOTÓN, no sólo el botón apagado. Un control
        deshabilitado sin explicación obliga a adivinar si falta algo o si la
        app está rota.
      */}
      {/*
        ⚠ `editando || faltaFunnel` Y NO SÓLO `editando`: un paso YA CONTESTADO
        no dibuja el campo, así que sin esto el botón quedaba apagado sin decir
        por qué. Pasa de verdad -- una revisión retomada en 3.1 con el comentario
        escrito y el funnel todavía sin elegir.
      */}
      {!estado.ok && estado.falta && (editando || faltaFunnel) && (
        <p className="rv-panel__gate">{estado.falta}</p>
      )}

      <div className="rv-panel__actions">
        {/*
          UN SOLO BOTÓN, y dice lo que va a pasar. Editando guarda y avanza;
          cerrado sólo avanza, porque no hay nada nuevo que guardar.
        */}
        {editando ? (
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--small"
            disabled={!estado.ok || ocupado}
            onClick={guardarYSeguir}
          >
            {esUltimo ? 'OK and review everything' : 'OK'}
          </button>
        ) : (
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--small"
            /*
              ⚠ `faltaFunnel` ACÁ TAMBIÉN, Y ES LA MITAD QUE FALTABA.
              Este botón --el de un paso ya contestado-- no pasa por
              `gateStatus`: avanza sin más, porque no hay nada nuevo que
              guardar. Sobre el último paso ese avance es `Review and finish`,
              o sea CERRAR LA REVISIÓN. Con el comentario ya escrito y sin
              funnel, era una salida limpia al agujero que el resto de esta
              etapa cierra.
            */
            disabled={ocupado || faltaFunnel}
            onClick={async () => {
              if (esUltimo) {
                onResumen();
                return;
              }
              setOcupado(true);
              setError(await onContinuar(siguiente!));
              setOcupado(false);
            }}
          >
            {esUltimo ? 'Review and finish' : 'Continue →'}
          </button>
        )}

        {/* Qué sigue, en palabras. Un botón que mueve la pantalla tiene que
            decir a dónde antes de que se aprete. */}
        {!esUltimo && rotuloSiguiente && (
          <span className="rv-panel__next">next: {rotuloSiguiente}</span>
        )}
      </div>
    </div>
  );
}
