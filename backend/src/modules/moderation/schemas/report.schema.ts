/** Cibles signalables — §29. Une par type de contenu ou de compte modérable. */
export const REPORT_TARGET_TYPES = ['post', 'comment', 'user', 'shop', 'product', 'conversation'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASON_CODES = [
  'spam',
  'abuse',
  'nudity',
  'scam',
  'counterfeit',
  'automatic_filter',
  'other',
] as const;
export type ReportReasonCode = (typeof REPORT_REASON_CODES)[number];

export const REPORT_STATUSES = ['pending', 'dismissed', 'actioned'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_ACTIONS = ['none', 'content_removed', 'warning', 'suspension', 'ban'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];
