'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { WalletTooltip } from '@/components/guide/WalletTooltip'
import { TipBreakdownSummaryLine } from '@/components/tipping/TipBreakdownSummaryLine'
import { TipUsdXlmRateLine } from '@/components/tipping/TipUsdXlmRateLine'
import {
  networkLabelLowercase,
  tipFlowShortNote,
} from '@/lib/copy/network-status'
import { cn } from '@/lib/utils'

interface TipHowItWorksProps {
  priceUsd: number | null
  totalFormatted?: string
  authorFormatted?: string
  platformFeeFormatted?: string
}

export function TipHowItWorks({
  priceUsd,
  totalFormatted,
  authorFormatted,
  platformFeeFormatted,
}: TipHowItWorksProps) {
  const [open, setOpen] = useState(false)
  const showBreakdown =
    totalFormatted && authorFormatted && platformFeeFormatted

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="focus-ring flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50">
        How it works
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <p>
          97.5% of your tip goes directly to the author. A small platform fee
          covers payment processing.
        </p>
        {showBreakdown ? (
          <TipBreakdownSummaryLine
            totalFormatted={totalFormatted}
            authorFormatted={authorFormatted}
            platformFeeFormatted={platformFeeFormatted}
          />
        ) : null}
        <TipUsdXlmRateLine priceUsd={priceUsd} />
        <p className="flex flex-wrap items-center justify-center gap-1 text-xs">
          Powered by Stellar {networkLabelLowercase()}{' '}
          <WalletTooltip concept="stellar" />{' '}
          {networkLabelLowercase() === 'testnet' ? (
            <WalletTooltip concept="testnet" />
          ) : null}{' '}
          • {tipFlowShortNote()}
        </p>
        <p>
          New to crypto?{' '}
          <Link
            href="/guide"
            className="focus-ring rounded font-medium text-foreground underline hover:text-foreground/80"
          >
            Follow our setup guide
          </Link>
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
