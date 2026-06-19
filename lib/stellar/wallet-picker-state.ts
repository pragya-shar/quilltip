type WalletPickerListener = () => void

let walletPickerOpen = false
const listeners = new Set<WalletPickerListener>()
let pickerInteractionCleanup: (() => void) | null = null

function notifyWalletPickerListeners() {
  for (const listener of listeners) {
    listener()
  }
}

function unlockWalletPickerFromInert() {
  document.querySelectorAll('stellar-wallets-modal').forEach((element) => {
    element.removeAttribute('inert')
    element.removeAttribute('aria-hidden')
  })
}

function startWalletPickerInteractionUnlock() {
  unlockWalletPickerFromInert()

  const observer = new MutationObserver(() => {
    unlockWalletPickerFromInert()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['inert', 'aria-hidden'],
  })

  pickerInteractionCleanup = () => {
    observer.disconnect()
    pickerInteractionCleanup = null
  }
}

function stopWalletPickerInteractionUnlock() {
  pickerInteractionCleanup?.()
}

export function getWalletPickerOpen(): boolean {
  return walletPickerOpen
}

export function subscribeWalletPickerOpen(
  listener: WalletPickerListener
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setWalletPickerOpen(open: boolean): void {
  if (walletPickerOpen === open) return
  walletPickerOpen = open
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('wallet-picker-open', open)
    if (open) {
      startWalletPickerInteractionUnlock()
    } else {
      stopWalletPickerInteractionUnlock()
    }
  }
  notifyWalletPickerListeners()
}

/** Test-only reset */
export function resetWalletPickerOpenForTests(): void {
  walletPickerOpen = false
  listeners.clear()
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('wallet-picker-open')
  }
  stopWalletPickerInteractionUnlock()
}
