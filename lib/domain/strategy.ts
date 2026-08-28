/**
 * ============================================================================
 * LAS CINCO ESTRATEGIAS COMERCIALES — etapa V3 (Commercial Activity)
 * ============================================================================
 *
 * Este módulo NO clasifica nada: sólo nombra los valores que ya vienen
 * resueltos en `activity_report.loan_records_v2.strategy`, calculados aguas
 * arriba en BigQuery. Acá no hay reglas de negocio, hay un vocabulario.
 *
 * ---------------------------------------------------------------------------
 * ⚠ NO CONFUNDIR CON lib/pipeline/strategy.ts
 * ---------------------------------------------------------------------------
 * Forecast tiene su propio módulo de estrategia (etapa F6) que SÍ clasifica,
 * en TypeScript, a partir de los crudos de Salesforce. Son dos cosas distintas
 * y no deben cruzarse:
 *
 *   * Acá el dato llega YA clasificado desde BigQuery; allá se calcula.
 *   * Los literales NO son iguales: Forecast escribe `'Own production'` (con p
 *     minúscula) y esta tabla `'Own Production'` (con P mayúscula). Importar el
 *     tipo del otro módulo compilaría y fallaría en silencio al comparar.
 *
 * Si algún día se unifican, que sea a propósito y con los dos valores mirados
 * de frente, no por reusar un import que parecía el mismo.
 *
 * ---------------------------------------------------------------------------
 * EL ORDEN ES LA PRECEDENCIA, NO EL ALFABETO
 * ---------------------------------------------------------------------------
 * Un préstamo puede cumplir varias condiciones a la vez; gana la primera de
 * esta lista. Un caso con dueño Business Developer pero `Strategy__c = 'NPPM'`
 * es NPPM, no B2B -- medido: 85 de los 92 NPPM tienen dueño BD, y con la regla
 * vieja del archivo los 85 se contaban como B2B.
 *
 * Mostrar el selector en este orden hace que la jerarquía se lea sola, sin
 * tener que explicarla en ningún lado.
 */
export const STRATEGY_ORDER = ['Affinity', 'NPPM', 'Recruitment', 'B2B', 'Own Production'] as const;

export type Strategy = (typeof STRATEGY_ORDER)[number];

/** `'all'` = sin filtrar, el valor por defecto del selector. */
export type StrategyFilter = 'all' | Strategy;

/**
 * ¿Este préstamo entra en el filtro elegido?
 *
 * Comparación exacta contra el valor guardado, sin normalizar: si BigQuery
 * empieza a mandar una variante ('own production', 'B2B ') el préstamo deja de
 * aparecer bajo su estrategia y eso se ve, en vez de quedar escondido detrás de
 * un `toLowerCase()` que lo hace parecer correcto. Mismo criterio que se dejó
 * anotado en F6.
 *
 * Los registros SIN estrategia (`''`) sólo aparecen con el filtro en 'all'.
 * Desde V4 no hay ninguna fuente que los produzca --se borró la carga manual de
 * archivo, que era la única-- pero la condición se mantiene: el campo es
 * `string` y una fila con la columna en NULL entraría igual.
 */
export function matchesStrategy(recordStrategy: string, filter: StrategyFilter): boolean {
  return filter === 'all' || recordStrategy === filter;
}

/** Etiqueta del filtro para títulos, rótulos y nombres de hoja del Excel. */
export function strategyLabel(filter: StrategyFilter): string {
  return filter === 'all' ? 'All strategies' : filter;
}
