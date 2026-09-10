export const SANCTION_TYPES = ['warning', 'suspension', 'ban'] as const;
export type SanctionType = (typeof SANCTION_TYPES)[number];
