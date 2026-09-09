'use client';

/**
 * ============================================================================
 * LA MÁSCARA DEL MODO REVISIÓN
 * ============================================================================
 *
 * Etapa RV1 — ARCHIVO NUEVO.
 *
 * ---------------------------------------------------------------------------
 * ⚠ VIVE EN EL LAYOUT RAÍZ, Y ESO ES EL REQUISITO, NO UNA UBICACIÓN CÓMODA
 * ---------------------------------------------------------------------------
 * La revisión cruza de Business Plan a Outlook y vuelve. Si la barra viviera en
 * el layout de un módulo se DESMONTARÍA al cruzar, y con ella el estado de la
 * sesión en memoria: la persona vería la máscara desaparecer en la mitad de una
 * conversación con el Loan Officer.
 *
 * La documentación de Next lo dice de forma explícita — «Layouts do not
 * re-render on navigation» (`03-api-reference/03-file-conventions/layout.md`),
 * y es por eso que el layout raíz es el único lugar donde esto funciona. Leído
 * antes de escribirlo, no después.
 *
 * ---------------------------------------------------------------------------
 * ⚠ Y NO DIBUJA NADA SI NO HAY SESIÓN EN CURSO
 * ---------------------------------------------------------------------------
 * Ni la barra, ni el borde, ni un contenedor vacío. La app normal tiene que
 * quedar idéntica: si la máscara dejara un `<div>` de altura cero en el layout
 * raíz, cualquier regla futura de `body > div:first-child` cambiaría de
 * significado para las cuatro pantallas del portal.
 *
 * Es el mismo criterio que hace que los campos de comentario sólo existan en
 * modo revisión: lo que no está no puede quedar suelto.
 */

import Link from 'next/link';
import { REVIEW_PATH } from '@/lib/auth/routes';
import type { MyReview } from '@/lib/review/types';

export interface ReviewMaskProps {
  /** La revisión con sesión EN CURSO, o `null` si no hay ninguna. */
  activo: MyReview | null;
  onSaveAndExit: () => void;
}

/*
 * ⚠ YA NO RECIBE EL GUION, y no es una limpieza cosmética.
 *
 * RV1 lo exígia con este motivo, que era correcto entonces: «dibujar la barra
 * sin poder decir en qué fase va sería una barra que miente sobre el avance».
 * Desde RV2 la barra NO dice la fase ni el avance --se fueron a
 * `ReviewProgress`, debajo del menú-- así que exigir el guion no protegía de
 * nada: sólo escondía «hay una revisión activa» mientras el guion viajaba.
 *
 * Es una condición que sobrevivió a su motivo. Se borra con él.
 */
export default function ReviewMask({ activo, onSaveAndExit }: ReviewMaskProps) {
  /* Sin sesión en curso no hay máscara: ni barra, ni borde, ni un contenedor
     vacío. Lo que no está no puede quedar suelto. */
  if (!activo || !activo.session || activo.session.status !== 'in_progress') {
    return null;
  }

  return (
    <>
      {/*
        EL BORDE. Es un elemento propio y no un `border` en el `<body>`: un borde
        en el body empuja el contenido y recalcula el layout de las cuatro
        pantallas. Fijo, sin eventos de puntero, encima de todo.
      */}
      <div className="rv-edge" aria-hidden="true" />

      <div className="rv-bar" role="status" aria-live="polite">
        {/*
          ════════════════════════════════════════════════════════════
          LO MÍNIMO: QUE HAY UNA REVISIÓN Y DE QUIÉN — etapa RV2, punto 4
          ════════════════════════════════════════════════════════════

          Acá estaban la fase, el módulo, el porcentaje y las tres fases con su
          conteo. Seis datos en una línea de 42px, y el avance se perdía entre el
          texto: probado por Isabella.

          Se fueron a `ReviewProgress`, debajo del menú, donde hay espacio y no
          compiten con nada. Lo que queda acá es lo que tiene que estar en las
          cuatro pantallas del portal: que la sesión está abierta, sobre quién, y
          cómo salir.

          ⚠ Y NADA SOBRE LA CARGA DEL MÓDULO. El módulo ya dice `Loading...` por
          su cuenta; un segundo aviso acá sería una segunda fuente para el mismo
          hecho. Ver la nota de `ReviewMaskHost`.
        */}
        <div className="rv-bar__main">
          <span className="rv-bar__tag">Review mode</span>
          <span className="rv-bar__who">{activo.loName}</span>
        </div>

        {/*
          `Save and exit` deja la sesión EN CURSO, no la cierra: el punto 4 del
          brief. Lo que hace es soltar la máscara y volver a la lista; lo hecho
          ya está guardado paso por paso, así que no hay nada que confirmar.
        */}
        <Link className="rv-bar__exit" href={REVIEW_PATH} onClick={onSaveAndExit}>
          Save and exit
        </Link>
      </div>
    </>
  );
}
