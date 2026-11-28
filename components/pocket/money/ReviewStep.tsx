'use client'

import { Button } from '@/system/components/Button'
import { Switch } from '@/system/components/Switch'
import {
  LEDGER_FINE_PRINT,
  MONEY_ONLY_LINE,
  QUICK_TIPS_DEFINITION,
  TURN_OFF_LATER,
  consentLine,
} from '@/lib/addMoney/words'
import type { QuickTipsChoice } from '@/lib/addMoney/plan'
import { Rows } from './Rows'

/**
 * State 9: what the request does, with its fee, before the wallet is
 * asked. The primary button names what the reader agrees to. Quick tips
 * are stated in their exact unit (the cap in XLM, the end as a date and a
 * time), from the prepared request.
 */
export function ReviewStep({
  title,
  stepLabel,
  rows,
  choice,
  withQuickTips,
  consent,
  cancelsWithdrawal,
  primary,
  againLabel,
  busy,
  onPrimary,
  onChoice,
  onNotNow,
}: {
  title: string
  /** "Step 2 of 2" after linking in this sheet. */
  stepLabel: string | null
  rows: { label: string; value: string; spoken?: string }[]
  choice: QuickTipsChoice
  withQuickTips: boolean
  /** The until and cap of the approval, when the request carries one. */
  consent: { until: string; cap: string } | null
  cancelsWithdrawal: boolean
  primary: string
  /** "Also set up quick tips" / "Also renew quick tips". */
  againLabel: string
  busy: boolean
  onPrimary: () => void
  onChoice: (withQuickTips: boolean) => void
  onNotNow: () => void
}) {
  const consentBlock =
    withQuickTips && consent ? (
      <>
        <p className="qt-add__consent">
          {consentLine(consent.until, consent.cap)}
        </p>
        <p className="qt-add__fine">{LEDGER_FINE_PRINT}</p>
        <p className="qt-add__fine">{TURN_OFF_LATER}</p>
      </>
    ) : null
  return (
    <div className="qt-add__step">
      {stepLabel ? <p className="qt-add__step-label">{stepLabel}</p> : null}
      <p className="qt-add__lead">{title}</p>
      <Rows rows={rows} />
      {cancelsWithdrawal ? (
        <p className="qt-add__body">
          Adding money cancels the withdrawal you started.
        </p>
      ) : null}
      {choice === 'switch' ? (
        <>
          <Switch
            label="Also set up quick tips on this device"
            description={QUICK_TIPS_DEFINITION}
            checked={withQuickTips}
            disabled={busy}
            onChange={onChoice}
          />
          {consentBlock}
        </>
      ) : choice === 'add-only' ? (
        withQuickTips ? (
          <>
            <p className="qt-add__body">{QUICK_TIPS_DEFINITION}</p>
            {consentBlock}
          </>
        ) : (
          <p className="qt-add__body">{MONEY_ONLY_LINE}</p>
        )
      ) : null}
      <div className="qt-add__actions">
        <Button
          variant="primary"
          size="l"
          block
          loading={busy}
          onClick={onPrimary}
        >
          {primary}
        </Button>
        {choice === 'add-only' ? (
          <Button
            variant="quiet"
            block
            disabled={busy}
            onClick={() => onChoice(!withQuickTips)}
          >
            {withQuickTips ? 'Add money only' : againLabel}
          </Button>
        ) : null}
        <Button variant="quiet" block disabled={busy} onClick={onNotNow}>
          Not now
        </Button>
      </div>
    </div>
  )
}
