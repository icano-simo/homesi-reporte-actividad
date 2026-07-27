import type { ReportTree } from './types';
import type { YearMonth } from '@/lib/parsing/types';

/**
 * ReportTree de ejemplo (3 meses, 2 branches, 1-2 loan officers por métrica)
 * para verificar visualmente components/report contra el legacy. Escrito a
 * mano -- no generado por buildReportTree() -- para que esta etapa no
 * dependa de datos reales ni de las etapas de parsing/domain.
 */
export const EXAMPLE_MONTHS: YearMonth[] = ['2026-05', '2026-06', '2026-07'];

export const EXAMPLE_REPORT_TREE: ReportTree = {
  total: {
    maps: {
      fc: { '2026-05': 12, '2026-06': 15, '2026-07': 9 },
      cr: { '2026-05': 10, '2026-06': 11, '2026-07': 8 },
      ap: { '2026-05': 4, '2026-06': 6, '2026-07': 3 },
      cl: { '2026-05': 2, '2026-06': 3, '2026-07': 1 },
    },
  },
  branches: [
    {
      branch: '700',
      metricGroups: [
        {
          metric: 'fc',
          label: 'File Creations',
          total: { '2026-05': 7, '2026-06': 9, '2026-07': 5 },
          items: [
            { name: 'JANE DOE', map: { '2026-05': 5, '2026-06': 6, '2026-07': 3 }, total: 14 },
            { name: 'JOHN SMITH', map: { '2026-05': 2, '2026-06': 3, '2026-07': 2 }, total: 7 },
          ],
        },
        {
          metric: 'cr',
          label: 'Credit_Report',
          total: { '2026-05': 6, '2026-06': 7, '2026-07': 4 },
          items: [
            { name: 'JANE DOE', map: { '2026-05': 4, '2026-06': 5, '2026-07': 3 }, total: 12 },
            { name: 'JOHN SMITH', map: { '2026-05': 2, '2026-06': 2, '2026-07': 1 }, total: 5 },
          ],
        },
        {
          metric: 'ap',
          label: 'App date',
          total: { '2026-05': 3, '2026-06': 4, '2026-07': 2 },
          items: [
            { name: 'JANE DOE', map: { '2026-05': 2, '2026-06': 3, '2026-07': 1 }, total: 6 },
            { name: 'JOHN SMITH', map: { '2026-05': 1, '2026-06': 1, '2026-07': 1 }, total: 3 },
          ],
        },
        {
          metric: 'cl',
          label: 'Closed',
          total: { '2026-05': 1, '2026-06': 2, '2026-07': 1 },
          items: [
            { name: 'JANE DOE', map: { '2026-05': 1, '2026-06': 1, '2026-07': 1 }, total: 3 },
            { name: 'JOHN SMITH', map: { '2026-06': 1 }, total: 1 },
          ],
        },
      ],
    },
    {
      branch: '701',
      metricGroups: [
        {
          metric: 'fc',
          label: 'File Creations',
          total: { '2026-05': 5, '2026-06': 6, '2026-07': 4 },
          items: [{ name: '(blank)', map: { '2026-05': 5, '2026-06': 6, '2026-07': 4 }, total: 15 }],
        },
        {
          metric: 'cr',
          label: 'Credit_Report',
          total: { '2026-05': 4, '2026-06': 4, '2026-07': 4 },
          items: [{ name: '(blank)', map: { '2026-05': 4, '2026-06': 4, '2026-07': 4 }, total: 12 }],
        },
        {
          metric: 'ap',
          label: 'App date',
          total: { '2026-05': 1, '2026-06': 2, '2026-07': 1 },
          items: [{ name: '(blank)', map: { '2026-05': 1, '2026-06': 2, '2026-07': 1 }, total: 4 }],
        },
        {
          metric: 'cl',
          label: 'Closed',
          total: { '2026-05': 1, '2026-06': 1, '2026-07': 0 },
          items: [{ name: '(blank)', map: { '2026-05': 1, '2026-06': 1 }, total: 2 }],
        },
      ],
    },
  ],
};
