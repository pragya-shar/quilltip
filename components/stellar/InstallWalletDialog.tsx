'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ExternalLink, Download } from 'lucide-react'

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Install a Stellar wallet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t find a Stellar wallet in your browser. Install one of
            the options below, then reload this page and try connecting again.
          </p>

          <div className="grid gap-2">
            {WALLET_INSTALL_LINKS.map((w) => (
              <a
                key={w.name}
                href={w.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{w.name}</div>
                    {w.note ? (
                      <div className="text-xs text-muted-foreground">{w.note}</div>
                    ) : null}
                  </div>
                  <span className="inline-flex items-center text-xs text-muted-foreground">
                    Open store
                    <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </span>
                </div>
              </a>
            ))}
          </div>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

