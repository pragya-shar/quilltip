'use client'

import { useEffect, useRef, type MouseEvent } from 'react'
import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { Heading } from '@/system/components/Heading'
import { Notice } from '@/system/components/Notice'
import { Skeleton } from '@/system/components/Skeleton'
import { TextLink } from '@/system/components/TextLink'
import { sheetStack } from '@/shell/sheetStack'
import type { PocketActivity } from './activityModel'
import { PocketActivityRow } from './PocketActivityRow'
import { RECEIPT_SHEET } from './sheetIds'
import { useNow } from './useNow'

/**
 * Money activity only: tips sent and received (and, once the money layer
 * has them, money added and taken out), newest first, paged by the server.
 * A row opens its receipt as a sheet over the Pocket.
 */
export function ActivitySection({
  activity,
  headingLevel,
  initialReceipt,
}: {
  activity: PocketActivity
  headingLevel: 2 | 3
  initialReceipt?: string
}) {
  const now = useNow()
  const opened = useRef(false)
  const linked = initialReceipt
    ? activity.entries.find((entry) => entry.key === initialReceipt)
    : undefined
  useEffect(() => {
    if (!linked || opened.current) return
    opened.current = true
    sheetStack.open(RECEIPT_SHEET, { item: linked.item })
  }, [linked])
  // A row's name is a real link to its receipt; with a script the receipt
  // opens as a sheet instead, over whatever the person is doing.
  const onClick = (event: MouseEvent<HTMLUListElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      'a.qt-activity__link'
    )
    if (!link) return
    const key = new URL(link.href, location.href).searchParams.get('receipt')
    const entry = activity.entries.find((candidate) => candidate.key === key)
    if (!entry) return
    event.preventDefault()
    sheetStack.open(RECEIPT_SHEET, { item: entry.item })
  }
  return (
    <section className="qt-pocket__activity" aria-labelledby="pocket-activity">
      <Heading level={headingLevel} variant="section" id="pocket-activity">
        Activity
      </Heading>
      {activity.status === 'loading' ? (
        <div
          className="qt-pocket__rows"
          aria-busy="true"
          aria-label="Loading your activity"
          role="group"
        >
          {[0, 1, 2].map((n) => (
            <div key={n} className="qt-pocket__row-skeleton">
              <Skeleton shape="circle" width="2.625rem" height="2.625rem" />
              <span className="qt-pocket__row-skeleton-lines">
                <Skeleton width="55%" />
                <Skeleton width="80%" />
              </span>
              <Skeleton width="3.5rem" />
            </div>
          ))}
        </div>
      ) : activity.status === 'unavailable' ? (
        <p className="qt-pocket__plain">
          Your activity cannot be shown right now. Nothing you sent is lost.
        </p>
      ) : (
        <>
          {activity.status === 'partial' ? (
            <Notice tone="info">
              Some of your activity cannot be shown right now.
            </Notice>
          ) : null}
          {activity.entries.length === 0 ? (
            <EmptyState
              title="Your tips show up here."
              body="Tips you send and tips you receive, each with its receipt."
              action={
                <TextLink href="/" variant="standalone">
                  Find something to read
                </TextLink>
              }
            />
          ) : (
            // The list only routes a click on a row's link to its sheet.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
            <ul className="qt-pocket__rows" onClick={onClick}>
              {activity.entries.map((entry) => (
                <li
                  key={entry.key}
                  data-request={entry.item.requestId ?? undefined}
                >
                  <PocketActivityRow
                    entryKey={entry.key}
                    item={entry.item}
                    now={now}
                  />
                </li>
              ))}
            </ul>
          )}
          {activity.canLoadMore ? (
            <Button
              variant="secondary"
              block
              loading={activity.loadingMore}
              onClick={activity.loadMore}
            >
              Show more
            </Button>
          ) : null}
        </>
      )}
    </section>
  )
}
