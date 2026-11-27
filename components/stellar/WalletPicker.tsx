'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import type { WalletOption } from '@/lib/stellar/v2/wallet'
import { walletPicker } from '@/lib/stellar/v2/wallet-picker'
import { isWalletError, networkLabel } from '@/lib/stellar/v2/wallet-errors'
import { walletConnectPairing } from '@/lib/stellar/v2/walletconnect-pairing'
import { STELLAR_CONFIG } from '@/lib/stellar/config'
import { WalletPickerRow } from './WalletPickerRow'
import { WalletConnectPairing } from './WalletConnectPairing'
import './wallet-help.css'

type Group = { id: string; heading: string; options: WalletOption[] }

/**
 * Wallets in groups a reader can tell apart: ready in this browser, on their
 * phone (WalletConnect, when configured), usable without installing
 * anything, and the ones to install first.
 */
function groupOptions(options: WalletOption[]): Group[] {
  const groups: Group[] = [
    {
      id: 'installed',
      heading: 'In this browser',
      options: options.filter((o) => o.access === 'installed'),
    },
    {
      id: 'mobile',
      heading: 'On your phone',
      options: options.filter((o) => o.access === 'mobile'),
    },
    {
      id: 'web',
      heading: 'No install needed',
      options: options.filter(
        (o) =>
          o.access === 'web' ||
          (o.access === 'unavailable' && o.kind !== 'extension')
      ),
    },
    {
      id: 'install',
      heading: 'Not installed',
      options: options.filter(
        (o) =>
          o.access === 'not-installed' ||
          (o.access === 'unavailable' && o.kind === 'extension')
      ),
    },
  ]
  return groups.filter((group) => group.options.length > 0)
}

function pendingMessage(option: WalletOption) {
  if (option.access === 'mobile') {
    return 'Approve the connection in the wallet on your phone.'
  }
  return option.access === 'web'
    ? `Approve the request in the ${option.name} window. If no window opened, allow pop-ups for this site and try again.`
    : // A locked extension shows a password prompt and reports nothing to
      // the page until it is unlocked (#547).
      `Approve the request in ${option.name}. If it asks for your password, unlock it first. If no window opened, check your browser toolbar.`
}

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
  const pairing = useSyncExternalStore(
    walletConnectPairing.subscribe,
    walletConnectPairing.get,
    () => null
  )
  const wentBack = useRef(false)
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
      .then((list) => live && setOptions(list))
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
      // Back from the pairing step: stay in the picker.
      if (wentBack.current && isWalletError(error, 'cancelled')) {
        wentBack.current = false
        setPending(null)
        return
      }
      walletPicker.reject(error)
    }
  }

  function backToWallets() {
    wentBack.current = true
    walletConnectPairing.cancel()
  }

  const network = networkLabel(STELLAR_CONFIG.NETWORK_PASSPHRASE)
  const groups = options ? groupOptions(options) : []
  const showPairing = pairing !== null && pending?.access === 'mobile'
  const offersPhone = options?.some((o) => o.access === 'mobile') ?? false

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        // Closing during a pairing stops the wait for the phone too.
        walletConnectPairing.cancel()
        walletPicker.cancel()
      }}
    >
      <DialogContent
        className="wallet-install-dialog wallet-picker"
        overlayClassName="wallet-install-overlay"
        // The pairing step is waiting on the reader, not loading.
        aria-busy={pending !== null && !showPairing}
        onCloseAutoFocus={(event) => {
          const target = origin.current
          if (target?.isConnected && target !== document.body) {
            event.preventDefault()
            target.focus({ preventScroll: true })
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Choose a wallet</DialogTitle>
          <DialogDescription>
            QuillTip uses Stellar {network.toLowerCase()}. Nothing is signed
            until you approve it in your wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="wallet-install-body">
          {showPairing && pairing ? (
            <WalletConnectPairing pairing={pairing} onBack={backToWallets} />
          ) : options === null ? (
            <p className="wallet-picker-loading" role="status">
              <Loader2 size={16} className="wallet-picker-spin" aria-hidden />
              Looking for wallets in this browser…
            </p>
          ) : (
            groups.map((group) => (
              <section
                key={group.id}
                className="wallet-group"
                aria-labelledby={`wallet-group-${group.id}`}
              >
                <h3
                  id={`wallet-group-${group.id}`}
                  className="wallet-group-heading"
                >
                  {group.heading}
                </h3>
                <ul className="wallet-install-options">
                  {group.options.map((option) => (
                    <li key={option.id}>
                      <WalletPickerRow
                        option={option}
                        pending={pending}
                        onChoose={() => void choose(option)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          <p className="wallet-picker-status" role="status" aria-live="polite">
            {/* The pairing step says what to do itself. */}
            {pending && !showPairing ? pendingMessage(pending) : ''}
          </p>
          <p className="wallet-install-note">
            Keep your recovery phrase private; QuillTip will never ask for it.{' '}
            {offersPhone
              ? 'Hardware wallets are not supported yet.'
              : 'Hardware and mobile wallets are not supported yet.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
