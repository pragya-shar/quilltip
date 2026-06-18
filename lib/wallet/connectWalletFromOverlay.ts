export type ConnectWalletFromOverlayOptions = {
  activateWallet: () => void
  connect: () => Promise<boolean>
  closeOverlay: () => void | Promise<void>
  reopenOverlay: () => void | Promise<void>
  yieldToBrowser?: () => Promise<void>
}

const defaultYieldToBrowser = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })

/**
 * Connect a wallet while a Radix (or similar) overlay dialog is open.
 * Closes the overlay first so the Stellar Wallets Kit modal and extension
 * popups are not blocked by the parent dialog's focus trap / inert layer.
 */
export async function connectWalletFromOverlay(
  options: ConnectWalletFromOverlayOptions
): Promise<boolean> {
  const yieldToBrowser = options.yieldToBrowser ?? defaultYieldToBrowser

  options.activateWallet()
  await options.closeOverlay()
  await yieldToBrowser()

  try {
    return await options.connect()
  } finally {
    await options.reopenOverlay()
  }
}
