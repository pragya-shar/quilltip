'use client'

import { Button } from '@/system/components/Button'
import { Heading } from '@/system/components/Heading'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Notice } from '@/system/components/Notice'
import { PendingIcon, WithdrawIcon } from '@/system/icons'
import { sheetStack } from '@/shell/sheetStack'
import { tipsCount } from './copy'
import { WITHDRAW_SHEET } from './sheetIds'
import type { EarningsView } from './types'

/**
 * A writer's money, three figures kept apart (D10): ready to withdraw
 * (arrived, collectable now), on its way (accepted, not arrived) and paid to
 * your wallet (collected). Slow and failed tips are said in words beside
 * them; nothing here adds figures up.
 */
export function EarningsSection({
  earnings,
  headingLevel,
}: {
  earnings: EarningsView
  headingLevel: 2 | 3
}) {
  const status =
    earnings.status === 'ready'
      ? 'ready'
      : earnings.status === 'loading'
        ? 'loading'
        : 'unavailable'
  const ready = status === 'ready'
  const counts = ready ? earnings.counts : null
  const canWithdraw = ready && (earnings.available?.cents ?? 0) > 0
  const onHold =
    ready && earnings.onHold && earnings.onHold.cents > 0
      ? earnings.onHold
      : null
  const notPaid =
    ready && earnings.notPaid && earnings.notPaid.cents > 0
      ? earnings.notPaid
      : null
  const pendingCount = counts?.pending ?? 0
  return (
    <section className="qt-pocket__earn" aria-labelledby="pocket-earnings">
      <Heading level={headingLevel} variant="section" id="pocket-earnings">
        Your earnings
      </Heading>
      <div className="qt-pocket__pair">
        <MoneyFigure
          value={ready ? earnings.available : null}
          status={status}
          size="l"
          label="Ready to withdraw"
          unavailableText="Not available right now"
        />
        <MoneyFigure
          value={ready ? earnings.pending : null}
          status={status}
          size="m"
          label={
            <span className="qt-pocket__with-icon">
              <Icon icon={PendingIcon} size={16} />
              {pendingCount > 0
                ? `On its way, ${tipsCount(pendingCount)}`
                : 'On its way'}
            </span>
          }
          unavailableText="Not available"
        />
      </div>
      <p className="qt-pocket__collected">
        <MoneyFigure
          value={ready ? earnings.collected : null}
          status={status}
          size="s"
          unavailableText="Not available"
        />
        <span>paid to your wallet</span>
      </p>
      {canWithdraw ? (
        <Button
          variant="primary"
          icon={WithdrawIcon}
          block
          onClick={() => sheetStack.open(WITHDRAW_SHEET)}
        >
          Withdraw
        </Button>
      ) : ready ? (
        <p className="qt-pocket__fine">
          {pendingCount > 0
            ? 'Nothing to withdraw yet. Tips on their way move to Ready to withdraw when they arrive.'
            : 'Nothing to withdraw yet.'}
        </p>
      ) : null}
      {ready && earnings.lagging ? (
        <Notice tone="pending">
          Some tips are taking longer than usual. They stay On its way until
          they arrive.
        </Notice>
      ) : null}
      {onHold ? (
        <Notice tone="pending">
          <MoneyFigure value={onHold} size="s" /> is on hold
          {counts && counts.onHold > 0
            ? ` (${tipsCount(counts.onHold)})`
            : ''}:{' '}
          {counts && counts.onHold > 1
            ? 'the readers’ balances were short when they were paid out. They arrive if the readers add money.'
            : 'the reader’s balance was short when it was paid out. It arrives if they add money.'}
        </Notice>
      ) : null}
      {notPaid ? (
        <Notice tone="failure">
          <MoneyFigure value={notPaid} size="s" /> did not complete
          {counts && counts.notPaid > 0
            ? ` (${tipsCount(counts.notPaid)})`
            : ''}
          .{' '}
          {counts && counts.notPaid > 1
            ? 'The readers kept that money.'
            : 'The reader kept that money.'}
        </Notice>
      ) : null}
      <p className="qt-pocket__fine">You keep 97.5% of every tip.</p>
    </section>
  )
}
