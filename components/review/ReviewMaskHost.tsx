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

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMyReviews, useReviewScript } from '@/lib/review/useReviewData';
import ReviewMask from './ReviewMask';

export interface ReviewMaskHostProps {
  /**
   * `true` si la sesión pertenece a la app. Es el gate barato: quien no tiene
   * `commercial_activity` no puede tener una revisión, y RLS lo confirmaría
   * igual — esto sólo evita preguntarlo.
   */
  puedeRevisar: boolean;
}

export default function ReviewMaskHost({ puedeRevisar }: ReviewMaskHostProps) {
  const script = useReviewScript();
  const reviews = useMyReviews();
  const pathname = usePathname();

  /*
   * ⚠ EL AVISO DE CARGA SE DERIVA DEL CAMBIO DE RUTA, no de un `setTimeout`.
   *
   * Cruzar a Outlook tarda segundos y la pantalla queda en blanco. El aviso se
   * enciende cuando el `pathname` cambia a otro módulo y se apaga cuando el
   * navegador termina de pintar el siguiente cuadro después de esa ruta.
   *
   * `requestAnimationFrame` doble y no un timeout fijo: un número inventado
   * mentiría en las dos direcciones -- se apagaría antes de que cargue en una
   * máquina lenta, y quedaría encendido después de cargar en una rápida. Es la
   * misma razón por la que `medirRuta` no fija el timeout.
   */
  const [cargandoModulo, setCargandoModulo] = useState<string | null>(null);
  const rutaPrevia = useRef(pathname);

  useEffect(() => {
    const modulo = (p: string) => p.split('/')[1] ?? '';
    const antes = modulo(rutaPrevia.current);
    const ahora = modulo(pathname);
    rutaPrevia.current = pathname;
    if (antes === ahora || antes === '') return;

    setCargandoModulo(ahora === 'outlook' ? 'Outlook' : ahora === 'business-plan' ? 'Business Plan' : ahora);
    let vivo = true;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (vivo) setCargandoModulo(null);
      })
    );
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
    };
  }, [pathname]);

  const onSaveAndExit = useCallback(() => {
    /*
     * No escribe nada: cada paso ya se guardó al completarse, así que salir no
     * tiene que confirmar nada. Lo único que hace falta es que la lista vuelva
     * a leerse cuando la persona llegue, y de eso se encarga su propia página.
     */
    reviews.reload();
  }, [reviews]);

  if (!puedeRevisar) return null;

  const activo =
    (reviews.data ?? []).find((r) => r.session?.status === 'in_progress') ?? null;

  return (
    <ReviewMask
      script={script.data}
      activo={activo}
      cargandoModulo={cargandoModulo}
      onSaveAndExit={onSaveAndExit}
    />
  );
}
