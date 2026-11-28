import { figuresShown, type PaymentsState } from '@/lib/payments/store'

/** The draft the "Your draft" row opens. */
export type DraftSummary = {
  id: string
  title: string
  words: number
}

/** What `today.latestDraft` answers: undefined while it loads. */
export type LatestDraft =
  | { id: string; title: string; words: number }
  | null
  | undefined

/**
 * The "Your draft" row's draft: `undefined` while not known yet, `null`
 * when there is none to show. The draft is the person's own, so it shows
 * only while the payments store is bound to the session the token names
 * (`figuresShown`), as the balance does. Unbound, it is not known yet;
 * with the payments engine failed, it never binds, so there is no row.
 */
export function draftToShow(
  session: PaymentsState,
  latest: LatestDraft
): DraftSummary | null | undefined {
  if (!figuresShown(session))
    return session.engine === 'failed' ? null : undefined
  if (latest === undefined) return undefined
  return (
    latest && {
      id: latest.id,
      title: latest.title || 'Untitled draft',
      words: latest.words,
    }
  )
}
