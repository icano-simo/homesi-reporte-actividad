import { OFFICIAL_ROSTER, OUT_OF_DIVISION, type Branch } from '@/config/roster';

/**
 * Port exacto de mapBranch() del legacy.
 *
 *   classifyBranch('affinity') -> 'AFFINITY'              (case-insensitive)
 *   classifyBranch('AFFINITY') -> 'AFFINITY'
 *   classifyBranch('700')      -> '700'                    (está en OFFICIAL_ROSTER)
 *   classifyBranch('999')      -> 'Branch Out of Division'  (OUT_OF_DIVISION, no está en el roster)
 */
export function classifyBranch(trueOrgId: string): Branch {
  const s = trueOrgId.trim();
  if (/^affinity$/i.test(s)) return 'AFFINITY';
  if (OFFICIAL_ROSTER.includes(s)) return s;
  return OUT_OF_DIVISION;
}
