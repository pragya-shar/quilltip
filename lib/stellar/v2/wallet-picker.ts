/**
 * The open request for Quilltip's wallet picker. `useStellarWallet().connect()`
 * calls `openWalletPicker()`; the `WalletPicker` dialog (rendered once by the
 * wallet runtime) shows the request and settles it with a connection, a
 * wallet error, or `cancelled` when the reader closes it.
 *
 * Quilltip draws its own picker instead of the kit's `authModal` because the
 * kit's wallet options are list items with click handlers only: they cannot
 * be reached or chosen with a keyboard.
 */
import type { WalletConnection } from './wallet'
import { WalletError } from './wallet-errors'

type PickerRequest = {
  resolve: (connection: WalletConnection) => void
  reject: (error: unknown) => void
}

let current: PickerRequest | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export function openWalletPicker(): Promise<WalletConnection> {
  // A second request while the picker is open joins the first.
  if (current) {
    const existing = current
    return new Promise((resolve, reject) => {
      const { resolve: r1, reject: j1 } = existing
      existing.resolve = (c) => (r1(c), resolve(c))
      existing.reject = (e) => (j1(e), reject(e))
    })
  }
  return new Promise((resolve, reject) => {
    current = { resolve, reject }
    notify()
  })
}

function settle(action: (request: PickerRequest) => void) {
  const request = current
  if (!request) return
  current = null
  notify()
  action(request)
}

export const walletPicker = {
  isOpen: () => current !== null,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  resolve: (connection: WalletConnection) =>
    settle((request) => request.resolve(connection)),
  reject: (error: unknown) => settle((request) => request.reject(error)),
  cancel: () =>
    settle((request) =>
      request.reject(
        new WalletError('cancelled', 'Wallet selection was closed')
      )
    ),
}
