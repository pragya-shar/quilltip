'use client'

import { HelpCircle } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const concepts: Record<string, string> = {
  stellar:
    'Stellar is a fast, low-cost blockchain network. Quilltip uses it to process tips in 3-5 seconds with fees under $0.01.',
  xlm: 'XLM (Stellar Lumens) is the currency used on the Stellar network. Tips on Quilltip are sent in XLM.',
  testnet:
    'Testnet is a practice environment with free tokens. No real money is involved — perfect for trying things out.',
  wallet:
    'A crypto wallet is a browser extension (like Freighter) that lets you hold and send digital currency securely.',
  'tip-fee':
    'Quilltip takes only 2.5% — the writer receives 97.5% of every tip instantly.',
  highlight:
    'Highlight a passage you love, then tip it directly. The author sees exactly which words earned the tip.',
}

interface WalletTooltipProps {
  concept: keyof typeof concepts
  className?: string
}

export function WalletTooltip({ concept, className = '' }: WalletTooltipProps) {
  const text = concepts[concept]
  if (!text) return null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center text-neutral-400 hover:text-neutral-600 transition-colors ${className}`}
            aria-label={`Learn about ${concept}`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
