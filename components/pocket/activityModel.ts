import type { ActivityItem, ActivityView } from './types'

/** One row of the Pocket's activity, keyed across both lists. */
export type ActivityEntry = { key: string; item: ActivityItem }

export type PocketActivity = {
  /** partial: one list answered and the other cannot. */
  status: 'loading' | 'ready' | 'partial' | 'unavailable'
  entries: ActivityEntry[]
  canLoadMore: boolean
  loadingMore: boolean
  loadMore(): void
}

export function entryKey(item: ActivityItem): string {
  return `${item.role}:${item.id}`
}

/** The oldest time a list has shown so far; null when it showed nothing. */
function oldest(view: ActivityView): number | null {
  let at: number | null = null
  for (const item of view.items) if (at === null || item.at < at) at = item.at
  return at
}

/**
 * The tips a person sent and the tips they received, as one list, newest
 * first. Each list is paged by the server on its own, so a row is shown only
 * when no unread page of the other list could hold a newer one: below the
 * oldest row loaded from a list that has more, rows wait for "Show more".
 * Nothing is summed here; each row is the money layer's.
 */
export function mergeActivity(
  reader: ActivityView,
  writer: ActivityView
): PocketActivity {
  const views = [reader, writer]
  const loadMore = () => {
    for (const view of views) if (view.canLoadMore) view.loadMore()
  }
  const loadingMore = views.some((view) => view.loadingMore === true)
  if (views.some((view) => view.status === 'loading'))
    return {
      status: 'loading',
      entries: [],
      canLoadMore: false,
      loadingMore: false,
      loadMore,
    }
  const answered = views.filter((view) => view.status === 'ready')
  if (answered.length === 0)
    return {
      status: 'unavailable',
      entries: [],
      canLoadMore: false,
      loadingMore: false,
      loadMore,
    }
  let horizon = -Infinity
  for (const view of answered) {
    if (!view.canLoadMore) continue
    const at = oldest(view)
    if (at !== null && at > horizon) horizon = at
  }
  const seen = new Set<string>()
  const entries: ActivityEntry[] = []
  for (const view of answered)
    for (const item of view.items) {
      const key = entryKey(item)
      if (seen.has(key) || item.at < horizon) continue
      seen.add(key)
      entries.push({ key, item })
    }
  entries.sort((a, b) => b.item.at - a.item.at || a.key.localeCompare(b.key))
  return {
    status: answered.length === views.length ? 'ready' : 'partial',
    entries,
    canLoadMore: answered.some((view) => view.canLoadMore),
    loadingMore,
    loadMore,
  }
}
