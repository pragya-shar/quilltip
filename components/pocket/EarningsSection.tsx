'use client'

import { Button } from '@/system/components/Button'
import { Heading } from '@/system/components/Heading'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Notice } from '@/system/components/Notice'
import { PendingIcon, WithdrawIcon } from '@/system/icons'
import { sheetStack } from '@/shell/sheetStack'
import { usePocketSource } from './source'
import { tipsCount } from './copy'
import { WITHDRAW_SHEET } from './sheetIds'
import type { EarningsView } from './types'

const positive = (money: { cents: number } | null | undefined) =>
  (money?.cents ?? 0) > 0

/**
 * A writer's money, three figures kept apart (D10): ready to withdraw
 * (arrived, collectable now), on its way (accepted, not arrived) and paid to
 * your wallet (collected). Each is the sum of the shares its rows show, net
 * of the 2.5%, said once (design N2). Slow and failed tips are said in
 * words beside them; nothing here adds figures up. Withdraw appears only
 * once the money layer can withdraw (design N3).
 */
export function EarningsSection({
  earnings,
  headingLevel,
}: {
  earnings: EarningsView
  headingLevel: 2 | 3
}) {
  const withdraw = usePocketSource().useWithdraw()
  const status =
    earnings.status === 'ready'
      ? 'ready'
      : earnings.status === 'loading'
        ? 'loading'
        : 'unavailable'
  const ready = status === 'ready'
  const counts = ready ? earnings.counts : null
  const pendingCount = counts?.pending ?? 0
  const heading = (
    <Heading level={headingLevel} variant="section" id="pocket-earnings">
      Your earnings
    </Heading>
  )
  if (
    ready &&
    !positive(earnings.available) &&
    !positive(earnings.pending) &&
    !positive(earnings.onHold) &&
    !positive(earnings.notPaid) &&
    !positive(earnings.collected) &&
    !earnings.lagging
  )
    return (
      <section className="qt-pocket__earn" aria-labelledby="pocket-earnings">
        {heading}
        <p className="qt-pocket__plain">
          No earnings yet. Tips on your writing show up here, and you keep 97.5%
          of each.
        </p>
      </section>
    )
  const onHold = ready && positive(earnings.onHold) ? earnings.onHold : null
  const notPaid = ready && positive(earnings.notPaid) ? earnings.notPaid : null
  const available = ready ? earnings.available : null
  return (
    <section className="qt-pocket__earn" aria-labelledby="pocket-earnings">
      {heading}
      <MoneyFigure
        value={available}
        status={status}
        size="xl"
        label="Ready to withdraw"
        unavailableText="Not available right now"
      />
      <div className="qt-pocket__pair">
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
        <MoneyFigure
          value={ready ? earnings.collected : null}
          status={status}
          size="m"
          label="Paid to your wallet"
          unavailableText="Not available"
        />
      </div>
      {withdraw && available && positive(available) ? (
        <Button
          variant="primary"
          size="l"
          icon={WithdrawIcon}
          block
          onClick={() => sheetStack.open(WITHDRAW_SHEET)}
        >
          {`Withdraw ${available.display}`}
        </Button>
      ) : ready && !withdraw ? (
        <p className="qt-pocket__plain">
          Withdrawing arrives in a later update. Your earnings stay here, ready.
        </p>
      ) : ready && pendingCount > 0 ? (
        <p className="qt-pocket__fine">
          Nothing to withdraw yet. Tips on their way move here when they arrive,
          usually within a minute.
        </p>
      ) : null}
      <p className="qt-pocket__fine">
        These are your share. You keep 97.5% of every tip.
      </p>
      {ready && earnings.lagging ? (
        <Notice tone="pending">
          Some tips are taking longer than usual. They stay On its way until
          they arrive. If one cannot complete, it shows here and the reader
          keeps the money.
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
    </section>
  )
}
