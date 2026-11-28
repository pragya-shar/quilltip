'use client'

import './balanceCaption.css'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import { ForwardIcon } from '@/system/icons'
import { sheetStack } from '@/shell/sheetStack'
import type { MoneyValue } from '@/system/money/figure'

/**
 * The balance in the dock, as the way to the balance sheet on a pushed
 * screen, where the bar is hidden: "≈ $18.40 ready to tip ›", or the
 * compact "≈ $18.40 ›" beside a chosen line's actions. Spoken "about 18
 * dollars 40 ready to tip. Open balance". Hidden from 1024 px, where the
 * rail shows the balance. The "≈" comes from the figure's `converted`.
 */
export function BalanceCaption({
  available,
  compact = false,
}: {
  available: MoneyValue | null
  compact?: boolean
}) {
  return (
    <div className="qt-balance-caption" data-compact={compact ? '' : undefined}>
      <button
        type="button"
        className="qt-balance-caption__open"
        aria-label={
          available
            ? `${available.spoken ?? available.display} ready to tip. Open balance`
            : 'Balance. Open balance'
        }
        onClick={() => sheetStack.open('pocket')}
      >
        <MoneyFigure
          size="s"
          value={available}
          status={available ? 'ready' : 'unavailable'}
          label={available && !compact ? 'ready to tip' : undefined}
          unavailableText="Balance"
        />
        <span className="qt-balance-caption__more" aria-hidden="true">
          <Icon icon={ForwardIcon} size={16} />
        </span>
      </button>
      {compact ? null : <TestnetNote>Testnet</TestnetNote>}
    </div>
  )
}
