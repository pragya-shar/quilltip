import type { SignOutCleanup } from './types'

/** What the pocket package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = [
  {
    // The last reader's balance, earnings and activity in the payments
    // store, so the next person never reads them.
    name: 'payments figures',
    run: () =>
      import('@/lib/payments/store').then((m) =>
        m.paymentsStore.setAuth('signed-out')
      ),
  },
  {
    // Whether the last person writes.
    name: 'balance writer state',
    run: () =>
      import('@/components/pocket/writerMemory').then((m) =>
        m.writerMemory.forget()
      ),
  },
]
