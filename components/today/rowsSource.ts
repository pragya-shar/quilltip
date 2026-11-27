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

type Node = { type?: unknown; text?: unknown; content?: unknown }

function countWords(node: unknown): number {
  if (!node || typeof node !== 'object') return 0
  const record = node as Node
  if (record.type === 'text' && typeof record.text === 'string')
    return record.text.split(/\s+/u).filter(Boolean).length
  return Array.isArray(record.content)
    ? record.content.reduce((sum: number, child) => sum + countWords(child), 0)
    : 0
}

type Draft = {
  _id: string
  title: string
  content?: unknown
  updatedAt: number
}

/** The draft touched last, as the row shows it. */
export function latestDraft(drafts: readonly Draft[]): DraftSummary | null {
  const latest = drafts.reduce<Draft | null>(
    (best, draft) => (!best || draft.updatedAt > best.updatedAt ? draft : best),
    null
  )
  if (!latest) return null
  const title = latest.title.trim()
  return {
    id: latest._id,
    title:
      title && title.toLowerCase() !== 'untitled' ? title : 'Untitled draft',
    words: countWords(latest.content),
  }
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

/** The live source: Convex auth, the drafts query, the browser's places. */
export function useLiveTodayRows(): TodayRowsReading {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const drafts = useQuery(
    api.articles.getUserDrafts,
    isAuthenticated ? {} : 'skip'
  )
  const places = useStoredPlaces()
  return {
    auth: isLoading ? 'loading' : isAuthenticated ? 'signed-in' : 'signed-out',
    places,
    draft: drafts === undefined ? undefined : latestDraft(drafts),
  }
}

/** Fixtures pass a fake source; the page uses the live one. */
export const TodayRowsSourceContext =
  createContext<() => TodayRowsReading>(useLiveTodayRows)
