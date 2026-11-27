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
 * One money movement; the whole row opens its receipt as a sheet. The
 * amount is the tip as the reader sent it, on both sides; the writer's
 * share and the fee are on the receipt. A tip received names no one (D4):
 * it is from "A reader".
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
      amount={item.amount}
      direction={reader ? 'out' : 'in'}
      status={words.status}
      statusText={words.short}
      time={whenShort(item.at, now)}
      onPress={() => sheetStack.open(RECEIPT_SHEET, { item })}
    />
  )
}
