/*
 * ============================================================================
 * QUÉ REVISIÓN SE ESTÁ RECORRIENDO — una elección, no una deducción (RV25)
 * ============================================================================
 *
 * ⚠ REEMPLAZA A `maskExit.ts`, QUE GUARDABA LO CONTRARIO.
 *
 * Aquel guardaba de cuáles se había SALIDO --`rv-exited:<key>`, una clave por
 * sesión-- y el proveedor deducía la que se recorre con
 *
 *     mias.find((r) => r.session?.status === 'in_progress' && !salio(...))
 *
 * o sea LA PRIMERA que quedara. Con una sola revisión abierta eso coincide con
 * la respuesta correcta; con varias, no.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ DEJÓ DE ALCANZAR, Y NO ES UN CASO HIPOTÉTICO
 * ---------------------------------------------------------------------------
 * Fernando Orduz tiene TRES revisiones en curso hoy --Luis Silva, Jose Arango y
 * Lucio Romero-- así que cuál se recorría dependía del orden de la lista y de
 * qué había en `localStorage`.
 *
 * Antes de RV24 eso decidía qué barra se dibuja. Con la sesión de práctica
 * decide algo más caro: **si una escritura es real o de práctica**. Alguien
 * podía creer que practicaba y estar escribiendo en el registro real de otra
 * persona -- exactamente lo que esa etapa vino a evitar.
 *
 * ---------------------------------------------------------------------------
 * ⚠ UNA SOLA LLAVE, Y SIN RESPALDO
 * ---------------------------------------------------------------------------
 * `rv-walking` guarda LA sesión que se recorre, o nada. No convive con
 * `rv-exited`: dos llaves contestando la misma pregunta --cuál se recorre--
 * divergen con el primer edit, y este repo tiene nueve casos escritos de eso.
 * «Salir de la máscara» pasó a ser borrar la clave, que es la misma operación
 * dicha de una sola forma.
 *
 * Y si la clave no está, NO se cae a «la primera en curso». Sin clave no se
 * recorre nada, y de ahí sale la propiedad que hace segura la ausencia:
 *
 *   > La misma clave decide la máscara y el destino de la escritura. Sin clave
 *   > no hay máscara, así que nadie puede estar viendo la barra de una práctica
 *   > y escribir en el registro real.
 *
 * Un respaldo de «tomá la primera» rompería justo eso: es el defecto que esto
 * viene a arreglar, no una red de seguridad.
 *
 * ---------------------------------------------------------------------------
 * DÓNDE SE ELIGE
 * ---------------------------------------------------------------------------
 * En `/review/[assignmentKey]`, al resolver o crear la sesión. Es el único
 * escritor de esta clave, y ya era un acto deliberado: `Start coaching` y
 * `Resume coaching` son links a esa ruta.
 *
 * ---------------------------------------------------------------------------
 * ⚠ Y LAS SESIONES QUE YA ESTABAN ABIERTAS AL DESPLEGAR
 * ---------------------------------------------------------------------------
 * No tienen clave, así que su máscara arranca apagada hasta que su dueño
 * apriete `Resume coaching` una vez. Se eligió eso sobre adoptar «la única en
 * curso»: esa regla sólo aplicaría una vez, y su caso útil --una sola abierta--
 * es justo el que nunca tuvo el problema. A quien más lo necesita (tres
 * abiertas) no le ahorra nada.
 *
 * `useSyncExternalStore` y no estado de React, por lo mismo que antes: la
 * respuesta vive fuera de React --sobrevive a una recarga y cambia desde otra
 * pestaña-- y esa API tiene snapshot de servidor propio, así que no hay
 * discrepancia de hidratación ni `setState` en un efecto.
 */

import { useSyncExternalStore } from 'react';

const CLAVE = 'rv-walking';

/** Quiénes escuchan. Un `Set` para que desuscribirse sea O(1). */
const oyentes = new Set<() => void>();

/*
 * ⚠ EL SNAPSHOT ES UNA CADENA Y ESTABLE ENTRE LECTURAS. `useSyncExternalStore`
 * compara con `Object.is`: devolver un valor nuevo cada vez haría que React se
 * considere siempre desactualizado y renderice sin fin. Se memoriza.
 */
let cache = '';
let cacheValida = false;

function leerCrudo(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(CLAVE) ?? '';
  } catch {
    /*
     * Sin almacenamiento --modo privado, permisos-- se lee como «no se recorre
     * nada». Es el lado seguro: la máscara no aparece, y sin máscara no hay
     * escritura de práctica posible. Antes el lado seguro era el contrario
     * porque la pregunta era la contraria.
     */
    return '';
  }
}

function getSnapshot(): string {
  if (!cacheValida) {
    cache = leerCrudo();
    cacheValida = true;
  }
  return cache;
}

/** En el servidor no se recorre nada: el HTML inicial no promete una máscara. */
function getServerSnapshot(): string {
  return '';
}

function subscribe(cb: () => void): () => void {
  oyentes.add(cb);
  /* `storage` avisa de los cambios de OTRAS pestañas: elegir en una y que la
     otra suelte la máscara. */
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CLAVE) avisar();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    oyentes.delete(cb);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

function avisar(): void {
  cacheValida = false;
  for (const cb of oyentes) cb();
}

/**
 * La sesión que se está recorriendo, o `null`.
 *
 * ⚠ `null` significa «no se eligió ninguna», y no «todavía no sé»: esta lectura
 * es síncrona y local. La incertidumbre de «no llegaron mis revisiones» vive
 * arriba, en el proveedor, que es quien sabe si la lista llegó.
 */
export function useRecorriendo(): number | null {
  const crudo = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (crudo === '') return null;
  const n = Number(crudo);
  /* Una clave ilegible se trata como ausente, no como cero: `session_key` 0 no
     existe, y un `NaN` que viaje como número contaminaría la comparación. */
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Elige la sesión que se recorre. ÚNICO escritor de la clave.
 *
 * Se llama desde `/review/[assignmentKey]` al resolver o crear la sesión, que
 * es el acto deliberado: nadie llega ahí sin haber apretado `Start coaching` o
 * `Resume coaching`.
 */
export function empezarARecorrer(sessionKey: number): void {
  try {
    window.localStorage.setItem(CLAVE, String(sessionKey));
  } catch {
    /* Sin almacenamiento la elección no persiste y la máscara no aparece. Se
       nota enseguida, y es preferible a escribir en el registro equivocado. */
  }
  avisar();
}

/**
 * Deja de recorrer. NO cierra la sesión: la revisión sigue abierta y se retoma
 * desde `/review` con `Resume coaching`.
 */
export function dejarDeRecorrer(): void {
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    /* idem */
  }
  avisar();
}
