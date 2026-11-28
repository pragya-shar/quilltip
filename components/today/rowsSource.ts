'use client'

import { createContext, useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { figuresShown, paymentsStore } from '@/lib/payments/store'
import { readPlaces, type ReadingPlace } from './readingPlace'

/** The draft the "Your draft" row opens. */
export type DraftSummary = {
  id: string
  title: string
  words: number
}

/**
 * What the two rows read. `undefined` means not known yet; `null` means
 * known and absent.
 */
export type TodayRowsReading = {
  auth: 'loading' | 'signed-out' | 'signed-in'
  /** Every stored place (Your place, and the finished skip list). */
  places: ReadingPlace[] | undefined
  draft: DraftSummary | null | undefined
}

/** The browser's stored places, read after mount and on changes from other tabs. */
function useStoredPlaces(): ReadingPlace[] | undefined {
  const [places, setPlaces] = useState<ReadingPlace[] | undefined>(undefined)
  useEffect(() => {
    const read = () => {
      try {
        setPlaces(readPlaces())
      } catch {
        setPlaces([])
      }
    }
    read()
    window.addEventListener('storage', read)
    return () => window.removeEventListener('storage', read)
  }, [])
  return places
}

/**
 * The live source. Who is signed in comes from the payments store, the
 * shell's one reading of it (`PaymentsShell` keeps it in step with auth).
 * The draft is the person's own, so it shows only while the store is bound
 * to the session the token names (`figuresShown`), as the balance does:
 * until then it is not known yet, and with the engine failed there is none.
 */
export function useLiveTodayRows(): TodayRowsReading {
  const session = useSyncExternalStore(
    paymentsStore.subscribe,
    paymentsStore.get,
    paymentsStore.get
  )
  const auth = session.auth
  // One indexed read of the caller's own newest draft: id, title, words.
  const latest = useQuery(
    api.today.latestDraft,
    auth === 'signed-in' ? {} : 'skip'
  )
  const places = useStoredPlaces()
  const bound = figuresShown(session)
  return {
    auth,
    places,
    draft: !bound
      ? session.engine === 'failed'
        ? null
        : undefined
      : latest === undefined
        ? undefined
        : latest && {
            id: latest.id,
            title: latest.title || 'Untitled draft',
            words: latest.words,
          },
  }
}

/** Fixtures pass a fake source; the page uses the live one. */
export const TodayRowsSourceContext =
  createContext<() => TodayRowsReading>(useLiveTodayRows)
