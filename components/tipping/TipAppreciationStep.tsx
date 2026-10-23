'use client'

import { ArrowRight } from 'lucide-react'
import {
  calculateTipBreakdown,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'
import { TIP_MIN_USD, TIP_MAX_USD } from '@/lib/constants'
import { TipHowItWorks } from '@/components/tipping/TipHowItWorks'
import { TipPassageContext } from './TipPassageContext'
import { Button } from '@/components/ui/button'

type TipPreset = {
  readonly cents: number
  readonly label: string
  readonly popular: boolean
}

interface TipAppreciationStepProps {
  variant: 'article' | 'highlight'
  authorName: string
  highlightText?: string
  presets: readonly TipPreset[]
  selectedAmount: number | null
  customAmount: string
  tipMessage?: string
  onSelectedAmountChange: (cents: number | null) => void
  onCustomAmountChange: (value: string) => void
  onTipMessageChange?: (value: string) => void
  onContinue: () => void
  onCancel: () => void
  isLoading: boolean
  canContinue: boolean
  priceUsd: number | null
  idPrefix?: string
}

export function TipAppreciationStep({
  variant,
  authorName,
  highlightText,
  presets,
  selectedAmount,
  customAmount,
  tipMessage = '',
  onSelectedAmountChange,
  onCustomAmountChange,
  onTipMessageChange,
  onContinue,
  onCancel,
  isLoading,
  canContinue,
  priceUsd,
  idPrefix = 'tip',
}: TipAppreciationStepProps) {
  const previewCents = selectedAmount || parseFloat(customAmount) * 100
  const tipBreakdownPreview =
    Number.isFinite(previewCents) && previewCents > 0
      ? calculateTipBreakdown(previewCents)
      : null

  return (
    <>
      {variant === 'highlight' && highlightText ? (
        <TipPassageContext text={highlightText} />
      ) : null}

      <p className="tip-step-copy">
        {variant === 'article'
          ? `Choose an amount to support ${authorName}.`
          : `Support ${authorName} for this passage.`}
      </p>

      <div
        className="tip-presets"
        role="group"
        aria-label="Choose a tip amount"
      >
        {presets.map((amount) => (
          <button
            key={amount.cents}
            type="button"
            onClick={() => {
              onSelectedAmountChange(amount.cents)
              onCustomAmountChange('')
            }}
            disabled={isLoading}
            aria-pressed={selectedAmount === amount.cents}
            className="tip-preset"
          >
            {amount.popular && (
              <span className="tip-popular" aria-hidden="true">
                Popular
              </span>
            )}
            <span className="font-semibold">{amount.label}</span>
          </button>
        ))}
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-custom-amount`}
          className="tip-field-label"
        >
          Or enter custom amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
            $
          </span>
          <input
            id={`${idPrefix}-custom-amount`}
            type="number"
            inputMode="decimal"
            aria-describedby={`${idPrefix}-amount-hint`}
            min={TIP_MIN_USD}
            max={TIP_MAX_USD}
            step="0.01"
            value={customAmount}
            onChange={(e) => {
              onCustomAmountChange(e.target.value)
              onSelectedAmountChange(null)
            }}
            disabled={isLoading}
            placeholder="0.00"
            className="tip-input tip-custom-input"
          />
        </div>
        <p id={`${idPrefix}-amount-hint`} className="tip-hint">
          Minimum: ${TIP_MIN_USD.toFixed(2)} • Maximum: $
          {TIP_MAX_USD.toFixed(2)}
        </p>
      </div>

      {variant === 'article' && onTipMessageChange ? (
        <div>
          <label
            htmlFor={`${idPrefix}-optional-message`}
            className="tip-field-label"
          >
            Message to author (optional)
          </label>
          <textarea
            id={`${idPrefix}-optional-message`}
            value={tipMessage}
            onChange={(e) => onTipMessageChange(e.target.value)}
            disabled={isLoading}
            maxLength={500}
            rows={3}
            placeholder="Say thanks or leave context for your tip..."
            className="tip-input resize-none"
          />
          <p className="tip-hint">{tipMessage.length}/500 characters</p>
        </div>
      ) : null}

      <TipHowItWorks
        priceUsd={priceUsd}
        totalFormatted={
          tipBreakdownPreview ? formatTipAmount(previewCents) : undefined
        }
        authorFormatted={tipBreakdownPreview?.authorShareFormatted}
        platformFeeFormatted={tipBreakdownPreview?.platformFeeFormatted}
      />

      <div className="tip-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={isLoading || !canContinue}
          className="flex-1 gap-2"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </>
  )
}
