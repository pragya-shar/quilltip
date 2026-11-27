'use client'

import { Button } from '@/system/components/Button'
import { Heading } from '@/system/components/Heading'
import { Skeleton } from '@/system/components/Skeleton'
import type { PocketActivity } from './activityModel'
import { PocketActivityRow } from './PocketActivityRow'
import { useNow } from './useNow'

/**
 * Money activity only: tips sent and tips received, newest first, paged by
 * the server. Each row opens its receipt as a sheet over the Pocket. Money
 * added, taken out and collected join here when the money layer has them.
 */
export function ActivitySection({
  activity,
  headingLevel,
}: {
  activity: PocketActivity
  headingLevel: 2 | 3
}) {
  const now = useNow()
  const listLevel = (headingLevel + 1) as 3 | 4
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
      ) : activity.status === 'empty' ? (
        <p className="qt-pocket__plain">Your tips show up here.</p>
      ) : (
        activity.lists.map((list) => {
          const id = `pocket-activity-${list.role}`
          return (
            <section
              key={list.role}
              className="qt-pocket__list"
              aria-labelledby={id}
            >
              {listLevel === 3 ? (
                <h3 id={id} className="qt-pocket__list-title">
                  {list.title}
                </h3>
              ) : (
                <h4 id={id} className="qt-pocket__list-title">
                  {list.title}
                </h4>
              )}
              {list.view.status === 'unavailable' ? (
                <p className="qt-pocket__plain">
                  These cannot be shown right now.
                </p>
              ) : (
                <ul className="qt-pocket__rows" data-role={list.role}>
                  {list.view.items.map((item) => (
                    <li
                      key={item.id}
                      data-request={item.requestId ?? undefined}
                    >
                      <PocketActivityRow item={item} now={now} />
                    </li>
                  ))}
                </ul>
              )}
              {list.view.canLoadMore ? (
                <Button
                  variant="secondary"
                  block
                  loading={list.view.loadingMore === true}
                  onClick={list.view.loadMore}
                >
                  Show more
                </Button>
              ) : null}
            </section>
          )
        })
      )}
    </section>
  )
}
