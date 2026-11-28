'use client'

import { createContext, useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { paymentsStore } from '@/lib/payments/store'
import { draftToShow, type DraftSummary } from './draftRow'
import { readPlaces, type ReadingPlace } from './readingPlace'

export type { DraftSummary }

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
 * The draft shows only while the store is bound to the session the token
 * names (`draftToShow`).
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
  return { auth, places, draft: draftToShow(session, latest) }
}

/** Fixtures pass a fake source; the page uses the live one. */
export const TodayRowsSourceContext =
  createContext<() => TodayRowsReading>(useLiveTodayRows)
