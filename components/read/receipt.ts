import type { Money } from '@/hooks/read/payments'

/** The receipt sheet's id (declared in shell/sheets/read.ts). */
export const RECEIPT_SHEET = 'read-receipt'

export type ReceiptProps = {
  amount: Money
  writerName: string
  articleTitle: string
  /** The tipped line, or null for a tip on the whole article. */
  line: string | null
}
