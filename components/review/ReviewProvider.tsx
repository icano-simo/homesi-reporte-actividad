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

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMyReviews, useReviewScript, type ReviewUnavailable } from '@/lib/review/useReviewData';
import type { MyReview, ReviewScript } from '@/lib/review/types';

export interface ReviewContextValue {
  script: ReviewScript | null;
  scriptUnavailable: ReviewUnavailable;
  scriptError: string | null;
  reviews: MyReview[] | null;
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

  const valor = useMemo<ReviewContextValue>(
    () => ({
      script: script.data,
      scriptUnavailable: script.unavailable,
      scriptError: script.error,
      reviews: reviews.data,
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
