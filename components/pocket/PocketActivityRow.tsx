'use client'

import { ActivityRow } from '@/system/components/ActivityRow'
import { Avatar } from '@/system/components/Avatar'
import { Icon } from '@/system/components/Icon'
import { TipIcon } from '@/system/icons'
import { rowWords, whenShort } from './copy'
import type { ActivityItem } from './types'

/** The link a row carries: the receipt, as a sheet with a script, and the
 * Pocket page without one. */
export function receiptHref(key: string): string {
  return `/pocket?receipt=${encodeURIComponent(key)}`
}

/**
 * One money movement. The amount is the tip as the reader sent it, on both
 * sides; the writer's share and the fee are on the receipt. A tip received
 * names no one (D4): it is from "A reader".
 */
export function PocketActivityRow({
  entryKey,
  item,
  now,
}: {
  entryKey: string
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
      href={receiptHref(entryKey)}
    />
  )
}
