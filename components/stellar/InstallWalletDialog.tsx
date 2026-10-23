'use client'

import { useRef } from 'react'
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

const WALLET_INSTALL_LINKS: WalletInstallLink[] = [
  {
    name: 'Freighter',
    href: 'https://chromewebstore.google.com/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk',
  },
  {
    name: 'xBull',
    href: 'https://chromewebstore.google.com/detail/xbull-wallet/omajpeaffjgmlpmhbfdjepdejoemifpe',
  },
  {
    name: 'Albedo',
    href: 'https://chrome.google.com/webstore/detail/albedo-signer-for-stellar/kbojmmmibkfijmjgnfgfpngmmgkkpncl/',
    note: 'Requires HTTPS for some flows',
  },
  {
    name: 'HOT Wallet',
    href: 'https://chromewebstore.google.com/detail/hot-wallet/mpeengabcnhhjjgleiodimegnkpcenbk',
  },
]

export function InstallWalletDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const origin = useRef<HTMLElement | null>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="wallet-install-dialog"
        onOpenAutoFocus={() => {
          origin.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
        }}
        onCloseAutoFocus={(event) => {
          if (origin.current?.isConnected) {
            event.preventDefault()
            origin.current.focus({ preventScroll: true })
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
                    Open store
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
