import type { YearMonth } from '@/lib/parsing/types';
import type { Branch } from '@/config/roster';

/**
 * Préstamo ya interpretado según las reglas de negocio de esta etapa: branch
 * clasificado, loan officer/BD normalizados, B2B Loans como boolean y el
 * closing resuelto según el canal.
 *
 * No introduce ningún concepto de "Estados Finales" del proyecto de
 * Pipeline/Forecast (fuera de alcance aquí): el closing de este módulo es
 * simple, solo tiene fecha o no la tiene.
 */
export interface LoanRecord {
  /** Resultado de classifyBranch, NO el trueOrgId crudo. */
  branch: Branch;
  /** Normalizado: toUpperCase(), o '(blank)' si está vacío. */
  loanOfficer: string;
  /** Normalizado: valor tal cual si no está vacío, o '(blank)'. */
  bd: string;
  /** true si b2bLoans === 'B2B', false en cualquier otro caso. */
  isB2B: boolean;
  /**
   * Valor crudo de RawLoanRow.loanInfoChannel (columna 'loan_info_channel'),
   * SIN normalizar ni mapear -- el mismo string que ya usa classifyLoan()
   * para decidir closingMonth (funding vs completion). Se expone tal cual
   * para poder auditar que un filtro nuevo coincida con esa lógica existente.
   */
  loanInfoChannel: 'Banked - Retail' | 'Brokered' | string;
  fileCreationMonth: YearMonth | null;
  creditReportMonth: YearMonth | null;
  appDateMonth: YearMonth | null;
  /**
   * Mes de Closed. `null` si el loan no llegó a su milestone de cierre según
   * el canal (Funding para Banked-Retail, Completion para Brokered) -- esa
   * condición sigue siendo la que decide SI cuenta como Closed. Cuando sí
   * llegó, el MES es Disbursement Date si el archivo la trae para esa fila,
   * o Funding/Completion como respaldo si no (ver classifyLoan).
   */
  closingMonth: YearMonth | null;
  totalLoanAmount: number;
  /** Columna 'loan_number', valor crudo sin transformar -- id único de préstamo. */
  loanNumber: string;
  /** Columna 'Loan Program' (optional), valor crudo sin transformar. '' si el archivo no la trae. */
  loanProgram: string;
  /** Columna 'Loan Folder Name' (optional), valor crudo sin transformar. '' si el archivo no la trae. */
  loanFolderName: string;
  /**
   * Columna 'Affinity' (optional), valor crudo sin transformar. '' si el
   * archivo no la trae. Ver auditoría de consistencia contra
   * True OrgID==='AFFINITY' (classifyBranch) -- el criterio para el flag
   * `affinity` del modal todavía no está decidido, este campo solo expone
   * el dato crudo.
   */
  affinity: string;
  /**
   * ⚠ ¿Este cierre suma en un TOTAL DE DIVISIÓN? — etapa V2.
   *
   * `closingMonth` dice si el préstamo cerró y en qué mes. Este flag dice algo
   * distinto: si ese cierre le suma a la división o sólo a quien lo originó.
   *
   * Los HELOC de segundo gravamen cierran de verdad --el loan officer y su
   * sucursal los ganan-- pero la división no gana nada con ellos, así que
   * ningún total de división los cuenta. En `loan_records_v2` eso viene
   * resuelto desde BigQuery: `counts_for_division` es exactamente
   * `is_closed AND NOT is_second_lien_heloc` (verificado sobre las 4.794 filas:
   * 468 cerrados, 463 que suman, y los 5 de diferencia son todos HELOC de
   * segundo gravamen).
   *
   * Nunca es `true` con `closingMonth === null`: lo que no cerró no suma en
   * ningún lado. La relación es de subconjunto, no de exclusión.
   *
   * Quién lo usa está en un solo lugar: `countsIn()` en
   * lib/aggregation/metricMaps.ts.
   */
  countsForDivision: boolean;
  /**
   * Estrategia comercial, YA resuelta en BigQuery — etapa V3.
   *
   * Uno de los cinco valores de `STRATEGY_ORDER` (lib/domain/strategy.ts), con
   * la precedencia ya aplicada: Affinity > NPPM > Recruitment > B2B > Own
   * Production. La app no la calcula ni la corrige.
   *
   * `''` cuando el dato no viene: hoy, sólo la carga manual de archivo, que no
   * trae la columna. Esos registros sólo aparecen con el filtro en "All".
   */
  strategy: string;
  /** Dueño de la oportunidad en Salesforce. `''` si el préstamo no tiene. Poblado en 3.226 de 4.794. */
  opportunityOwner: string;
  /**
   * ⚠ El NPPM contratado. HOY LLEGA SIEMPRE VACÍO.
   *
   * Medido sobre las 4.794 filas de `loan_records_v2`: `nppm_realtor` es NULL
   * en TODAS, incluidos los 92 préstamos con `strategy = 'NPPM'`. Se lee igual
   * --está pedido y el día que el sync la llene ya está enchufada-- pero
   * ninguna pantalla le dedica una columna, porque hoy sería una columna vacía.
   *
   * Lo que sí tiene datos es otra cosa: `realtor_es_nppm` y `nppm_recruited_by`
   * (273 filas cada una). Si lo que se quería mostrar era eso, es un campo
   * distinto y hay que pedirlo aparte.
   */
  nppmRealtor: string;
  /** Quién refirió el caso. `''` si no aplica. Poblado en 903 de 4.794, sobre todo en B2B (645). */
  referredByRealtor: string;
  /**
   * El Business Developer que trajo al NPPM — etapa V3b.
   *
   * Es lo que se quería ver cuando se pidió `nppm_realtor`: ese campo nombra al
   * NPPM que refiere a un amigo y está vacío en Salesforce (`NPPM_Realtor__c`
   * no lo llena nadie), así que llega NULL en las 4.794 filas. Éste sí tiene
   * datos: 273 en total, 76 de los 92 préstamos con `strategy = 'NPPM'`.
   *
   * ⚠ Dentro de NPPM se solapa fuerte con `opportunityOwner`: de esos 92, en 68
   * los dos campos dicen lo mismo, en 16 éste viene vacío, y sólo en 8 aporta un
   * nombre distinto. Esos 8 son justamente el caso que vale la pena mirar --un
   * BD reclutó al NPPM pero la oportunidad la tiene otro-- y son la razón de que
   * la columna exista, no un argumento para tratarla como redundante.
   */
  nppmRecruitedBy: string;
}
