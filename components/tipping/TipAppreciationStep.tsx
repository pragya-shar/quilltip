'use client'

import { ArrowUpRight } from 'lucide-react'
import {
  TIP_MIN_USD,
  TIP_MAX_USD,
  TIP_XLM_PRESETS,
  type TipXlmPreset,
} from '@/lib/constants'
import { networkLabelLowercase } from '@/lib/copy/network-status'
import { TipPassageContext } from './TipPassageContext'
import { Button } from '@/components/ui/button'

interface TipAppreciationStepProps {
  variant: 'article' | 'highlight'
  articleTitle?: string
  highlightText?: string
  amountXlm?: TipXlmPreset
  customAmount: string
  tipMessage?: string
  onAmountXlmChange: (xlm: TipXlmPreset) => void
  onCustomAmountChange: (value: string) => void
  onTipMessageChange?: (value: string) => void
  onContinue: () => void
  isLoading: boolean
  canContinue: boolean
  idPrefix?: string
}

export function TipAppreciationStep({
  variant,
  articleTitle,
  highlightText,
  amountXlm,
  customAmount,
  tipMessage = '',
  onAmountXlmChange,
  onCustomAmountChange,
  onTipMessageChange,
  onContinue,
  isLoading,
  canContinue,
  idPrefix = 'tip',
}: TipAppreciationStepProps) {
  return (
    <>
      {variant === 'highlight' && highlightText ? (
        <TipPassageContext text={highlightText} />
      ) : null}

      {variant === 'article' && articleTitle ? (
        <p className="tip-passage">{articleTitle}</p>
      ) : null}

      <div
        className="tip-presets"
        role="group"
        aria-label="Choose a tip amount"
      >
        {TIP_XLM_PRESETS.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => onAmountXlmChange(amount)}
            disabled={isLoading}
            aria-pressed={amountXlm === amount}
            className="tip-preset"
          >
            <span className="font-semibold">
              {amount}{' '}
              {networkLabelLowercase() === 'testnet' ? 'test XLM' : 'XLM'}
            </span>
          </button>
        ))}
      </div>

      <Button
        type="button"
        onClick={onContinue}
        disabled={isLoading || !canContinue}
        className="tip-primary tip-choose-wallet"
      >
        Choose wallet
        <span className="tip-action-disc">
          <ArrowUpRight aria-hidden="true" />
        </span>
      </Button>

      <details open={customAmount || tipMessage ? true : undefined}>
        <summary className="tip-help-trigger">Other tip options</summary>
        <div className="tip-help-content">
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
        </div>
      </details>
    </>
  )
}
