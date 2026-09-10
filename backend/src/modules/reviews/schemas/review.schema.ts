export const REVIEW_TARGETS = ['product', 'shop', 'courier'] as const;
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];
