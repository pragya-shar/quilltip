'use client'

import { createContext, useEffect, useState } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
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

/** The live source: Convex auth, the latest-draft query, the browser's places. */
export function useLiveTodayRows(): TodayRowsReading {
  const { isAuthenticated, isLoading } = useConvexAuth()
  // One indexed read of the caller's own newest draft: id, title, words.
  const latest = useQuery(api.today.latestDraft, isAuthenticated ? {} : 'skip')
  const places = useStoredPlaces()
  return {
    auth: isLoading ? 'loading' : isAuthenticated ? 'signed-in' : 'signed-out',
    places,
    draft:
      latest === undefined
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
