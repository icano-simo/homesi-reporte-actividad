'use client';

/**
 * ============================================================================
 * «HAY UNA SESIÓN ABIERTA» Y «LA ESTOY RECORRIENDO» SON DOS COSAS
 * ============================================================================
 *
 * Etapa RV5 — ARCHIVO NUEVO.
 *
 * `Save and exit` no salía: la máscara se quedaba puesta, con el panel del paso
 * donde iba. La causa es que el proveedor tenía UN concepto donde hacen falta
 * dos — «existe una sesión `in_progress`» y «la estoy recorriendo ahora». El
 * botón llamaba a `recargar()`, la sesión seguía abierta, y la barra se volvía a
 * dibujar con el mismo dato de siempre.
 *
 * ---------------------------------------------------------------------------
 * ⚠ POR QUÉ NO ES ESTADO DE REACT
 * ---------------------------------------------------------------------------
 * Porque tiene que sobrevivir a una RECARGA COMPLETA. Un `useState` en el
 * proveedor se pierde con F5 y la sesión sigue `in_progress` en la base, así que
 * la máscara volvería sola — que es exactamente lo que el brief anticipa: «si
 * no, al recargar la página la máscara va a volver sola».
 *
 * ---------------------------------------------------------------------------
 * ⚠ Y POR QUÉ NO ES UNA COLUMNA DE LA BASE
 * ---------------------------------------------------------------------------
 * Porque no es un hecho de la revisión: es un hecho de ESTE navegador. La sesión
 * --el trabajo, quién revisa a quién y dónde va-- vive en la base y se comparte.
 * «La estoy recorriendo en esta ventana» no se comparte: si Isabella sale en su
 * portátil, eso no dice nada de la pantalla de Fernando.
 *
 * Una columna además obligaría a un `update` por cada entrada y salida, y a
 * decidir qué pasa cuando dos ventanas discrepan. `localStorage` no tiene esa
 * pregunta.
 *
 * ---------------------------------------------------------------------------
 * ⚠ SE GUARDA LA SALIDA, NO LA ENTRADA
 * ---------------------------------------------------------------------------
 * La clave existe cuando alguien SALIÓ de esa sesión. La ausencia significa
 * «recorriéndola», que es el lado seguro de fallar: si el almacenamiento se
 * pierde --modo privado, otra máquina, datos borrados-- se ve la máscara de una
 * sesión que de verdad está abierta, en vez de perder la guía en medio de una
 * conversación con el Loan Officer.
 *
 * Guardar la entrada tendría el defecto opuesto: una sesión creada por SQL, o
 * una anterior a esta etapa, no tendría marca y quedaría sin máscara para
 * siempre sin que nada lo explique.
 *
 * ---------------------------------------------------------------------------
 * ⚠ `useSyncExternalStore` Y NO UN EFECTO
 * ---------------------------------------------------------------------------
 * `localStorage` no existe en el servidor, y este proveedor se renderiza ahí
 * para el HTML inicial. Leerlo en el estado inicial tira; leerlo en un efecto
 * dispara `react-hooks/set-state-in-effect` y además muestra la máscara un
 * instante antes de esconderla.
 *
 * `useSyncExternalStore` es la API que existe para esto: tiene un snapshot de
 * servidor propio, así que no hay discrepancia de hidratación ni `setState` en
 * un efecto.
 */

import { useSyncExternalStore } from 'react';

const PREFIJO = 'rv-exited:';

/** Quiénes escuchan. Un `Set` para que desuscribirse sea O(1). */
const oyentes = new Set<() => void>();

/*
 * ⚠ EL SNAPSHOT ES UNA CADENA, y tiene que ser ESTABLE entre lecturas.
 *
 * `useSyncExternalStore` compara el snapshot con `Object.is`, así que devolver
 * un `Set` nuevo en cada llamada haría que React se considere siempre
 * desactualizado y vuelva a renderizar sin fin. Se devuelve el texto y se
 * memoriza mientras no cambie.
 */
let cache = '';
let cacheValida = false;

function leerCrudo(): string {
  if (typeof window === 'undefined') return '';
  try {
    const claves: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k !== null && k.startsWith(PREFIJO)) claves.push(k.slice(PREFIJO.length));
    }
    return claves.sort().join(',');
  } catch {
    /* Sin almacenamiento --modo privado, permisos-- se lee como «no salí de
       ninguna», que es el lado seguro. */
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

/** En el servidor no hay salidas: el HTML inicial no promete una máscara. */
function getServerSnapshot(): string {
  return '';
}

function subscribe(cb: () => void): () => void {
  oyentes.add(cb);
  /*
   * `storage` avisa de los cambios de OTRAS pestañas, que es justo lo que hace
   * falta: salir en una y ver la otra soltar la máscara.
   */
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIJO)) avisar();
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

/** Marca que se salió de la máscara de esta sesión. No cierra la sesión. */
export function salirDeLaMascara(sessionKey: number): void {
  try {
    window.localStorage.setItem(PREFIJO + sessionKey, '1');
  } catch {
    /* Ver la nota de `leerCrudo`. Sin almacenamiento la salida no persiste, y
       eso se nota: la máscara vuelve al recargar. Es preferible a fallar. */
  }
  avisar();
}

/** Vuelve a entrar: se llama al retomar la revisión desde `/review`. */
export function volverALaMascara(sessionKey: number): void {
  try {
    window.localStorage.removeItem(PREFIJO + sessionKey);
  } catch {
    /* idem */
  }
  avisar();
}

/**
 * `true` si se salió de la máscara de esa sesión.
 *
 * Es un hook porque el proveedor tiene que volver a renderizar cuando cambia --
 * incluso desde otra pestaña.
 */
export function useSalidas(): (sessionKey: number) => boolean {
  const texto = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const salidas = texto === '' ? [] : texto.split(',');
  return (sessionKey: number) => salidas.includes(String(sessionKey));
}
