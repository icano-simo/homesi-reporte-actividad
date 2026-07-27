// Type alias, not a strict union: OrgIDs outside the roster can appear at
// runtime and a future stage needs to detect them dynamically.
export type Branch = string;

export const OFFICIAL_ROSTER: Branch[] = [
  '700',
  '701',
  '702',
  '703',
  '707',
  '710',
  '716',
  '718',
  '721',
  '724',
  '728',
  '733',
  '741',
  '747',
  '760',
  '770',
  '771',
  '776',
  'AFFINITY',
];

export const OUT_OF_DIVISION: Branch = 'Branch Out of Division';

export const BRANCH_ORDER: Branch[] = [...OFFICIAL_ROSTER, OUT_OF_DIVISION];
