'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import { WALLET_IDS, type WalletOption } from '@/lib/stellar/v2/wallet'
import { walletPicker } from '@/lib/stellar/v2/wallet-picker'
import { networkLabel } from '@/lib/stellar/v2/wallet-errors'
import { STELLAR_CONFIG } from '@/lib/stellar/config'
import './wallet-help.css'

/** Wallets that work without an extension open their own window or QR code. */
function walletNote(option: WalletOption): string {
  if (option.id === WALLET_IDS.walletConnect) return 'Scan with a mobile wallet'
  if (option.id === WALLET_IDS.xbull || option.id === WALLET_IDS.albedo)
    return 'Opens in a new window'
  if (option.id === WALLET_IDS.varial) return 'Formerly Freighter'
  return 'Browser extension'
}

const displayName = (option: WalletOption) =>
  option.id === WALLET_IDS.varial ? 'Varial' : option.name

/**
 * QuillTip's wallet picker. A list of real buttons in a modal dialog, so it
 * works with a keyboard and a screen reader, which the kit's own picker does
 * not. Choosing a wallet asks that wallet for its address; the row shows the
 * wait until the wallet answers.
 */
export function WalletPicker() {
  const open = useSyncExternalStore(
    walletPicker.subscribe,
    walletPicker.isOpen,
    () => false
  )
  const [options, setOptions] = useState<WalletOption[] | null>(null)
  const [pending, setPending] = useState<WalletOption | null>(null)
  // The control that opened the picker gets focus back when it closes.
  const origin = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    let live = true
    setOptions(null)
    setPending(null)
    wallet
      .listWallets()
      .then((list) => {
        if (!live) return
        // Ready wallets first, in the kit's order.
        setOptions([
          ...list.filter((w) => w.isAvailable),
          ...list.filter((w) => !w.isAvailable),
        ])
      })
      .catch((error) => live && walletPicker.reject(error))
    return () => {
      live = false
    }
  }, [open])

  async function choose(option: WalletOption) {
    if (pending) return
    setPending(option)
    try {
      walletPicker.resolve(await wallet.connect({ walletId: option.id }))
    } catch (error) {
      walletPicker.reject(error)
    }
  }

  const network = networkLabel(STELLAR_CONFIG.NETWORK_PASSPHRASE)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && walletPicker.cancel()}>
      <DialogContent
        className="wallet-install-dialog wallet-picker"
        overlayClassName="wallet-install-overlay"
        aria-busy={pending !== null}
        onCloseAutoFocus={(event) => {
          const target = origin.current
          if (target?.isConnected && target !== document.body) {
            event.preventDefault()
            target.focus({ preventScroll: true })
          }
        }}
      >
        <DialogHeader>
          <span className="wallet-install-eyebrow">
            Your wallet · Stellar {network.toLowerCase()}
          </span>
          <DialogTitle>Choose a wallet</DialogTitle>
          <DialogDescription>
            Nothing is signed until you approve it in your wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="wallet-install-body">
          {options === null ? (
            <p className="wallet-picker-loading" role="status">
              <Loader2 size={16} className="wallet-picker-spin" aria-hidden />
              Looking for wallets in this browser…
            </p>
          ) : (
            <ul className="wallet-install-options" aria-label="Stellar wallets">
              {options.map((option) => {
                const name = displayName(option)
                const isPending = pending?.id === option.id
                return (
                  <li key={option.id}>
                    {option.isAvailable ? (
                      <button
                        type="button"
                        className="wallet-install-option wallet-picker-option"
                        aria-disabled={pending !== null && !isPending}
                        aria-describedby={`wallet-note-${option.id}`}
                        onClick={() => void choose(option)}
                      >
                        <span className="min-w-0">
                          <span className="wallet-install-name">{name}</span>
                          <span
                            id={`wallet-note-${option.id}`}
                            className="wallet-install-note"
                          >
                            {walletNote(option)}
                          </span>
                        </span>
                        <span className="wallet-install-destination">
                          {isPending ? (
                            <>
                              <Loader2
                                size={16}
                                className="wallet-picker-spin"
                                aria-hidden
                              />
                              Waiting
                            </>
                          ) : (
                            'Connect'
                          )}
                        </span>
                      </button>
                    ) : (
                      <a
                        href={option.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="wallet-install-option wallet-picker-option"
                      >
                        <span className="min-w-0">
                          <span className="wallet-install-name">{name}</span>
                          <span className="wallet-install-note">
                            Not installed
                          </span>
                        </span>
                        <span className="wallet-install-destination">
                          Get {name}
                          <ArrowUpRight size={16} aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </span>
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="wallet-picker-status" role="status" aria-live="polite">
            {pending
              ? `Approve the request in ${displayName(pending)}. If no window opened, check your browser toolbar.`
              : ''}
          </p>
          <p className="wallet-install-note">
            QuillTip uses Stellar {network}. Keep your recovery phrase private;
            QuillTip will never ask for it.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
