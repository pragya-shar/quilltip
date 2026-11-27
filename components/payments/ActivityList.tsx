'use client'

import type { ActivityView } from '@/lib/payments/types'
import { ActivityRow } from './ActivityRow'

/** A paged list of tips (view only). */
export function ActivityList({
  activity,
  now,
  title,
  empty,
}: {
  activity: ActivityView
  now: number
  title: string
  empty: string
}) {
  const headingId = `qt-list-${title.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="qt-section-title">
        {title}
      </h2>
      {activity.status === 'loading' ? (
        <div aria-busy="true" aria-label="Loading tips">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="qt-skeleton"
              style={{ height: 64, margin: '0.5rem 0' }}
            />
          ))}
        </div>
      ) : activity.items.length === 0 ? (
        <p className="qt-empty">{empty}</p>
      ) : (
        <ul className="qt-list">
          {activity.items.map((item) => (
            <ActivityRow key={item.id} item={item} now={now} />
          ))}
        </ul>
      )}
      {activity.canLoadMore ? (
        <button type="button" className="qt-more" onClick={activity.loadMore}>
          Show earlier tips
        </button>
      ) : null}
    </section>
  )
}
