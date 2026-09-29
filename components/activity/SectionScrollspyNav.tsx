'use client';

import { useEffect, useState } from 'react';

export interface ScrollspySection {
  id: string;
  label: string;
}

export interface SectionScrollspyNavProps {
  sections: ScrollspySection[];
}

/**
 * ============================================================================
 * NAV DE SCROLLSPY ENTRE SECCIONES — Etapa ACTIVITY-COLLAPSE-1
 * ============================================================================
 *
 * Mismo mecanismo que `AnalyticsSectionNav` (app/pipeline/TabAnalytics.tsx,
 * Etapa SECTION-NAV-1): `IntersectionObserver` nativo, sin librería, banda
 * angosta cerca del borde superior del viewport para decidir qué sección
 * está "activa" mientras se hace scroll.
 *
 * NO se reusa ese componente tal cual -- no es exportado y está acoplado a
 * `ANALYTICS_SECTIONS` (una constante de módulo con 3 entradas fijas +
 * íconos propios de esa pestaña, no un prop). Este componente replica sólo
 * el PATRÓN: `sections` es un prop, así que sirve para cualquier lista de
 * anclas (acá, 2: Duration / On Time & Delayed) sin tocar TabAnalytics.tsx.
 *
 * Reusa las clases `.analytics-section-nav`/`.analytics-section-nav__item`
 * (forecast-visual.css) -- ya se cargan en esta ruta (`app/analytics/page.tsx`
 * importa esa hoja para TabAnalytics), así que la pieza nueva se ve
 * consistente con el resto de Analytics sin CSS propio. Sin íconos por
 * sección -- la clase no los exige (sólo reserva espacio si hay un `<svg>`
 * hijo), y las 2 anclas de este caso no tienen un ícono obvio que las
 * distinga como sí lo tenían las 3 de TabAnalytics.
 *
 * Etapa ACTIVITY-KPI-2 -- sticky propio, INLINE (no en `.analytics-section-nav`
 * de forecast-visual.css): esa clase la comparte `AnalyticsSectionNav`
 * (TabAnalytics.tsx), que hoy es sticky por HEREDAR el `position: sticky`
 * de su `.control-bar` padre (`.analytics-tab .control-bar`, esa misma
 * hoja) -- si el sticky se agregara a la clase compartida, el nav de
 * TabAnalytics quedaría con 2 posicionamientos sticky anidados (el propio
 * + el heredado), sin necesidad y con riesgo de comportamiento raro. Acá
 * no hay ningún `.control-bar` ancestro que ya sea sticky, así que el
 * `<nav>` se fija a mano, sólo en este componente.
 *
 * Fondo blanco explícito -- sin él, el contenido de las 2 secciones se
 * vería A TRAVÉS de la barra al hacer scroll (transparente por defecto).
 *
 * ============================================================================
 * Etapa ACTIVITY-STICKY-GAP-1 -- BUG: hueco visible entre el header global
 * (`header.hub-header`, ya sticky de antes) y esta nav al hacer scroll.
 * ============================================================================
 *
 * CAUSA REAL, confirmada con `getBoundingClientRect()` de los 2 elementos
 * en el momento del bug (no sólo leyendo el CSS) -- exactamente el primer
 * candidato: **los 2 `top` se calculan por separado, y ninguno conoce la
 * altura REAL del otro**. Este `<nav>` usaba `top: var(--header-h)` (103px,
 * un token fijo). Medido con datos reales: `header.hub-header` mide
 * **102.604px**, no 103 -- un desajuste de 0.396px, presente en TODAS las
 * posiciones de scroll una vez que la nav queda "pegada" (verificado en un
 * barrido de 10 posiciones de scroll distintas, siempre el mismo número).
 * Los otros 2 candidatos SE DESCARTARON, medidos, no supuestos: `grep`
 * sobre TODO el árbol vivo buscando `scrollWidth > clientWidth` en
 * cualquier elemento con `overflow-x: auto/scroll` no encontró ninguno (ni
 * a este ancho de viewport ni en uno más angosto) -- no hay ningún
 * contenedor generando una scrollbar real acá. Tampoco es un problema de
 * `z-index`: los 2 elementos no se superponen, dejan un hueco geométrico
 * real, chico pero real.
 *
 * 0.4px suena insignificante, pero un hueco sub-píxel entre 2 fondos
 * blancos sólidos, a un factor de escala de pantalla que no sea 100%
 * (125%/150%, común en Windows), puede redondear a 1-2 píxeles de
 * dispositivo VISIBLES -- exactamente la "franja" reportada.
 *
 * FIX: en vez de ajustar el número mágico (103 -> 102.6, que se
 * desalinearía de nuevo el día que el header cambie de alto por cualquier
 * motivo -- una línea más en el email del usuario, un cambio de fuente),
 * esta nav MIDE el alto real del header en vivo (`ResizeObserver`, mismo
 * elemento que ya causaba el desajuste) y fija su propio `top` a ESE
 * número exacto -- los 2 quedan pegados sin hueco por construcción, para
 * cualquier alto que el header termine teniendo, ahora o en el futuro.
 * `var(--header-h)` queda sólo como fallback para el primer render (antes
 * de que el efecto mida), evitando un salto visual perceptible.
 */
const HEADER_SELECTOR = 'header.hub-header';

/**
 * MEDIDO en pantalla real (`getBoundingClientRect().height` del `<nav>` ya
 * sticky, con datos reales: 48.65px, redondeado hacia arriba a 49 -- de
 * más nunca tapa, de menos sí), no calculado -- mismo criterio que
 * `--header-h`/`--control-bar-h` en forecast-visual.css. Se exporta para
 * que `app/analytics/page.tsx` sume el mismo número al `scrollMarginTop`
 * de los 2 `<h3>` (si no, el click en esta nav deja el título tapado
 * DEBAJO de la barra, que también es sticky) -- una sola fuente para las 2
 * cosas que necesitan saber cuánto mide, en vez de repetir el número.
 */
export const NAV_HEIGHT_PX = 49;

export default function SectionScrollspyNav({ sections }: SectionScrollspyNavProps) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);

  /** Mide el header real, en vivo -- se re-mide solo si su alto cambia (ResizeObserver, no un valor leído una vez). */
  useEffect(() => {
    const header = document.querySelector(HEADER_SELECTOR);
    if (!header) return;
    const update = () => setHeaderHeight(header.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const elements = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    if (!elements.length) return;
    const topOffset = (headerHeight ?? 103) + NAV_HEIGHT_PX;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        });
      },
      { rootMargin: `-${topOffset}px 0px -70% 0px`, threshold: 0 }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.map((s) => s.id).join(','), headerHeight]);

  return (
    <nav
      className="analytics-section-nav"
      aria-label="Section navigation"
      style={{
        position: 'sticky',
        top: headerHeight !== null ? `${headerHeight}px` : 'var(--header-h)',
        zIndex: 5,
        background: '#fff',
        borderBottom: '1px solid var(--slate-200)',
        paddingBottom: '10px',
      }}
    >
      {sections.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={'analytics-section-nav__item' + (activeId === id ? ' analytics-section-nav__item--active' : '')}
          onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
