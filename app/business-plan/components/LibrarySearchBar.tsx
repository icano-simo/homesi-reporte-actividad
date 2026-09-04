'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { searchLibrary, type SearchHit, type SearchInput } from '@/lib/business-plan/librarySearch';

/**
 * ============================================================================
 * BÚSQUEDA GLOBAL DE LA BIBLIOTECA — etapa BP41
 * ============================================================================
 *
 * ARCHIVO NUEVO. Va en `components/` y no dentro de una pantalla porque las dos
 * —biblioteca de nodos y funnels— llevan la misma barra. Dos copias del mismo
 * cuadro de resultados terminan divergiendo en el detalle que importa: la
 * etiqueta que dice por qué algo matcheó.
 *
 * El filtro en sí vive en `lib/business-plan/librarySearch.ts`, que es puro y se
 * prueba sin navegador. Acá sólo está la caja y cómo se dibuja un resultado.
 */

/** Un resultado se dibuja igual en las dos pantallas: qué es, dónde vive, por qué salió. */
function HitRow({ hit }: { hit: SearchHit }) {
  return (
    <Link className="bp-hit" href={hit.href}>
      {/*
        LA ETIQUETA DICE EL MOTIVO — `Node · matched in description`.
        Sin el motivo, un resultado cuyo nombre no contiene lo buscado obliga a
        preguntarse por qué salió, y esa pregunta hace desconfiar de la lista
        entera. El caso real: `AI WhatsApp` no tiene la palabra en ningún step,
        la tiene en su descripción.
      */}
      <span className={'bp-hit__kind bp-hit__kind--' + hit.kind.toLowerCase()}>
        {hit.kind}
        {hit.matchedIn === 'description' && <span className="bp-hit__why"> · matched in description</span>}
      </span>
      <span className="bp-hit__title">{hit.title}</span>
      {hit.where && <span className="bp-hit__where">{hit.where}</span>}
    </Link>
  );
}

export default function LibrarySearchBar({
  data,
  placeholder = 'Search funnels, nodes, steps and owners…',
}: {
  data: SearchInput;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchLibrary(q, data), [q, data]);
  const escribiendo = q.trim().length >= 2;

  /*
   * Se muestran los primeros 40. Buscar `a` ya devuelve `[]` por el mínimo de
   * dos caracteres, pero `co` matchea decenas y una lista de 90 filas deja de
   * ser un resultado y pasa a ser otra pantalla que hay que recorrer.
   */
  const TOPE = 40;
  const mostrados = hits.slice(0, TOPE);

  return (
    <div className="bp-searchbar">
      <input
        type="search"
        className="field bp-search bp-searchbar__input"
        value={q}
        placeholder={placeholder}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search the library"
      />
      {escribiendo && (
        <div className="bp-searchbar__panel" role="region" aria-label="Search results">
          {hits.length === 0 ? (
            /* Se nombra lo buscado: "nothing matched" sin el término deja la duda
               de si la búsqueda corrió. */
            <p className="bp-muted-line">Nothing matched &ldquo;{q.trim()}&rdquo;.</p>
          ) : (
            <>
              <div className="bp-searchbar__count">
                {hits.length} result{hits.length === 1 ? '' : 's'}
                {hits.length > TOPE && <> · showing the first {TOPE}</>}
              </div>
              {mostrados.map((h) => (
                <HitRow key={h.kind + h.href + h.title + h.where} hit={h} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
