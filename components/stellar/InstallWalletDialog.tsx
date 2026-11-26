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

type WalletInstallLink = {
  name: string
  href: string
  note?: string
}

// Official sites, as listed by Stellar Wallets Kit 2.x.
const WALLET_INSTALL_LINKS: WalletInstallLink[] = [
  {
    name: 'Varial',
    href: 'https://varialwallet.com',
    note: 'Formerly Freighter',
  },
  { name: 'xBull', href: 'https://xbull.app' },
  { name: 'LOBSTR', href: 'https://lobstr.co' },
  {
    name: 'Albedo',
    href: 'https://albedo.link',
    note: 'Web wallet; needs an HTTPS page',
  },
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
          <span className="wallet-install-eyebrow">
            Your wallet · Stellar testnet
          </span>
          <DialogTitle>Make room for a little appreciation.</DialogTitle>
          <DialogDescription>
            Choose a Stellar wallet, follow its setup steps, then return here to
            connect. If you just installed it, reload when your current task is
            saved.
          </DialogDescription>
        </DialogHeader>

        <div className="wallet-install-body">
          <div className="wallet-install-options">
            {WALLET_INSTALL_LINKS.map((w) => (
              <a
                key={w.name}
                href={w.href}
                target="_blank"
                rel="noopener noreferrer"
                className="wallet-install-option"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="wallet-install-name">{w.name}</div>
                    {w.note ? (
                      <div className="wallet-install-note">{w.note}</div>
                    ) : null}
                  </div>
                  <span className="wallet-install-destination">
                    Open site
                    <ArrowUpRight size={18} aria-hidden />
                  </span>
                </div>
              </a>
            ))}
          </div>

          <p className="wallet-install-note">
            Reading is free. Keep your recovery phrase private; QuillTip will
            never ask for it. Use Testnet and free test XLM for practice.
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
