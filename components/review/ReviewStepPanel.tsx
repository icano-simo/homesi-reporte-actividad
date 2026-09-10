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
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangleIcon, CollapseIcon, ExpandIcon } from '@/components/ui/icons';
import {
  /*
   * `allowsSecondFunnel` se dejó de importar en RV21 y su razón está en
   * `gates.ts`: su único consumidor era el párrafo del 3.1, que salió de la
   * vista, pero `allow_second` sigue significando algo y espera a BP39.
   *
   * ⚠ `gateLink` NO volvió: lo reemplaza `showsMmiLink`, que lee la PRESENCIA
   * de `mmi_link` y no su valor. Ver su nota en `gates.ts` -- RV21 se llevó de
   * paso la condición que esa clave llevaba adentro, y esto es lo que la
   * devuelve.
   */
  gateEvidence,
  showsMmiLink,
  gateStatus,
  requiredClicks,
  promptDeLaRama,
  requiereDecisionDeFunnel,
  enPalabras,
  type StepDraft,
} from '@/lib/review/gates';
import {
  latestResponse,
  pasoAnterior,
  pasoSiguiente,
  sameStep,
} from '@/lib/review/progress';
import { fijarBenchmark } from '@/lib/business-plan/benchmark';
/* `useEffect` queda para el listener de clics, que SÍ es una suscripción. */
import type { ReviewResponse, ReviewScript, ReviewSession, StepRef } from '@/lib/review/types';

export interface ReviewStepPanelProps {
  script: ReviewScript;
  session: ReviewSession;
  responses: ReviewResponse[];
  loName: string;
  /**
   * El funnel activo del Loan Officer, para la fase 3.
   *
   * ⚠ TRES ESTADOS, y el tercero importa: `undefined` = el anfitrión todavía no
   * lo leyó, `null` = lo leyó y no tiene, un string = el nombre del activo.
   *
   * Sin el tercero, la primera lectura de cualquiera se veía igual que «no
   * tiene» y el panel mandaba a elegir un funnel a quien ya tenía uno.
   */
  funnelActual: string | null | undefined;
  /**
   * Cuanto trabajo tiene el plan activo, para poder decir que se pierde al
   * cambiarlo. `undefined` = todavia no se leyo, y con eso el boton de cambiar
   * no se ofrece: un `0` dicho antes de leer seria una mentira tranquilizadora
   * en la pantalla que ofrece destruirlos.
   */
  pasosDelPlan?: { hechos: number; total: number; enrollmentKey: number };
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
  /**
   * ⚠ EL LINK A MMI DE LA PERSONA REVISADA, o `null` si no tiene NMLS — etapa
   * RV21. Lo arma el anfitrión con el NMLS efectivo; acá sólo se dibuja.
   */
  linkMmiDelLo: string | null;
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
  /*
   * ⚠ ACÁ ESTABA `tapaAlgo` (RV19) y se fue en RV20 con su aviso: la tarjeta
   * anclada a la izquierda deja el lado derecho libre por construcción, así que
   * la medición que lo alimentaba dejó de tener pregunta. Ver la nota del lugar
   * donde se dibujaba.
   */
  /**
   * En qué branches está el Loan Officer. Con más de uno, la revisión manda al
   * primero y el panel lo DICE -- elegir en silencio sería mandar a una pantalla
   * que puede no ser la que hace falta.
   */
  branchesDelLo: readonly string[];
  /** Guarda el paso. Devuelve el error, o `null` si salió bien. */
  onGuardar: (paso: StepRef, revision: number, comment: string, gate: Record<string, unknown> | null) => Promise<string | null>;
  /** Mueve el cursor. Lo dispara `OK`, en el mismo gesto que el guardado. */
  /**
   * Pone el cursor en un paso y lleva a la pantalla donde ese paso vive.
   *
   * ⚠ SIRVE PARA LAS DOS DIRECCIONES, y por eso ya no se llama `onContinuar`.
   * Avanzar y volver son la misma decisión --mover el cursor y navegar-- y la
   * navegación del anfitrión resuelve el branch esperándolo, que fue el arreglo
   * de RV4. Con dos copias, el día que eso cambie hacia adelante la de atrás se
   * queda vieja.
   */
  onIrAlPaso: (destino: StepRef) => Promise<string | null>;
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

/*
 * La clave del plegado en `sessionStorage`. Una sola para toda la revisión: es
 * una preferencia de cómo se mira la pantalla, no un estado por paso -- si
 * fuera por paso, avanzar la volvería a abrir, que es exactamente lo que RV20
 * vino a cambiar.
 */
const CLAVE_PLEGADO = 'rv:panel-plegado';

/**
 * El comentario arranca en una línea y crece con el texto hasta cuatro; de ahí
 * en más scrollea, y `resize: vertical` deja agrandarlo a mano.
 *
 * ⚠ EL TECHO SE MIDE, no se clava: `lineHeight` computado por cuatro, más el
 * padding vertical del propio campo. Un `4 * 18px` escrito acá quedaría viejo
 * en cuanto la escala del módulo cambie, y «cuatro líneas» dejaría de ser
 * cuatro líneas.
 *
 * ⚠ Y `height: auto` ANTES de leer `scrollHeight`: sin eso, el alto anterior es
 * el piso y el campo sólo puede crecer -- borrar texto lo dejaría grande. Es el
 * mismo orden que hay que respetar para medir cualquier cosa que uno mismo
 * acaba de estirar.
 */
function crecerHastaCuatro(el: HTMLTextAreaElement): void {
  const est = window.getComputedStyle(el);
  const linea = Number.parseFloat(est.lineHeight);
  const relleno = Number.parseFloat(est.paddingTop) + Number.parseFloat(est.paddingBottom);
  el.style.height = 'auto';
  const techo = Number.isFinite(linea) ? linea * 4 + (Number.isFinite(relleno) ? relleno : 0) : 96;
  el.style.height = Math.min(el.scrollHeight, techo) + 'px';
}

export default function ReviewStepPanel({
  script,
  session,
  responses,
  loName,
  funnelActual,
  pasosDelPlan,
  enSitio,
  buscandoSitio,
  rutaDelPaso,
  benchmarkActual,
  linkMmiDelLo,
  onBenchmarkGuardado,
  presupuestoGuardado,
  branchesDelLo,
  onGuardar,
  onIrAlPaso,
  onResumen,
}: ReviewStepPanelProps) {
  /* Sólo para no ofrecer «andá al catálogo» estando en el catálogo. El resto de
     la decisión de lugar la resuelve el anfitrión, que ve el DOM entero. */
  const pathname = usePathname();
  const router = useRouter();
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
  /*
   * ═════════════════════════════════════════════════════════════════
   * QUÉ BOTÓN APRETARON EN LA PANTALLA DE DECISIÓN — etapa RV10
   * ═════════════════════════════════════════════════════════════════
   *
   * Es lo ÚNICO del flujo nuevo que no se deriva de la base: el resto sale de
   * `funnelActual`, que el anfitrión relee cada 4s.
   *
   * ⚠ EN `sessionStorage` Y NO EN MEMORIA, porque el flujo CRUZA UNA NAVEGACIÓN:
   * «Ver los funnels» lleva al catálogo, y de ahí `activate_funnel` lleva al
   * plan. Una recarga en el medio con el estado en memoria devolvería a la
   * persona a la pantalla de decisión, en el catálogo, sin decirle por qué.
   *
   * Misma convención que el borrador de los clics --y por la misma razón, que
   * ahí fue un agujero real-- y mismo alcance: es de ESTA sentada. Lo que queda
   * escrito es `response.gate`, no esto.
   */
  const claveDesenlace =
    'rv-funnel:' + session.session_key + ':' + cursor.phase_no + ':' + cursor.step_in_phase;
  type Desenlace = 'ver' | 'declinado' | 'kept' | 'changed' | 'deferred';
  /*
   * ⚠ EL BORRADOR GUARDA TAMBIÉN EL FUNNEL DE ANTES — RV11.
   *
   * Para confirmar un CAMBIO hay que poder ver que cambió. Sin `antes`, la
   * pantalla de confirmación se dispararía apenas la persona llega al catálogo
   * --hay funnel y el desenlace dice `changed`-- felicitándola por algo que
   * todavía no hizo.
   */
  const [desenlace, setDesenlace] = useState<{ d: Desenlace; antes?: string } | null>(() => {
    try {
      const crudo = sessionStorage.getItem(claveDesenlace);
      if (crudo === null) return null;
      const v = JSON.parse(crudo);
      return v && typeof v.d === 'string' ? v : null;
    } catch {
      /* Sin almacenamiento --o con algo ilegible-- se arranca sin decidir: se
         vuelve a preguntar, que es el lado seguro. Nunca da por decidido algo
         que nadie decidió. */
      return null;
    }
  });
  const decidir = (d: Desenlace | null, antes?: string) => {
    const v = d === null ? null : { d, ...(antes ? { antes } : {}) };
    setDesenlace(v);
    try {
      if (v === null) sessionStorage.removeItem(claveDesenlace);
      else sessionStorage.setItem(claveDesenlace, JSON.stringify(v));
    } catch {
      /* Ver la nota de arriba. */
    }
  };
  const rama = desenlace?.d ?? null;

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
   * ══════════════════════════════════════════════════════════════════════
   * MINIMIZADA, Y AHORA SE RECUERDA — etapa RV18, cambiado en RV20
   * ══════════════════════════════════════════════════════════════════════
   *
   * En RV18 era estado de React a secas, y como el panel se REMONTA en cada
   * paso --se lo pide su `key`-- se abría sola al avanzar. El argumento era que
   * un paso nuevo trae contenido nuevo que hay que leer.
   *
   * Decisión de RV20, del brief: si alguien la minimiza, sigue así hasta que la
   * abra. Es lo mismo que ya se hace con la salida del modo coach:
   * `sessionStorage`, nunca la base. Un plegado no es evidencia de nada --no
   * tiene autor ni fecha ni sentido en la historia de la revisión-- así que
   * guardarlo en `review` sería inventarle importancia; y guardarlo en
   * `localStorage` lo haría sobrevivir a la sesión, que es justo lo que no se
   * quiere: mañana, con otra persona, la tarjeta arranca abierta.
   *
   * ⚠ SE LEE EN EL INICIALIZADOR y no en un efecto: un `setState` en un efecto
   * dispara renders en cascada --la regla que este archivo ya se comió-- y el
   * panel vive debajo del anfitrión del layout raíz. El `typeof window` es por
   * el render de servidor: en la práctica este componente sólo se dibuja
   * después de que una consulta del cliente trae la sesión, así que no hay
   * desajuste de hidratación, pero leerlo sin guarda rompería el build.
   */
  const [minimizado, setMinimizado] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(CLAVE_PLEGADO) === '1';
    } catch {
      /* Modo privado, o un navegador con el almacenamiento bloqueado: que no se
         acuerde es peor que romper la revisión entera. */
      return false;
    }
  });
  const setPlegado = (v: boolean) => {
    setMinimizado(v);
    try {
      window.sessionStorage.setItem(CLAVE_PLEGADO, v ? '1' : '0');
    } catch {
      /* Igual que arriba: el estado de React ya cambió, sólo no se recuerda. */
    }
  };

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
      <div className="rv-panel" role="region" aria-label="Coaching step">
        <p className="rv-panel__gate">
          <AlertTriangleIcon size={13} /> This review points at a step that is not in the script
          any more. Nothing was lost — ask for the script to be checked.
        </p>
      </div>
    );
  }

  /*
   * ══════════════════════════════════════════════════════════════════════
   * PLEGADA: UNA PÍLDORA, NO UNA CABECERA — etapa RV20
   * ══════════════════════════════════════════════════════════════════════
   *
   * Minimizada, la tarjeta se reduce a una píldora flotante que dice fase y
   * paso, y un clic la vuelve a abrir. En RV18 el colapso dejaba la cabecera
   * entera --41px a todo el ancho-- porque la barra ocupaba el ancho; una
   * tarjeta de 420px puede desaparecer del todo.
   *
   * ⚠ SIGUE SIENDO `.rv-panel`, con un modificador, y eso NO es cosmética: el
   * anfitrión mide `.rv-panel` para publicar `--rv-relleno` (RV17). Si plegada
   * fuera otro elemento, la medición no encontraría nada, la property se
   * borraría y lo último de la página quedaría debajo de la píldora. Con el
   * modificador, el relleno se achica al alto de la píldora solo.
   *
   * ⚠ Y ESTE RETORNO VA ANTES DE TODAS LAS RAMAS a propósito: plegada es
   * plegada, sea el paso del funnel, el de «no es esta pantalla» o uno común.
   * Un colapso que sólo funcionara en la rama principal sería un colapso que
   * se abre solo al cambiar de paso.
   */
  if (minimizado) {
    return (
      <div className="rv-panel rv-panel--plegado" role="region" aria-label="Coaching step">
        <button
          type="button"
          className="rv-pill"
          data-rv-min=""
          aria-expanded={false}
          onClick={() => setPlegado(false)}
        >
          <span className="rv-panel__step">
            Phase {paso.phase_no} · Step {paso.step_in_phase}
          </span>
          <ExpandIcon size={12} />
        </button>
      </div>
    );
  }

  const siguiente = pasoSiguiente(script, cursor);
  const esUltimo = siguiente === null;

  /*
   * ══════════════════════════════════════════════════════════════════
   * VOLVER UN PASO, Y SÓLO UNO — etapa RV9, punto 3
   * ══════════════════════════════════════════════════════════════════
   *
   * Dos condiciones, y las dos son de la INTERFAZ:
   *
   *   · que el paso anterior exista -- `pasoAnterior` da `null` en el primero
   *   · que esté CONTESTADO -- volver a uno vacío no es volver, es saltar atrás
   *
   * ⚠ Y EL LÍMITE NO PUEDE VIVIR EN LA BASE. `moverCursor` es un `update` y la
   * policy acepta cualquier cursor: medido, un `PATCH` de 2.1 a 1.5 devuelve 200.
   * Un `check` no puede saber cuál es el paso anterior sin recorrer la tabla, y
   * ponerlo ahí haría vivir la regla en dos lugares. No es una frontera de
   * seguridad y no debería fingirlo: quien tenga la base abierta puede mover el
   * cursor a donde quiera, y eso ya era cierto antes de este botón.
   *
   * ⚠ VOLVER NO ESCRIBE NI BORRA NADA. Sólo mueve el cursor: `review.response`
   * queda intacta, así que el avance --que se deriva de las respuestas-- no se
   * toca y el paso que se abandona conserva la suya. Medido.
   */
  const anterior = pasoAnterior(script, cursor);
  const anteriorContestado =
    anterior !== null && latestResponse(responses, anterior) !== null;

  /*
   * ⚠ DICE A DÓNDE VA, como el `next:` de abajo. Un botón que mueve la pantalla
   * tiene que decirlo antes de que se apriete -- y acá más, porque el paso
   * anterior puede estar en OTRO MÓDULO: volver de 2.1 lleva de Outlook a
   * Business Plan.
   *
   * Mueve el cursor y navega en un gesto, por `onIrAlPaso`, que es el mismo
   * camino que usa avanzar. Y con corte: si el cursor no se movió, el error se
   * muestra y no se navega -- eso lo garantiza el anfitrión, que corta antes de
   * navegar si el `update` falló.
   */
  const botonVolver =
    anterior !== null && anteriorContestado ? (
      <button
        type="button"
        className="bp-btn bp-btn--small"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          setError(await onIrAlPaso(anterior));
          setOcupado(false);
        }}
      >
        ← back to {anterior.label}
      </button>
    ) : null;

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
  const requiereFunnel = requiereDecisionDeFunnel(paso);
  /* `=== null` estricto: `undefined` es «no lo leí» y no habilita ni bloquea. */
  const faltaFunnel = requiereFunnel && funnelActual === null;
  /* Y mientras no se haya leído, el paso no afirma nada sobre el funnel. */
  const funnelSinLeer = requiereFunnel && funnelActual === undefined;
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
  /*
   * ════════════════════════════════════════════════════════════════════
   * ⚠ FALTA EL FUNNEL: SE DICE ANTES DE BUSCAR EL LUGAR — etapa RV7
   * ════════════════════════════════════════════════════════════════════
   *
   * Sin funnel el lugar del paso es el CATÁLOGO --`.bp-catalog`--, que en el
   * perfil no existe. Así que la búsqueda corre hasta el plazo de 12s, y en ese
   * rato el panel de abajo sólo muestra la pregunta: doce segundos sin decir que
   * hay que ir a elegir, en la pantalla donde la máscara deja a la persona.
   *
   * Lo que hay que hacer NO DEPENDE de estar en el lugar correcto, así que se
   * dice acá y se termina. Y por eso este corte va antes que `buscandoSitio` y
   * que `enSitio === false`: los dos hablan de dónde estamos, y esto habla de qué
   * falta.
   *
   * ⚠ Sin campo de comentario y sin botón de avanzar: el paso no se puede
   * cerrar, ni escribiendo ni continuando desde una respuesta vieja. Es el
   * agujero de Armando Tejeda, cerrado por los dos lados.
   */
  if (funnelSinLeer) {
    /* Nada que afirmar todavía: la cabecera y la pregunta, que ya son ciertas. */
    return (
      <div className="rv-panel rv-panel--buscando" role="region" aria-label="Coaching step">
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

  /*
   * ⚠ LA COMPUERTA SE CALCULA ARRIBA DE LOS CORTES — RV10.
   *
   * Estaba después del último `return` temprano, que alcanzaba mientras las
   * vistas de arriba no la necesitaran. Las tres de la fase 3 sí: la de
   * «declinado» tiene su propio campo y su propio botón de cerrar, así que
   * necesita saber si el paso puede guardarse.
   *
   * Lo dijo el typechecker, con cuatro errores de TDZ.
   */
  const draft: StepDraft = {
    comment,
    numero: numero.trim() === '' ? null : Number(numero),
    clicks,
    budgetListo,
    /*
     * ⚠ EL DESENLACE DE LA FASE 3 — RV10. Lo único de esta compuerta que la
     * persona declara, y por eso el comentario sigue siendo obligatorio: sin
     * decir por qué, declinar no cierra el paso.
     *
     * `funnelNombre` se manda para que la evidencia guarde QUÉ se eligió ese
     * día. Ver la nota de `gateEvidence`: acá la respuesta es la fuente, no una
     * copia de una fuente viva.
     */
    desenlaceFunnel: rama === 'ver' ? null : rama,
    funnelAnterior: desenlace?.antes ?? null,
    funnelNombre: typeof funnelActual === 'string' ? funnelActual : null,
    /*
     * ⚠ Y LA CLAVE DEL ENROLAMIENTO, que estaba declarada en `StepDraft` desde
     * RV10 y NUNCA SE LLENABA -- un respaldo que nadie ejerció. `gateEvidence`
     * la escribe sólo si es un número, así que la evidencia salía sin ella y
     * nada lo delataba. Es la que permite volver del `funnel_name` de la
     * respuesta a la fila que lo produjo mientras el enrolamiento exista.
     */
    enrollmentKey: pasosDelPlan?.enrollmentKey ?? null,
    /*
     * De la base, vía el anfitrión: `business_plan.enrollment`. La pantalla no lo
     * puede poner en `true`, igual que el presupuesto.
     *
     * ⚠ `typeof === 'string'` y no `!== null`: con tres estados, `undefined`
     * --«no lo leí»-- pasaba como funnel presente. Acá no se alcanza, porque
     * `funnelSinLeer` corta antes; pero una condición que miente cuando se la
     * mueve es la clase de respaldo que hace que la ausencia no se note.
     */
    funnelListo: typeof funnelActual === 'string',
  };
  const estado = gateStatus(paso, draft);
  /*
   * ⚠ EL LINK ES EL DE LA PERSONA, Y SÓLO EN EL PASO QUE LO PIDE.
   *
   * Dos condiciones, y cada una viene de una etapa distinta:
   *
   *   DÓNDE  `showsMmiLink(paso)` -- la presencia de `gate_config.mmi_link`,
   *          que hoy sólo está en el 1.2. Esta parte se había perdido en RV21
   *          y por eso el `Open MMI` salía en los ocho pasos: al dejar de leer
   *          el dato, se fue con él la condición que el dato llevaba adentro.
   *   A QUIÉN `linkMmiDelLo` -- lo arma el anfitrión con el NMLS efectivo,
   *          `coalesce(lo_profile.nmls_override, dim_employee.nmls)`, porque el
   *          valor de `mmi_link` era el MISMO para todos: abría MMI y no el
   *          perfil de quien se está revisando.
   *
   * ⚠ Y NINGUNA DE LAS DOS TIENE RESPALDO, a propósito. Con
   * `linkMmiDelLo ?? gateLink(paso)` --mi primer intento en RV21-- la ÚNICA
   * persona sin NMLS era justamente la que recibía el link genérico, o sea que
   * el respaldo se activaba exactamente donde el brief dice que no debe haber
   * link. Sin NMLS no hay link, y sin la clave en el paso tampoco.
   */
  const link = showsMmiLink(paso) ? linkMmiDelLo : null;
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
    setError(await onIrAlPaso(siguiente!));
    setOcupado(false);
  }

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * LA FASE 3, SIN FUNNEL: TRES PANTALLAS — etapa RV10
   * ═══════════════════════════════════════════════════════════════════════
   *
   * RV7 tenía una sola: «no tiene funnel, andá al catálogo». Isabella la
   * recorrió y no alcanzó -- nadie sabía si elegía ahora o no, y el paso no
   * tenía salida si la respuesta era que no.
   *
   *   sin decidir   →  ¿van a elegir un funnel ahora?
   *   declinado     →  el comentario dice por qué, y la revisión cierra
   *   eligiendo     →  al catálogo, con el campo visible MIENTRAS miran
   *
   * ⚠ EL COMENTARIO SE ESCRIBE ANTES DE ELEGIR, no después: es lo que el brief
   * pide y es lo que cambia el sentido del paso -- se registra lo que se estaba
   * pensando, no una justificación de lo ya hecho.
   */
  if (faltaFunnel) {
    /* La pregunta cambia con la rama; la del paso queda para la decisión. */
    const preguntaDeLaRama =
      rama === 'declinado' || rama === 'deferred'
        ? promptDeLaRama(paso, 'declinado')
        : rama === 'ver' || rama === 'changed'
          ? promptDeLaRama(paso, 'catalogo')
          : null;

    return (
      <div className="rv-panel" role="region" aria-label="Coaching step">
        <div className="rv-panel__head">
          <span className="rv-panel__step">
            Phase {paso.phase_no} · step {paso.step_in_phase}
          </span>
          <span className="rv-panel__label">{paso.label}</span>
          {yaContestado && <span className="rv-panel__done">answered</span>}
        </div>
        <p className="rv-panel__prompt">{preguntaDeLaRama ?? texto.prompt}</p>

        {/* ── 1. SIN DECIDIR ──────────────────────────────────────────── */}
        {rama === null && (
          <>
            <p className="rv-panel__helper">
              {loName} has no active funnel. Deciding not to pick one is a valid outcome — it
              just has to be said, and why.
            </p>
            <div className="rv-panel__actions">
              <button
                type="button"
                className="bp-btn bp-btn--primary bp-btn--small"
                disabled={ocupado}
                onClick={() => {
                  decidir('ver');
                  /*
                   * Se navega acá y no con un `<Link>`: el botón tiene que dejar
                   * escrito el desenlace ANTES de moverse, o una recarga en el
                   * catálogo vuelve a preguntar.
                   */
                  if (!enElCatalogo) router.push(rutaDelCatalogo);
                }}
              >
                See the funnels →
              </button>
              <button
                type="button"
                className="bp-btn bp-btn--small"
                disabled={ocupado}
                onClick={() => decidir('declinado')}
              >
                Not now
              </button>
            </div>
          </>
        )}

        {/* ── 2. DECLINADO ───────────────────────────────────────────── */}
        {rama === 'declinado' && (
          <>
            <label className="rv-panel__field">
              <span className="rv-panel__fieldlabel">Comment</span>
              <textarea
                className="field rv-panel__text"
                data-review-comment=""
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Why not now?"
              />
            </label>
            {!estado.ok && estado.falta && (
              <p className="rv-panel__gate">{estado.falta}</p>
            )}
            <div className="rv-panel__actions">
              <button
                type="button"
                className="bp-btn bp-btn--primary bp-btn--small"
                disabled={!estado.ok || ocupado}
                onClick={guardarYSeguir}
              >
                {esUltimo ? 'Finish coaching' : 'OK'}
              </button>
              <button
                type="button"
                className="rv-panel__edit"
                disabled={ocupado}
                onClick={() => decidir(null)}
              >
                Back to the choice
              </button>
            </div>
          </>
        )}

        {/* ── 3. ELIGIENDO, EN EL CATÁLOGO ──────────────────────────── */}
        {rama === 'ver' && (
          <>
            {!enElCatalogo ? (
              <div className="rv-panel__actions">
                <Link className="bp-btn bp-btn--primary bp-btn--small" href={rutaDelCatalogo}>
                  Open the funnel catalog →
                </Link>
              </div>
            ) : (
              <>
                {/*
                  ⚠ EL CAMPO ESTÁ MIENTRAS MIRAN, y el botón de cerrar NO. El paso
                  se cierra al seleccionar, no acá: lo que se escribe es lo que
                  están pensando frente a las plantillas.
                */}
                <label className="rv-panel__field">
                  <span className="rv-panel__fieldlabel">Comment</span>
                  <textarea
                    className="field rv-panel__text"
                    data-review-comment=""
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="What catches your eye?"
                  />
                </label>
                <p className="rv-panel__helper">
                  Press <strong>Select</strong> on the one you agreed on. What you write here is
                  kept.
                </p>
              </>
            )}
            <div className="rv-panel__actions">
              <button
                type="button"
                className="rv-panel__edit"
                disabled={ocupado}
                onClick={() => decidir(null)}
              >
                Back to the choice
              </button>
            </div>
          </>
        )}

        {botonVolver && <div className="rv-panel__actions">{botonVolver}</div>}
      </div>
    );
  }

  /*
   * ══════════════════════════════════════════════════════════════════════
   * LA CONFIRMACIÓN: EL FUNNEL APARECIÓ MIENTRAS MIRABAN — etapa RV10
   * ══════════════════════════════════════════════════════════════════════
   *
   * Tres condiciones, y las tres hacen falta:
   *
   *   · hay funnel                 -- la selección ocurrió
   *   · el desenlace dice `ver`    -- pasó por el catálogo EN ESTA SENTADA
   *   · el paso no está contestado -- no es una revisión que se retoma
   *
   * La segunda es la que distingue «acaba de elegir» de «ya tenía uno»: sin
   * ella, Adriana --que tiene funnel desde septiembre-- entraría a una pantalla
   * que le felicita por algo que no hizo hoy.
   *
   * ⚠ Y EL COMENTARIO YA ESTABA ESCRITO, en el catálogo. Se muestra, no se
   * vuelve a pedir. Si viene vacío --una recarga entre el catálogo y acá-- se
   * ofrece el campo: la compuerta lo exige igual, así que el panel se cura solo
   * en vez de trabarse.
   */
  /*
   * ═══════════════════════════════════════════════════════════════════
   * CON FUNNEL TAMBIÉN HAY QUE DECIDIR — etapa RV11
   * ═══════════════════════════════════════════════════════════════════
   *
   * Es la mitad de las revisiones. Que un camino tenga pantalla de decisión y el
   * otro no hacía que la mitad de las entrevistas se sintieran distintas sin
   * razón -- y sobre todo: «ya tenía uno» no es «alguien lo miró hoy».
   *
   * La pregunta de esta rama es otra: no «¿cuál eligen?» sino «¿siguen con
   * éste, o lo cambian?».
   *
   * ⚠ Y «cambiarlo» DESTRUYE. `allow_second` sigue en `false`, así que cambiar
   * pasa por `change_funnel`, que cancela el actual -- y `cancel_funnel` BORRA
   * el plan, sus nodos, sus milestones y sus notas. Por eso el botón dice
   * cuántos pasos hechos se pierden ANTES de que se apriete, y el catálogo lo
   * vuelve a decir en su modal, que es donde se confirma.
   *
   * ⚠ Y MIENTRAS NO SE SEPA CUÁNTO, NO SE OFRECE. `pasosDelPlan` en `undefined`
   * es «todavía no leí», y un «0 pasos» dicho antes de leer sería una mentira
   * tranquilizadora en la pantalla que ofrece destruirlos.
   */
  if (
    requiereFunnel &&
    typeof funnelActual === 'string' &&
    yaContestado === null &&
    rama === null
  ) {
    const hechos = pasosDelPlan?.hechos ?? null;
    /*
     * ⚠ SIN LA CLAVE NO SE OFRECE CAMBIAR, aunque el conteo ya esté.
     *
     * Es una guarda redundante a propósito: hoy las dos salen de la misma
     * lectura y no pueden faltar por separado. Si alguna vez se separan, esto
     * apaga el botón en vez de mandar al catálogo un `?change=undefined`, que lo
     * dejaría en modo alta -- y el modo alta sobre alguien que ya tiene plan es
     * exactamente el defecto que esta línea vino a cerrar.
     */
    const claveDelPlan = pasosDelPlan?.enrollmentKey ?? null;
    return (
      <div className="rv-panel" role="region" aria-label="Coaching step">
        <div className="rv-panel__head">
          <span className="rv-panel__step">
            Phase {paso.phase_no} · step {paso.step_in_phase}
          </span>
          <span className="rv-panel__label">{paso.label}</span>
        </div>
        <p className="rv-panel__prompt">
          {loName} is on <strong>{funnelActual}</strong>. Keep it, change it, or leave it for now?
        </p>
        {pasosDelPlan && (
          <p className="rv-panel__helper">
            {pasosDelPlan.hechos} of {pasosDelPlan.total} stages done.
          </p>
        )}
        <div className="rv-panel__actions">
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--small"
            disabled={ocupado}
            onClick={() => decidir('kept')}
          >
            Keep it
          </button>
          <button
            type="button"
            className="bp-btn bp-btn--small"
            disabled={ocupado || hechos === null || claveDelPlan === null}
            onClick={() => {
              decidir('changed', funnelActual);
              /*
               * ═══════════════════════════════════════════════════════════
               * ⚠ CON `?change=<enrollment_key>` — RV12
               * ═══════════════════════════════════════════════════════════
               *
               * Sin el parámetro esto era una puerta a una pared. El catálogo
               * entra en modo cambio SÓLO por la URL, y sin él dibuja `Select`,
               * que llama a `activate_funnel` -- que sobre alguien que ya tiene
               * plan choca contra `enrollment_one_active_idx` y falla. O sea:
               * el paso quedaba registrado como `changed` y el cambio no podía
               * ocurrir por ninguna vía desde esta pantalla.
               *
               * No lo encontró ninguna aserción de RV11: se midió que el botón
               * DIJERA lo que cuesta, y decía bien. Apareció al apretarlo.
               *
               * Y la condición mira la URL de verdad --no `enElCatalogo`-- porque
               * estando YA en el catálogo en modo alta hay que navegar igual: el
               * pathname es el mismo y el modo es el que cambia.
               */
              const destino = rutaDelCatalogo + '?change=' + claveDelPlan;
              if (window.location.pathname + window.location.search !== destino) {
                router.push(destino);
              }
            }}
          >
            {hechos === null
              ? 'Change it — checking what it would cost…'
              : hechos === 0
                ? 'Change it'
                : 'Change it — deletes ' + hechos + ' completed step' + (hechos === 1 ? '' : 's')}
          </button>
          <button
            type="button"
            className="bp-btn bp-btn--small"
            disabled={ocupado}
            onClick={() => decidir('deferred')}
          >
            Leave it for now
          </button>
        </div>
        {botonVolver && <div className="rv-panel__actions">{botonVolver}</div>}
      </div>
    );
  }

  /*
   * «Seguir» y «dejarlo por ahora» terminan con el mismo funnel activo y son
   * distintos en el registro: uno es una decisión y el otro es no haberla
   * tomado. La pantalla es la misma --el comentario y cerrar-- y lo que cambia
   * es lo que queda escrito.
   */
  if (
    requiereFunnel &&
    typeof funnelActual === 'string' &&
    yaContestado === null &&
    (rama === 'kept' || rama === 'deferred')
  ) {
    return (
      <div className="rv-panel" role="region" aria-label="Coaching step">
        <div className="rv-panel__head">
          <span className="rv-panel__step">
            Phase {paso.phase_no} · step {paso.step_in_phase}
          </span>
          <span className="rv-panel__label">{paso.label}</span>
        </div>
        <p className="rv-panel__prompt">
          {rama === 'kept'
            ? 'Staying on ' + funnelActual + ' — why is it still the right one?'
            : 'Leaving ' + funnelActual + ' as it is for now — why not decide today?'}
        </p>
        <label className="rv-panel__field">
          <span className="rv-panel__fieldlabel">Comment</span>
          <textarea
            className="field rv-panel__text"
            data-review-comment=""
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={rama === 'kept' ? 'Why keep it?' : 'Why not decide now?'}
          />
        </label>
        {!estado.ok && estado.falta && <p className="rv-panel__gate">{estado.falta}</p>}
        {error && (
          <p className="rv-panel__gate" role="alert">
            <AlertTriangleIcon size={13} /> {error}
          </p>
        )}
        <div className="rv-panel__actions">
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--small"
            disabled={!estado.ok || ocupado}
            onClick={guardarYSeguir}
          >
            {esUltimo ? 'Finish coaching' : 'OK'}
          </button>
          <button
            type="button"
            className="rv-panel__edit"
            disabled={ocupado}
            onClick={() => decidir(null)}
          >
            Back to the choice
          </button>
        </div>
      </div>
    );
  }

  const confirmandoEleccion = rama === 'ver';
  /* Un cambio se confirma cuando el nombre YA NO ES el de antes. Sin esa
     comparación, llegar al catálogo sin tocar nada ya felicitaría. */
  const confirmandoCambio =
    rama === 'changed' && desenlace?.antes !== undefined && funnelActual !== desenlace.antes;
  if (
    typeof funnelActual === 'string' &&
    requiereFunnel &&
    (confirmandoEleccion || confirmandoCambio) &&
    yaContestado === null
  ) {
    return (
      <div className="rv-panel" role="region" aria-label="Coaching step">
        <div className="rv-panel__head">
          <span className="rv-panel__step">
            Phase {paso.phase_no} · step {paso.step_in_phase}
          </span>
          <span className="rv-panel__label">{paso.label}</span>
        </div>
        <p className="rv-panel__prompt">
          Done — <strong>{funnelActual}</strong> is selected.
          {confirmandoCambio && desenlace?.antes ? (
            <>
              {' '}
              It replaces <strong>{desenlace.antes}</strong>.
            </>
          ) : null}
        </p>
        {comment.trim() === '' ? (
          <label className="rv-panel__field">
            <span className="rv-panel__fieldlabel">Comment</span>
            <textarea
              className="field rv-panel__text"
              data-review-comment=""
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Why this funnel?"
            />
          </label>
        ) : (
          <div className="rv-panel__saved">
            <p className="rv-panel__savedtext">{comment}</p>
          </div>
        )}
        {!estado.ok && estado.falta && <p className="rv-panel__gate">{estado.falta}</p>}
        {error && (
          <p className="rv-panel__gate" role="alert">
            <AlertTriangleIcon size={13} /> {error}
          </p>
        )}
        <div className="rv-panel__actions">
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--small"
            disabled={!estado.ok || ocupado}
            onClick={guardarYSeguir}
          >
            {esUltimo ? 'Finish coaching' : 'OK'}
          </button>
        </div>
      </div>
    );
  }

  if (buscandoSitio) {
    return (
      <div className="rv-panel rv-panel--buscando" role="region" aria-label="Coaching step">
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
      <div className="rv-panel rv-panel--lejos" role="region" aria-label="Coaching step">
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
          {rutaDelPaso === '' ? (
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

  return (
    <div className="rv-panel" role="region" aria-label="Coaching step">
      {/*
        ══════════════════════════════════════════════════════════════════
        LA CABECERA DE LA BARRA — etapa RV18
        ══════════════════════════════════════════════════════════════════

        Fase, paso, rótulo y el botón de minimizar. Es lo ÚNICO que queda
        cuando la barra está colapsada, y por eso el nombre del paso vive acá y
        no en una zona: minimizada tiene que seguir diciendo dónde está la
        revisión, o el modo coach se vuelve un borde de color sin explicación.
      */}
      <div className="rv-panel__bar">
        <span className="rv-panel__step">
          Phase {paso.phase_no} · step {paso.step_in_phase}
        </span>
        <span className="rv-panel__label">{paso.label}</span>
        {yaContestado && <span className="rv-panel__done">answered</span>}
        {/*
          ⚠ MINIMIZAR NO ES CERRAR, y el rótulo lo dice: pliega la tarjeta a una
          píldora para ver el tablero completo SIN salir del modo coach --que es
          lo que hace `Save and exit`, y eso suelta la máscara--.

          Y desde RV20 se RECUERDA entre pasos, en `sessionStorage`: ver la nota
          del estado. Antes se abría sola al avanzar, porque el panel se remonta
          con su `key`.
        */}
        {/*
          ══════════════════════════════════════════════════════════════════
          ⚠ ACÁ ESTABA EL AVISO DE RV19, Y SE FUE — etapa RV20
          ══════════════════════════════════════════════════════════════════

          «Part of the numbers is behind this bar» existía porque la barra al
          ancho completo tapaba la tarjeta de métricas en el paso 1.5. Con la
          tarjeta anclada a la izquierda el lado derecho queda libre POR
          CONSTRUCCIÓN, así que ese aviso ya no puede hacer falta.

          Y no se borró «por si acaso»: medido en los ocho pasos con la tarjeta
          nueva, el cruce con `.bp-stats` es CERO en todos, con 1.162px libres a
          la derecha. Lo que además apareció en esa medición es que el aviso
          SEGUÍA DISPARÁNDOSE en el 1.4 y el 1.5 -- porque su condición miraba
          sólo el corte vertical y no el cruce real-- o sea que había pasado a
          ser exactamente lo que RV19 vino a evitar: un aviso que aparece cuando
          no falta nada.

          Se fue completo: el aviso, su medición en el anfitrión, la prop y la
          clase. Un respaldo que ya no puede dispararse esconde la próxima
          falla, y ese es el patrón de «lo que compensa una ausencia».
        */}
        <button
          type="button"
          className="rv-panel__min"
          data-rv-min=""
          aria-expanded={!minimizado}
          onClick={() => setPlegado(!minimizado)}
        >
          {minimizado ? <ExpandIcon size={12} /> : <CollapseIcon size={12} />}
          {minimizado ? 'Expand' : 'Minimize'}
        </button>
      </div>

      {minimizado ? null : (
      <div className="rv-panel__zonas">
      {/* ── IZQUIERDA: el contexto ────────────────────────────────────── */}
      <div className="rv-panel__zona rv-panel__zona--ctx">
      <p className="rv-panel__prompt">{texto.prompt}</p>
      {texto.helper && <p className="rv-panel__helper">{texto.helper}</p>}

      {/*
        El link del 1.2 -- el paso que setea el benchmark: se abre y se acuerda
        el número ahí mismo. En los otros siete `link` es `null`, porque
        `gate_config` no trae `mmi_link`.
      */}
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

        ⚠ Y ESE NOMBRE TAMPOCO ES EL DEL CATÁLOGO. La tarjeta dice `Select`, y
        activa de una cuando la persona no tiene plan; `Select this funnel` es
        el del explorador, detrás de «click to explore»; y el modal de cambio
        dice `Replace the plan`. Tres rótulos para el mismo acto, según el
        camino -- así que un texto de guía que nombre uno solo manda a buscar un
        botón que puede no estar a la vista.

        Son dos diseños distintos, y el segundo funciona: se midió en RV5 y el
        paso se cierra. Queda escrito porque **el brief sigue diciendo el otro**,
        así que quien lo lea y busque el botón en este archivo no lo va a
        encontrar, y la ausencia parece un bug en vez de una decisión.
      */}
      {paso.phase_no === 3 && (
        <div className="rv-panel__funnel">
          {/*
            ⚠ ACÁ EL FUNNEL SIEMPRE EXISTE. El corte de `faltaFunnel` de arriba se
            queda con el caso «sin funnel» y el de `funnelSinLeer` con «no leí»,
            así que llegar hasta acá en la fase 3 ya significa que hay uno activo.
            Antes esto tenía una rama para el caso vacío; quedó inalcanzable y se
            borró, porque una rama muerta se lee como viva.
          */}
          {(
            <>
              <p className="rv-panel__helper">
                {loName} is on <strong>{funnelActual}</strong>. Confirming keeps it — nothing is
                cancelled.
              </p>
              {/*
                ⚠ ACÁ HABÍA UN PÁRRAFO DE CUATRO RENGLONES, Y SE FUE — etapa RV21.

                Decía por qué no se puede agregar un segundo funnel: que la app
                muestra un plan por persona, que el segundo sería invisible, y
                que cambiar este cancelaría el plan y sus steps completados.
                Todo cierto, y demasiado para una tarjeta de 420px --el mismo
                criterio que sacó `CalcNote` del perfil en BP50: si algo
                necesita tres renglones, no va en la vista--.

                No queda nada en su lugar: la opción sigue sin ofrecerse y eso
                se ve solo. Las razones no se perdieron -- viven en la nota de
                `allowsSecondFunnel` y en el SQL de `allow_second`, que es
                donde las busca quien las necesita.
              */}
            </>
          )}
        </div>
      )}

      </div>

      {/* ── CENTRO: las entradas ──────────────────────────────────────── */}
      <div className="rv-panel__zona rv-panel__zona--in">
      {paso.gate_kind === 'number' && editando && (
        <label className="rv-panel__field rv-panel__field--num">
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
                now {benchmarkActual} / month · replaces it
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
            /* Angosto: el placeholder largo no cabe en 96px y el rótulo ya dice
               qué es -- etapa RV20. */
            placeholder="0"
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
            ? "Budget saved for " + loName + " during this coaching session."
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
        ⚠ EL CAMPO SÓLO EXISTE EDITANDO. Un paso ya guardado muestra lo que se
        dijo, y volver a abrirlo es el `Edit` de abajo. Es lo que reemplaza al
        `Save again` permanente.

        Y sin funnel no hay campo tampoco -- eso es el orden del brief: primero se
        elige, después se comenta. Pero no se decide acá: el corte de
        `faltaFunnel` de arriba se lleva ese caso con su propio panel, así que
        este guard nunca se ejercía. Lo encontró un conteo de usos sobre el
        código, no yo.
      */}
      {editando ? (
        <label className="rv-panel__field rv-panel__field--wide">
          <span className="rv-panel__fieldlabel">Comment</span>
          {/*
            ⚠ ARRANCA EN UNA LÍNEA Y CRECE HASTA CUATRO — etapa RV20.

            El brief pide el comentario «como una línea, no un área alta», y
            avisa del riesgo: si no se puede leer lo que se escribió, el alto
            ahorrado sale más caro. Una línea fija resuelve el alto y rompe la
            escritura -- un comentario de tres renglones se vuelve un campo por
            el que hay que scrollear a ciegas.

            Así que arranca en una y crece con el texto hasta cuatro, y de ahí
            scrollea. `resize: vertical` sigue puesto, así que se puede agrandar
            a mano más allá de eso.

            El techo se mide del propio elemento (`lineHeight` computado), no de
            un número de píxeles clavado: la escala del módulo puede cambiar y
            cuatro líneas siguen siendo cuatro líneas.
          */}
          <textarea
            className="field rv-panel__text"
            data-review-comment=""
            rows={1}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              crecerHastaCuatro(e.currentTarget);
            }}
            ref={(el) => {
              if (el !== null) crecerHastaCuatro(el);
            }}
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

      </div>

      {/* ── DERECHA: las acciones, con lo que falta al lado ───────────── */}
      <div className="rv-panel__zona rv-panel__zona--act">
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
        ⚠ EL MOTIVO AL LADO DEL BOTÓN, no sólo el botón apagado. Un control
        deshabilitado sin explicación obliga a adivinar si falta algo o si la app
        está rota.

        RV6 tenía acá `editando || faltaFunnel`, para que un paso ya contestado y
        sin funnel dijera por qué no avanzaba. El corte de RV7 se queda con ese
        caso completo --panel propio, con su guía y su botón al catálogo-- así
        que acá `faltaFunnel` ya no puede ser true y la condición vuelve a ser la
        simple.
      */}
      {editando && !estado.ok && estado.falta && <p className="rv-panel__gate">{estado.falta}</p>}

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
              ⚠ ESTE BOTÓN NO PASA POR `gateStatus`: avanza sin más, porque no hay
              nada nuevo que guardar. Y sobre el último paso ese avance es
              `Review and finish`, o sea CERRAR LA REVISIÓN -- con el comentario
              ya escrito y sin funnel era una salida limpia al agujero de la
              fase 3.
              Lo tapa el corte de `faltaFunnel` de arriba, que se lleva ese caso
              antes de llegar acá: sin funnel no se dibuja ningún botón de
              avanzar. Se deja escrito porque el próximo que mueva ese corte
              tiene que saber qué estaba protegiendo.
            */
            disabled={ocupado}
            onClick={async () => {
              if (esUltimo) {
                onResumen();
                return;
              }
              setOcupado(true);
              setError(await onIrAlPaso(siguiente!));
              setOcupado(false);
            }}
          >
            {esUltimo ? 'Review and finish' : 'Continue →'}
          </button>
        )}

        {botonVolver}

        {/* Qué sigue, en palabras. Un botón que mueve la pantalla tiene que
            decir a dónde antes de que se aprete. */}
        {!esUltimo && rotuloSiguiente && (
          <span className="rv-panel__next">next: {rotuloSiguiente}</span>
        )}
      </div>
      </div>
      </div>
      )}
    </div>
  );
}
