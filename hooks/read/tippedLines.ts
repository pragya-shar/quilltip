'use client'

import { createContext, useContext } from 'react'
import type { Id } from '@/convex/_generated/dataModel'

/**
 * The lines this reader has tipped on one article, so the view marks them
 * again on a later visit (a tip made on this page is marked at once, from
 * its press). The read is the money layer's: a bounded read of the
 * caller's own tips on one article with each passage's offsets, asked of
 * its owner. Until it exists the default source answers none, and the view
 * marks only this visit's tips. The fixture suite provides a source.
 */
export type TippedLine = {
  text: string
  startOffset: number
  endOffset: number
}

export type TippedLinesView = {
  status: 'loading' | 'ready' | 'unavailable'
  lines: TippedLine[]
}

export type TippedLinesSource = (articleId: Id<'articles'>) => TippedLinesView

const NONE: TippedLinesView = { status: 'unavailable', lines: [] }

export const TippedLinesSourceContext = createContext<TippedLinesSource>(
  () => NONE
)

/** The reader's tipped lines on this article, from the provided source. */
export function useTippedLines(articleId: Id<'articles'>): TippedLinesView {
  return useContext(TippedLinesSourceContext)(articleId)
}
