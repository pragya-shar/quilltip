import type { SheetDeclarations } from './types'

/** The read package's lazily loaded sheets. Owned by that package. */
export const sheets: SheetDeclarations = {
  // The receipt of a tip the server accepted (components/read/receipt.ts
  // names the id and its props).
  'read-receipt': {
    title: 'Receipt',
    load: () => import('@/components/read/sheets/Receipt'),
  },
}
