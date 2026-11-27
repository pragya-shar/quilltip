'use client'

import { Heading } from '@/system/components/Heading'
import { Skeleton } from '@/system/components/Skeleton'
import type { PocketActivity } from './activityModel'
import { PocketActivityList } from './PocketActivityList'
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
        activity.lists.map((list) => (
          <PocketActivityList
            key={list.role}
            list={list}
            level={listLevel}
            now={now}
          />
        ))
      )}
    </section>
  )
}
