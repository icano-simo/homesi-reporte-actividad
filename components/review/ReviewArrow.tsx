'use client';

import { useEffect, useState } from 'react';
import type { StepArrow } from '@/lib/review/gates';

/**
 * ============================================================================
 * LA FLECHA QUE DICE DÓNDE MIRAR — etapa RV14
 * ============================================================================
 *
 * Isabella pidió que cada paso señale el lugar exacto que hay que revisar, con
 * un texto corto de qué hacer ahí. El resaltado de la sección ya existe --y
 * desde RV13 está difuminado-- pero señala una CAJA: la flecha señala un
 * número dentro de esa caja.
 *
 * ⚠ VA CON EL PASO Y NO SE QUEDA. No hay estado propio de «flecha vista»: la
 * dibuja el anfitrión mientras ese paso sea el actual, y al pasar al siguiente
 * el componente se desmonta. No es un adorno permanente de la revisión.
 *
 * ⚠ Y SI EL ANCLA NO ESTÁ, NO DIBUJA NADA. Que la flecha no aparezca en la
 * pantalla equivocada es correcto -- el paso 1.2 apunta a un número del perfil
 * y en Outlook ese número no existe. Lo que NO puede pasar es que se dibuje
 * flotando en una esquina apuntando a nada.
 *
 * ⚠ SE MIDE EN CADA SCROLL Y EN CADA RESIZE, y por eso la posición es `fixed`
 * sobre coordenadas de viewport: el ancla es un elemento de la app --una celda,
 * una píldora, una fila de tabla-- que se mueve con la página. Una flecha
 * calculada una vez al montar queda apuntando al vacío en cuanto alguien
 * scrollea, y eso se ve peor que no tenerla.
 */
export default function ReviewArrow({
  flecha,
  hayOtra,
  onOk,
}: {
  flecha: StepArrow;
  /** Si hay una flecha después de ésta, se ofrece el OK que mueve a la siguiente. */
  hayOtra: boolean;
  onOk: () => void;
}) {
  const [caja, setCaja] = useState<{ top: number; left: number; height: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    let el: Element | null = null;
    const medir = () => {
      if (!vivo) return;
      try {
        /*
         * ⚠ LA LISTA SE PRUEBA EN ORDEN, Y NO SE LE PASA A `querySelector`
         * ENTERA. Con una coma, `querySelector` devuelve el primero en ORDEN
         * DEL DOCUMENTO, no en orden de la lista -- y acá el orden de la lista
         * es la preferencia.
         *
         * Lo necesita la segunda flecha del 2.1: apunta a la fila de la
         * persona, pero esa fila vive en un grupo que arranca COLAPSADO y no
         * existe en el DOM hasta que alguien lo despliega. El respaldo es la
         * cabecera del grupo, que sí está siempre -- y como está antes en el
         * documento, una lista con coma habría elegido siempre el respaldo,
         * incluso con la fila a la vista.
         *
         * Mismo criterio que los dos selectores de `stepTarget`, con la
         * diferencia de que allá cualquiera sirve y acá hay preferencia.
         */
        el = null;
        for (const sel of flecha.target.split(',').map((s) => s.trim()).filter(Boolean)) {
          el = document.querySelector(sel);
          if (el !== null) break;
        }
      } catch {
        /* Un selector inválido no rompe la máscara: es texto que alguien
           escribió en `gate_config`. Se avisa una vez y no se dibuja. */
        console.warn('[review] gate_config.arrows: selector inválido: ' + flecha.target);
        setCaja(null);
        return;
      }
      if (el === null) {
        setCaja(null);
        return;
      }
      const r = el.getBoundingClientRect();
      /* Un ancla de alto cero --o fuera de pantalla por completo-- no se
         señala: apuntaría a una raya. */
      if (r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) {
        setCaja(null);
        return;
      }
      setCaja({ top: r.top + r.height / 2, left: r.left, height: r.height });
    };
    medir();
    /* `capture` para agarrar el scroll de cualquier contenedor interno, no sólo
       el de la ventana: la fila del Loan Officer vive en una tabla que scrollea
       sola. */
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    /* Y un tick lento, porque el ancla puede aparecer DESPUÉS: las tablas de
       Outlook y el perfil se dibujan cuando llegan sus datos. */
    const timer = setInterval(medir, 1000);
    return () => {
      vivo = false;
      window.removeEventListener('scroll', medir, true);
      window.removeEventListener('resize', medir);
      clearInterval(timer);
    };
  }, [flecha.target]);

  if (caja === null) return null;

  /*
   * A la IZQUIERDA del ancla si hay lugar, y si no arriba. El brief pide la
   * izquierda para el 2.1 --«en el espacio vacío»-- y ese es el caso general:
   * los números que hay que mirar están a la derecha de su rótulo.
   */
  const aLaIzquierda = caja.left > 260;

  return (
    <div
      className={'rv-arrow' + (aLaIzquierda ? '' : ' rv-arrow--arriba')}
      style={
        aLaIzquierda
          ? { top: caja.top, left: caja.left - 12 }
          : { top: Math.max(8, caja.top - caja.height / 2 - 46), left: Math.max(8, caja.left) }
      }
      data-rv-arrow=""
      role="note"
    >
      <span className="rv-arrow__txt">{flecha.text}</span>
      {hayOtra && (
        <button type="button" className="rv-arrow__ok" onClick={onOk}>
          OK
        </button>
      )}
      {/*
        La punta, dibujada con un borde: un carácter --«→»-- cambia de forma con
        la tipografía y no se puede alinear al medio del ancla. Y no es un
        emoji, que el brief prohíbe.
      */}
      <i className="rv-arrow__punta" aria-hidden="true" />
    </div>
  );
}
