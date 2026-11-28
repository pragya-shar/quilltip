'use client'

import { Button } from '@/system/components/Button'
import { Heading } from '@/system/components/Heading'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Notice } from '@/system/components/Notice'
import { PendingIcon, WithdrawIcon } from '@/system/icons'
import { sheetStack } from '@/shell/sheetStack'
import { warmSheet } from '@/shell/sheets/preload'
import { usePocketSource } from '@/lib/pocket/source'
import type { EarningsView } from '@/lib/pocket/types'
import { tipsCount } from './copy'
import { WITHDRAW_SHEET } from './sheetIds'

const positive = (money: { cents: number } | null | undefined) =>
  (money?.cents ?? 0) > 0

/**
 * A writer's money, three figures kept apart: what has arrived (collectable
 * once withdrawing exists), what is on its way (accepted, not arrived) and
 * what was paid to your wallet. Each is the sum of the shares its rows
 * show, net of the 2.5%, said once. Slow, held and incomplete tips are told
 * by their own rows. Withdraw appears only once the money layer can
 * withdraw; until then the first figure is called "Arrived".
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
  const available = ready ? earnings.available : null
  return (
    <section
      className="qt-pocket__earn"
      aria-labelledby="pocket-earnings"
      aria-busy={status === 'loading' || undefined}
    >
      {heading}
      {status === 'unavailable' ? (
        <Notice tone="failure">
          Your earnings cannot be shown right now. Nothing you earned is lost.
        </Notice>
      ) : null}
      <MoneyFigure
        value={available}
        status={status}
        size="xl"
        label={withdraw ? 'Ready to withdraw' : 'Arrived'}
        unavailableText="Not available right now"
      />
      <div className="qt-pocket__pair">
        <MoneyFigure
          value={ready ? earnings.pending : null}
          status={status}
          size="pending"
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
          size="pending"
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
          {...warmSheet(WITHDRAW_SHEET)}
          onClick={() => sheetStack.open(WITHDRAW_SHEET)}
        >
          {`Withdraw ${available.display}`}
        </Button>
      ) : ready && !withdraw ? (
        <p className="qt-pocket__plain">
          You can withdraw in a later update. Until then, what has arrived stays
          here.
        </p>
      ) : null}
      {[available, earnings.pending, earnings.collected].some(
        (figure) => ready && figure?.converted === true
      ) ? (
        // Only when the money layer marks a figure as converted at today's
        // price.
        <p className="qt-pocket__fine">
          Held in Lumens. Figures move with the price; each tip below shows its
          dollars at the time.
        </p>
      ) : null}
      <p className="qt-pocket__fine">
        These are your share. You keep 97.5% of every tip.
      </p>
    </section>
  )
}
