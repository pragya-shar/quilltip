import type { SignOutCleanup, SignOutWarning } from './types'

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
  {
    // Signing out ends quick tips on this device: its approval keys go, so
    // the next sign-in here asks the wallet once before quick tips.
    name: 'quick tips keys',
    run: () =>
      Promise.all([
        import('@/lib/addMoney/forgetKeys'),
        import('@/lib/stellar/v2/tab/config'),
      ]).then(([keys, tab]) => {
        let contract: string | null = null
        try {
          contract = tab.tabConfig().tabContractId
        } catch {
          contract = null
        }
        return contract ? keys.forgetDeviceKeys(contract) : undefined
      }),
  },
]

/** What the pocket package warns of before sign-out. Owned by that package. */
export const warnings: readonly SignOutWarning[] = []
