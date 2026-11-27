import type { ComponentType, ReactNode } from 'react'

/** What a lazily loaded sheet's body receives. */
export type SheetBodyProps<P = unknown> = {
  /** What `sheetStack.open(id, props)` was called with. */
  props: P
  /** Closes this sheet (focus returns to what opened it). */
  close: () => void
}

/**
 * A sheet whose code loads when it first opens. The shell draws the sheet
 * at once with its title and a placeholder, loads the body, and shows an
 * error with Try again if loading fails, never a blank sheet.
 *
 *   'add-money': {
 *     title: (props: { amount?: string }) =>
 *       props.amount ? `Add money to tip ${props.amount}` : 'Add money',
 *     load: () => import('@/components/pocket/sheets/AddMoney'),
 *   }
 *
 * The module's default export is the body. Keep loaded sheets under
 * `components/<area>/sheets/`: the first-load check refuses that path in
 * every measured route.
 */
export type SheetDeclaration<P = never> = {
  title: string | ((props: P) => string)
  /** One line under the title, when it helps. */
  description?: ReactNode
  load: () => Promise<{ default: ComponentType<SheetBodyProps<P>> }>
}

// Declarations of every package share one map; each sheet narrows its own
// props in its title and body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SheetDeclarations = Record<string, SheetDeclaration<any>>
