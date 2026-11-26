/**
 * The WalletConnect pairing the picker shows: the `wc:` URI to scan as a QR
 * code or open in a wallet app, while the phone has not answered yet. The
 * WalletConnect module (`walletconnect-module.ts`) sets and clears it; the
 * picker's pairing step (`components/stellar/WalletConnectPairing.tsx`)
 * subscribes. No WalletConnect code is imported here.
 */

export type Pairing = {
  uri: string
  /** When the pairing proposal expires, in epoch milliseconds. */
  expiresAt: number
}

let current: Pairing | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export const walletConnectPairing = {
  get: (): Pairing | null => current,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  show(pairing: Pairing) {
    current = pairing
    notify()
  },
  clear() {
    if (!current) return
    current = null
    notify()
  },
}
