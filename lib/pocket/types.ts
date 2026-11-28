/**
 * The money views the balance reads: the money layer's own types
 * (`lib/payments/types.ts`), re-exported so the balance never keeps a copy
 * that could drift. Every amount is a `Money` the money layer wrote: the
 * balance never formats, rounds, adds or subtracts money
 * (system/README.md, "Money").
 */
export type {
  ActivityItem,
  ActivityView,
  BalanceView,
  Cents,
  EarningsView,
  Money,
  NotPaidReason,
} from '@/lib/payments/types'
