'use client'

import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { Heading } from '@/system/components/Heading'
import { Notice } from '@/system/components/Notice'
import { Skeleton } from '@/system/components/Skeleton'
import { TextLink } from '@/system/components/TextLink'
import type { PocketActivity } from './activityModel'
import { PocketActivityRow } from './PocketActivityRow'
import { useNow } from './useNow'

/**
 * Money activity only: tips sent and received (and, once the money layer
 * has them, money added and taken out), newest first, paged by the server.
 * A row opens its receipt as a sheet over the Pocket.
 */
export function ActivitySection({
  activity,
  headingLevel,
}: {
  activity: PocketActivity
  headingLevel: 2 | 3
}) {
  const now = useNow()
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
            <ul className="qt-pocket__rows">
              {activity.entries.map((entry) => (
                <li
                  key={entry.key}
                  data-request={entry.item.requestId ?? undefined}
                >
                  <PocketActivityRow item={entry.item} now={now} />
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
