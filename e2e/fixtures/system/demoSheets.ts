import type { SheetDeclarations } from '../../../shell/sheets/types'

// Stands in for shell/sheets/today.ts in the fixture build: one sheet that
// loads slowly, and one whose first load fails.
let brokenOnce = true

const slow = <T>(load: () => Promise<T>) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(load()), 400))

export const sheets: SheetDeclarations = {
  'demo-lazy': {
    title: (props: { amount?: string }) =>
      props?.amount ? `Add money to tip ${props.amount}` : 'Add money',
    load: () => slow(() => import('./DemoSheetBody')),
  },
  'demo-broken': {
    title: 'Withdraw',
    load: () => {
      if (brokenOnce) {
        brokenOnce = false
        return Promise.reject(new Error('offline'))
      }
      return import('./DemoSheetBody')
    },
  },
}
