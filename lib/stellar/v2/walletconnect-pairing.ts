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
let canceller: (() => void) | null = null
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
  /** Shows a pairing; `cancel` ends the wait for the phone. */
  show(pairing: Pairing, cancel?: () => void) {
    current = pairing
    canceller = cancel ?? null
    notify()
  },
  clear() {
    canceller = null
    if (!current) return
    current = null
    notify()
  },
  /** The reader went back or closed the picker: stop waiting for the phone. */
  cancel() {
    const cancel = canceller
    walletConnectPairing.clear()
    cancel?.()
  },
}
