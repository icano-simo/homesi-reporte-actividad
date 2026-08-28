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
   * Canal, SIN normalizar ni mapear. Hoy viene de
   * `loan_records_v2.loan_channel`: 'Banked - Retail', 'Brokered', o '' en las
   * pocas filas sin clasificar, que son su propia categoría y no se reasignan.
   */
  loanInfoChannel: 'Banked - Retail' | 'Brokered' | string;
  fileCreationMonth: YearMonth | null;
  creditReportMonth: YearMonth | null;
  appDateMonth: YearMonth | null;
  /**
   * Mes de Closed, o `null` si el préstamo no cerró.
   *
   * Ya resuelto en BigQuery (`loan_records_v2.closing_month`), con la misma
   * regla de negocio que antes calculaba la app: el milestone del canal decide
   * SI cuenta como Closed --Funding para Banked-Retail, Completion para
   * Brokered-- y Disbursement Date manda sobre ese milestone para decidir el
   * MES cuando está presente. La app ya no la calcula ni la corrige.
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
   * El NPPM que está detrás del préstamo — etapa V3c.
   *
   * ⚠ Hasta el 2026-08-27 este campo llegaba NULL en todas las filas y esta
   * misma documentación decía que estaba vacío en Salesforce. No lo estaba: la
   * consulta de origen apuntaba a `Contact` y el campo referencia un objeto
   * propio (`salesforce.NPPM__c`), así que no resolvía nada. Corregido en
   * BigQuery y sincronizado el 2026-08-28.
   *
   * Medido tras el arreglo: 88 de los 92 préstamos con `strategy = 'NPPM'`
   * traen nombre, con 9 realtors distintos (Laura Delgado 42, FRED A GOMEZ 26).
   * Fuera de NPPM no aparece en ninguna fila.
   *
   * Se solapa con `referredByRealtor` --coinciden en 73 de los 92-- pero
   * difieren en 15, así que no es un duplicado. Y cada realtor mapea a UN solo
   * `nppmRecruitedBy` en los datos de hoy.
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
  /**
   * Etapa: "Stage SF" en el drill-down de App Date.
   *
   * `sf_stage` de Salesforce: el embudo de VENTA/CRM de la oportunidad
   * (Needs Analysis, Proposal, Qualification, Negotiation, Closed Won, Closed
   * Lost), NO el milestone de procesamiento del préstamo (Processing,
   * Underwriting, etc. -- eso vive únicamente en `pipeline_forecast`, fuera de
   * alcance acá). '' cuando el préstamo no tiene Salesforce asociado
   * (`has_salesforce = false`) -- 1.555 de 4.800 filas hoy.
   */
  sfStage: string;
}
