'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/system/components/Button'
import { focusDestination } from '@/system/inputModality'
import { warmSheet } from '@/shell/sheets/preload'
import type { ActivityList } from './activityModel'
import { PocketActivityRow } from './PocketActivityRow'
import { RECEIPT_SHEET } from './sheetIds'

/**
 * One labelled list ("Your tips", "Tips to you"), paged by the server.
 * "Show more" stays in place while the next page loads (busy, ignoring
 * presses), so focus never drops; when the server has no more, it gives way
 * to a line that says so, and focus moves there if it was on the button.
 */
export function PocketActivityList({
  list,
  level,
  now,
}: {
  list: ActivityList
  level: 3 | 4
  now: number
}) {
  const id = `pocket-activity-${list.role}`
  const view = list.view
  const loadingMore = view.loadingMore === true
  const [paged, setPaged] = useState(false)
  const button = useRef<HTMLButtonElement & HTMLAnchorElement>(null)
  const end = useRef<HTMLParagraphElement>(null)
  const hadFocus = useRef(false)
  const done = paged && !view.canLoadMore && !loadingMore
  useEffect(() => {
    if (done && hadFocus.current) {
      hadFocus.current = false
      focusDestination(end.current)
    }
  }, [done])
  const Title = level === 3 ? 'h3' : 'h4'
  return (
    <section className="qt-pocket__list" aria-labelledby={id}>
      <Title id={id} className="qt-pocket__list-title">
        {list.title}
      </Title>
      {view.status === 'unavailable' ? (
        <p className="qt-pocket__plain">These cannot be shown right now.</p>
      ) : (
        <ul
          className="qt-pocket__rows"
          data-role={list.role}
          aria-busy={loadingMore || undefined}
          {...warmSheet(RECEIPT_SHEET)}
        >
          {view.items.map((item) => (
            <li key={item.id} data-request={item.requestId ?? undefined}>
              <PocketActivityRow item={item} now={now} />
            </li>
          ))}
        </ul>
      )}
      {view.canLoadMore || loadingMore ? (
        <Button
          ref={button}
          variant="secondary"
          block
          loading={loadingMore}
          onClick={() => {
            if (loadingMore) return
            hadFocus.current = document.activeElement === button.current
            setPaged(true)
            view.loadMore()
          }}
          onBlur={() => {
            if (!loadingMore) hadFocus.current = false
          }}
        >
          Show more
        </Button>
      ) : done ? (
        <p className="qt-pocket__fine qt-pocket__end" ref={end} tabIndex={-1}>
          That is all of them.
        </p>
      ) : null}
    </section>
  )
}
