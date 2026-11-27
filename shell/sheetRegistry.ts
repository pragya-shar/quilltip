import type { ComponentType } from 'react'

/**
 * Sheets a surface adds to the shell's stack: the money acts (Add money,
 * Withdraw, Receipt, Pay with, Amount) and the sign-in. A surface registers
 * its sheet once, from its own directory, then opens it with
 * `sheetStack.open(id, props)`. The shell's host renders it over whatever
 * the person is doing; it never navigates.
 *
 *   registerSheet<{ amount: number }>('add-money', AddMoneySheet)
 *   sheetStack.open('add-money', { amount: 1000 })
 *
 * The component renders a `Sheet` from the design system with the `open`
 * and `onClose` it is given, so it gets the focus rules and the exit.
 */
export type SheetComponentProps<P = unknown> = {
  open: boolean
  onClose: () => void
  props: P
}

const registry = new Map<string, ComponentType<SheetComponentProps<never>>>()

export function registerSheet<P>(
  id: string,
  component: ComponentType<SheetComponentProps<P>>
) {
  if (id === 'pocket') throw new Error('"pocket" is the shell\'s own sheet')
  registry.set(id, component as ComponentType<SheetComponentProps<never>>)
}

export function sheetFor(
  id: string
): ComponentType<SheetComponentProps<unknown>> | undefined {
  return registry.get(id) as
    | ComponentType<SheetComponentProps<unknown>>
    | undefined
}
