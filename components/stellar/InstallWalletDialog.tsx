'use client'

import { useRef, type RefObject } from 'react'
import './wallet-help.css'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowUpRight } from 'lucide-react'
import {
  OFFERED_WALLETS,
  WALLET_CATALOG,
  type WalletCatalogEntry,
} from '@/lib/stellar/wallet-catalog'
import { WalletIcon } from './WalletIcon'

type InstallLink = { entry: WalletCatalogEntry; href: string; note: string }

const EXTENSIONS: InstallLink[] = OFFERED_WALLETS.filter(
  (entry) => entry.kind === 'extension' || entry.kind === 'extension-or-web'
).map((entry) => ({
  entry,
  href: entry.url,
  note: entry.formerly
    ? `Formerly ${entry.formerly}. Browser extension`
    : 'Browser extension',
}))

const WEB_WALLETS: InstallLink[] = OFFERED_WALLETS.filter(
  (entry) => entry.kind === 'web' || entry.kind === 'extension-or-web'
).map((entry) => ({
  entry,
  href: entry.webUrl ?? entry.url,
  note: entry.needsHttps
    ? 'Web wallet; needs an HTTPS page'
    : 'Web wallet; opens in a new window',
}))

const NOT_SUPPORTED = WALLET_CATALOG.filter((entry) => !entry.offered)
  .map((entry) => entry.name)
  .join(', ')

const GROUPS = [
  { id: 'extensions', heading: 'Browser extensions', links: EXTENSIONS },
  { id: 'web', heading: 'Web wallets, nothing to install', links: WEB_WALLETS },
]

export function InstallWalletDialog({
  open,
  onOpenChange,
  returnFocusRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef?: RefObject<HTMLButtonElement | null>
}) {
  const origin = useRef<HTMLElement | null>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="wallet-install-dialog"
        overlayClassName="wallet-install-overlay"
        onOpenAutoFocus={() => {
          origin.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current ?? origin.current
          if (target?.isConnected && target !== document.body) {
            event.preventDefault()
            target.focus({ preventScroll: true })
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Make room for a little appreciation.</DialogTitle>
          <DialogDescription>
            Choose a Stellar wallet and follow its setup steps. QuillTip uses
            Stellar testnet. An extension needs a reload once it is installed,
            so save your current task first.
          </DialogDescription>
        </DialogHeader>

        <div className="wallet-install-body">
          {GROUPS.map((group) => (
            <section
              key={group.id}
              className="wallet-group"
              aria-labelledby={`wallet-install-${group.id}`}
            >
              <h3
                id={`wallet-install-${group.id}`}
                className="wallet-group-heading"
              >
                {group.heading}
              </h3>
              <ul className="wallet-install-options">
                {group.links.map(({ entry, href, note }) => (
                  <li key={`${group.id}-${entry.id}`}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="wallet-install-option wallet-picker-option"
                    >
                      <span className="wallet-row-body">
                        <WalletIcon name={entry.name} src={entry.icon} />
                        <span className="wallet-row-text">
                          <span className="wallet-install-name">
                            {entry.name}
                          </span>
                          <span className="wallet-install-note">{note}</span>
                        </span>
                      </span>
                      <span className="wallet-install-destination">
                        Open site
                        <ArrowUpRight size={16} aria-hidden />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="wallet-install-note">
            Reading is free. Keep your recovery phrase private; QuillTip will
            never ask for it. Use Testnet and free test XLM for practice. Not
            supported yet: {NOT_SUPPORTED}.
          </p>
          <button
            type="button"
            className="wallet-install-dismiss"
            onClick={() => onOpenChange(false)}
          >
            Back to what I was doing
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
