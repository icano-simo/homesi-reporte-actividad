/**
 * Redacción ÚNICA de la nota agregada de Unknown -- usada por
 * `OnTimeDelayedTable.tsx` (nota al pie de la tabla) Y por los KPI cards
 * de la sección On Time/Delayed (Etapa ACTIVITY-KPI-1) -- mismo texto en
 * los 2 lugares a propósito ("no lo dupliques con redacción distinta",
 * pedido explícito): una sola función, no 2 copias de la misma frase que
 * puedan divergir con el tiempo.
 */
export function unknownExcludedNote(count: number): string {
  return count === 1
    ? '1 loan excluded from On Time/Delayed — no original closing estimate on file.'
    : `${count} loans excluded from On Time/Delayed — no original closing estimate on file.`;
}
