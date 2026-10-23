'use client'

import { useState } from 'react'
import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { WalletTooltip } from '@/components/stellar/WalletTooltip'
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
      <CollapsibleTrigger className="tip-help-trigger">
        How it works
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="tip-help-content">
        <p>
          97.5% of your tip goes directly to the author. The platform receives
          2.5%. You approve the payment separately in your wallet.
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
        <WalletSetupHelp />
      </CollapsibleContent>
    </Collapsible>
  )
}
