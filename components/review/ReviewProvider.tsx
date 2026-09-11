'use client';

/**
 * ============================================================================
 * UNA SOLA LECTURA DE LA REVISIÓN, COMPARTIDA
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO, y arregla un defecto real.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL DEFECTO QUE ESTO ARREGLA
 * ---------------------------------------------------------------------------
 * La máscara vive en el layout raíz para sobrevivir al cruce de módulo. Eso se
 * logró — y trajo lo otro: el layout raíz NO se desmonta al navegar, así que su
 * `useMyReviews` corría UNA vez por carga completa de página y nunca más.
 *
 * Y `reviews.reload()` de la pantalla que crea la sesión era OTRA INSTANCIA del
 * hook. No lo alcanzaba. La secuencia que rompía:
 *
 *   1. cargar `/review`        → el anfitrión consulta: cero sesiones
 *   2. `Start review`          → `/review/15` CREA la sesión (otra instancia)
 *   3. `router.push` al perfil → navegación de cliente; el anfitrión no se
 *                                desmonta y su `data` sigue diciendo cero
 *   4. no hay máscara
 *
 * Medido: al navegar de cliente, CERO consultas nuevas a `assignment`. Y con la
 * sesión ya existente al montar, la barra aparece bien — o sea que el problema
 * nunca fue el dibujo.
 *
 * ⚠ Y ES EL CAMINO QUE MIS 34 ASERCIONES NO EJERCIERON. Verificaban «sin sesión
 * no dibuja nada», que era el único caso que podía montar entonces. El caso con
 * sesión creada EN VIVO no se midió, y es el que fallaba.
 *
 * ---------------------------------------------------------------------------
 * LA FORMA: UN PROVEEDOR, COMO `BusinessPlanDataProvider`
 * ---------------------------------------------------------------------------
 * Una sola instancia de cada hook, en el layout raíz, y todos leen de acá — el
 * anfitrión de la máscara y las tres pantallas. Así `recargar()` desde cualquier
 * lado alcanza a la barra.
 *
 * La alternativa era que el anfitrión volviera a consultar en cada cambio de
 * ruta. Se descartó: serían cinco consultas por navegación para todo el portal,
 * y seguiría sin enterarse de un cambio hecho SIN navegar. Un solo estado
 * compartido no tiene ninguno de los dos problemas.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMyReviews, useReviewScript, type ReviewUnavailable } from '@/lib/review/useReviewData';
import { salirDeLaMascara, useSalidas } from '@/lib/review/maskExit';
import type { MyReview, ReviewScript } from '@/lib/review/types';

export interface ReviewContextValue {
  script: ReviewScript | null;
  scriptUnavailable: ReviewUnavailable;
  scriptError: string | null;
  /**
   * TODAS las asignaciones activas que la sesion puede ver. Con `review_admin`
   * son las de todo el mundo -- es lo que la pantalla de configuracion
   * necesita, y por eso esta lista NO esta filtrada.
   */
  reviews: MyReview[] | null;
  /**
   * Las que ESTA persona revisa. `null` mientras no se sepa quien es.
   *
   * ⚠ Existe porque `reviews` no sirve para esto y se estaba usando igual:
   * con `review_admin`, /review listaba las revisiones de todos y la mascara
   * se prendia con la sesion en curso de otra persona -- su nombre en la barra
   * y un boton `OK` sobre su paso. Se deriva ACA, una sola vez, para que los
   * dos lugares que quieren decir "las mias" no puedan divergir.
   */
  myReviews: MyReview[] | null;
  /**
   * ═════════════════════════════════════════════════════════════════
   * LA QUE SE ESTÁ RECORRIENDO AHORA — etapa RV5
   * ═════════════════════════════════════════════════════════════════
   *
   * ⚠ NO ES LO MISMO QUE «hay una sesión `in_progress`», y confundirlas era el
   * defecto: `Save and exit` llamaba a `recargar()`, la sesión seguía abierta --
   * como debe-- y la barra se volvía a dibujar. El botón no hacía lo que decía.
   *
   * Son tres estados y ahora se distinguen:
   *
   *   recorriendo !== null                    la máscara está puesta
   *   recorriendo === null, myReviews con una en curso   salió, y se retoma
   *   recorriendo === null, ninguna en curso            no hay revisión
   *
   * `null` mientras `myReviews` no llegó: no se sabe todavía, que no es «no hay».
   */
  recorriendo: MyReview | null;
  /** Suelta la máscara SIN cerrar la sesión. Sobrevive a una recarga. */
  salirDeLaRevision: () => void;
  reviewsUnavailable: ReviewUnavailable;
  reviewsError: string | null;
  isLoading: boolean;
  /** `null` = el email de la sesión no está en el roster activo. */
  myEmployeeKey: number | null | undefined;
  /** `true` si puede asignar. Sale de `review.can_assign()`, no de un claim. */
  canAssign: boolean | undefined;
  /** Vuelve a leer las asignaciones y sus sesiones. Alcanza a la máscara. */
  recargar: () => void;
  /**
   * `false` cuando la persona no puede tener una revisión. El proveedor no
   * consulta nada en ese caso.
   */
  habilitado: boolean;
}

/*
 * El valor por defecto es el de «no hay proveedor», y NO uno vacío que parezca
 * cargado: `isLoading: false` con `reviews: null` se leería como «ya consulté y
 * no hay nada». Con `habilitado: false` la pantalla sabe que no debe concluir.
 */
const SIN_PROVEEDOR: ReviewContextValue = {
  script: null,
  scriptUnavailable: null,
  scriptError: null,
  reviews: null,
  myReviews: null,
  recorriendo: null,
  salirDeLaRevision: () => {},
  reviewsUnavailable: null,
  reviewsError: null,
  isLoading: false,
  myEmployeeKey: undefined,
  canAssign: undefined,
  recargar: () => {},
  habilitado: false,
};

const Ctx = createContext<ReviewContextValue>(SIN_PROVEEDOR);

/** Lo que consumen la máscara y las tres pantallas. */
export function useReview(): ReviewContextValue {
  return useContext(Ctx);
}

export interface ReviewProviderProps {
  /**
   * `true` si la sesión pertenece a la app. Lo resuelve el SERVIDOR con el
   * claim que ya se lee para el header.
   *
   * ⚠ Sin este corte, cada carga de cualquier página del portal dispararía
   * cinco consultas a `review` para las 97 personas que no son del BP Team — y
   * todas devolverían cero filas por RLS, que es la forma más cara de no hacer
   * nada.
   */
  puedeRevisar: boolean;
  children: ReactNode;
}

export default function ReviewProvider({ puedeRevisar, children }: ReviewProviderProps) {
  /*
   * ⚠ LOS HOOKS SE LLAMAN SIEMPRE, con o sin permiso: llamarlos condicionalmente
   * rompe el orden de hooks de React. El corte se hace ADENTRO -- cada hook
   * recibe `habilitado` y no consulta si es `false`.
   */
  const script = useReviewScript(puedeRevisar);
  const reviews = useMyReviews(puedeRevisar);

  /*
   * Las mias. `undefined` en `myEmployeeKey` es "todavia no se sabe" y devuelve
   * `null`; `null` es "el email no esta en el roster activo" y devuelve la
   * lista vacia, que es correcta: esa persona no revisa a nadie.
   *
   * Los dos estados no se compensan a `[]`: una lista vacia diria "no te toca
   * ninguna" cuando lo que pasa es que no se pregunto todavia.
   */
  const mias = useMemo<MyReview[] | null>(() => {
    if (reviews.data === null || reviews.myEmployeeKey === undefined) return null;
    return reviews.data.filter(
      (r) => r.assignment.reviewer_employee_key === reviews.myEmployeeKey
    );
  }, [reviews.data, reviews.myEmployeeKey]);

  /*
   * La sesión que se está recorriendo: la en curso de la que NO se salió.
   *
   * ⚠ La salida se lee de `localStorage` con `useSyncExternalStore`, así que
   * sobrevive a una recarga y se entera de lo que pasa en otra pestaña. Ver
   * `lib/review/maskExit.ts`, que explica por qué no es estado de React ni una
   * columna de la base.
   */
  const salio = useSalidas();
  const recorriendo = useMemo<MyReview | null>(() => {
    if (mias === null) return null;
    return (
      mias.find(
        (r) => r.session?.status === 'in_progress' && !salio(r.session.session_key)
      ) ?? null
    );
  }, [mias, salio]);

  const salirDeLaRevision = useCallback(() => {
    const k = recorriendo?.session?.session_key;
    if (k !== undefined) salirDeLaMascara(k);
  }, [recorriendo]);

  const valor = useMemo<ReviewContextValue>(
    () => ({
      script: script.data,
      scriptUnavailable: script.unavailable,
      scriptError: script.error,
      reviews: reviews.data,
      myReviews: mias,
      recorriendo,
      salirDeLaRevision,
      reviewsUnavailable: reviews.unavailable,
      reviewsError: reviews.error,
      isLoading: script.isLoading || reviews.isLoading,
      myEmployeeKey: reviews.myEmployeeKey,
      canAssign: reviews.canAssign,
      recargar: reviews.reload,
      habilitado: puedeRevisar,
    }),
    [
      script.data,
      script.unavailable,
      script.error,
      script.isLoading,
      reviews.data,
      mias,
      recorriendo,
      salirDeLaRevision,
      reviews.unavailable,
      reviews.error,
      reviews.isLoading,
      reviews.myEmployeeKey,
      reviews.canAssign,
      reviews.reload,
      puedeRevisar,
    ]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
