'use client'

import { ActivityRow } from '@/system/components/ActivityRow'
import { Avatar } from '@/system/components/Avatar'
import { Icon } from '@/system/components/Icon'
import { TipIcon } from '@/system/icons'
import { figureState, spokenDollars } from '@/system/money/figure'
import { sheetStack } from '@/shell/sheetStack'
import { rowWords, whenShort } from './copy'
import { rowAmount } from './rowAmount'
import { RECEIPT_SHEET } from './sheetIds'
import type { ActivityItem } from '@/lib/pocket/types'

/**
 * One money movement; the whole row opens its receipt as a sheet. A tip you
 * sent shows the tip as sent ("−$1.00"); a tip to you shows your share and
 * the tip it came from ("+$0.0975", "from a $0.10 tip"). A tip paid only in
 * part shows what was paid, so the rows agree with the figures above them.
 * A tip received never names the reader.
 */
export function PocketActivityRow({
  item,
  now,
}: {
  item: ActivityItem
  now: number
}) {
  const words = rowWords(item)
  const reader = item.role === 'reader'
  const name = reader ? item.counterparty.name : 'A reader'
  const amount = rowAmount(item)
  // The row's control is named by the person, the amount as a screen reader
  // says it, and what it opens: "A reader, plus 9.75 cents, open receipt".
  // The money layer's spoken text first, the system's helper otherwise. A
  // tip that did not complete carries no direction, as on screen.
  const sign = words.status === 'failed' ? '' : reader ? '−' : '+'
  const direction = sign === '−' ? 'minus ' : sign === '+' ? 'plus ' : ''
  const state = figureState(amount)
  const said = amount.spoken
    ? `${direction}${amount.spoken}`
    : state.kind === 'value'
      ? spokenDollars({ ...state.parts, sign })
      : null
  const label = [name, said, 'open receipt'].filter(Boolean).join(', ')
  return (
    <ActivityRow
      lead={
        reader ? (
          <Avatar name={item.counterparty.name} size={42} decorative />
        ) : (
          <span className="qt-pocket__glyph">
            <Icon icon={TipIcon} size={20} />
          </span>
        )
      }
      name={name}
      label={label}
      about={item.passage ?? item.article.title}
      amount={amount}
      direction={reader ? 'out' : 'in'}
      status={words.status}
      statusText={words.short}
      detail={reader ? undefined : `from a ${item.amount.display} tip`}
      time={whenShort(item.at, now)}
      onPress={() => sheetStack.open(RECEIPT_SHEET, { item })}
    />
  )
}
