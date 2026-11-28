import type { ActivityView } from '@/lib/pocket/types'

/** One labelled list of the Pocket's activity, paged by the server. */
export type ActivityList = {
  role: 'reader' | 'writer'
  title: string
  /** `ready` with rows, or `unavailable` while the other list answered. */
  view: ActivityView
}

export type PocketActivity =
  | { status: 'loading' | 'unavailable' | 'empty'; lists: [] }
  | { status: 'ready'; lists: ActivityList[] }

const TITLES = { reader: 'Your tips', writer: 'Tips to you' }

/**
 * The tips a person sent and the tips they received, as two labelled lists,
 * each newest first and paged by the server on its own. They are never
 * merged on the client: a merge across two paged lists can show a row ahead
 * of an older page that is not loaded yet. One server-ordered list replaces
 * this when the money layer has it.
 */
export function activityLists(
  reader: ActivityView,
  writer: ActivityView
): PocketActivity {
  const both = [reader, writer]
  if (both.some((view) => view.status === 'loading'))
    return { status: 'loading', lists: [] }
  if (both.every((view) => view.status === 'unavailable'))
    return { status: 'unavailable', lists: [] }
  const order: ActivityList['role'][] = ['reader', 'writer']
  const lists: ActivityList[] = []
  for (const role of order) {
    const view = role === 'reader' ? reader : writer
    if (view.status === 'unavailable' || view.items.length > 0)
      lists.push({ role, title: TITLES[role], view })
  }
  if (lists.length === 0) return { status: 'empty', lists: [] }
  return { status: 'ready', lists }
}
