'use client'

import { ActivityRow } from '@/system/components/ActivityRow'
import { Avatar } from '@/system/components/Avatar'
import { Icon } from '@/system/components/Icon'
import { TipIcon } from '@/system/icons'
import { sheetStack } from '@/shell/sheetStack'
import { rowWords, whenShort } from './copy'
import { RECEIPT_SHEET } from './sheetIds'
import type { ActivityItem } from './types'

/**
 * One money movement; the whole row opens its receipt as a sheet. A tip you
 * sent shows the tip as sent ("−$1.00"); a tip to you shows your share and
 * the tip it came from ("+$0.0975", "from a $0.10 tip"), so the rows add up
 * to the figures above them (design N2). A tip received names no one (D4).
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
      name={reader ? item.counterparty.name : 'A reader'}
      about={item.passage ?? item.article.title}
      amount={reader ? item.amount : item.net}
      direction={reader ? 'out' : 'in'}
      status={words.status}
      statusText={words.short}
      time={
        reader
          ? whenShort(item.at, now)
          : `from a ${item.amount.display} tip · ${whenShort(item.at, now)}`
      }
      onPress={() => sheetStack.open(RECEIPT_SHEET, { item })}
    />
  )
}
