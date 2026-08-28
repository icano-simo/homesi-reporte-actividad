/** Mes en formato 'YYYY-MM'. Documenta la intención de los campos de mes. */
export type YearMonth = string;

/*
 * ⚠ Etapa V4: acá vivía `RawLoanRow`, la fila cruda del Excel de actividad.
 *
 * Se fue con el camino que la producía y la consumía: `workbookReader` la
 * armaba, `classifyLoan` la convertía en `LoanRecord`, `isHelocLien2` la
 * filtraba y `saveUpload` la persistía. Los cuatro se borraron en esta etapa,
 * así que el tipo no tenía un solo uso.
 *
 * Este archivo se queda por `YearMonth`, que lo importan ~25 módulos. Que un
 * alias de string tan general viva en `lib/parsing/` es una herencia de cuando
 * este era el único parser de la app; moverlo sería un rename de 25 archivos
 * sin ganancia funcional, y no se hizo acá a propósito.
 *
 * El único parser que queda es el de Forecast, `lib/pipeline/sources/
 * salesforce-file.ts`, que tiene sus propios tipos en `lib/pipeline/types.ts`
 * y nunca usó `RawLoanRow`.
 */
