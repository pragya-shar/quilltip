'use client'

import Link from 'next/link'
import { useContext, useEffect, useLayoutEffect, useState } from 'react'
import { Icon } from '@/system/components/Icon'
import { PendingIcon, WriteIcon } from '@/system/icons'
import { readPlaces } from './readingPlace'
import { currentPlace } from './resume'
import {
  RESERVE_ATTR,
  reservation,
  reserve,
  writeRowsMemory,
  type RowKind,
  type RowsMemory,
} from './rowsMemory'
import { TodayRowsSourceContext } from './rowsSource'

// useLayoutEffect warns during the server render; the effect only matters in
// the browser, before paint.
const useBeforePaint =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Which rows had space before the first paint (set by the inline script). */
function reservedOnPage(): RowsMemory {
  const root = document.documentElement
  return {
    place: root.hasAttribute(RESERVE_ATTR.place),
    draft: root.hasAttribute(RESERVE_ATTR.draft),
  }
}

/**
 * "Your place" and "Your draft", above the opening, for a person who is
 * signed in. They attach after the content and never move it: a row shows
 * only in space reserved before the first paint (by the inline script on a
 * full load, or here before paint after an in-app navigation). A row the
 * reservation did not foresee is remembered and shows from the next visit.
 * With no script, or signed out, nothing shows and nothing is reserved.
 */
export function ResumeRows() {
  const reading = useContext(TodayRowsSourceContext)()
  const [reserved, setReserved] = useState<RowsMemory | null>(null)

  useBeforePaint(() => {
    let wanted: RowsMemory = { place: false, draft: false }
    try {
      wanted = reservation(localStorage, currentPlace(readPlaces()) !== null)
    } catch {
      // Storage blocked: only what the inline script reserved.
    }
    const page = reservedOnPage()
    const next = {
      place: page.place || wanted.place,
      draft: page.draft || wanted.draft,
    }
    const root = document.documentElement
    for (const kind of ['place', 'draft'] as const)
      reserve(root, kind, next[kind])
    setReserved(next)
  }, [])

  // Your place belongs to this browser, signed in or not.
  const place = reading.places ? currentPlace(reading.places) : undefined
  const draft =
    reading.auth === 'signed-in'
      ? reading.draft
      : reading.auth === 'signed-out'
        ? null
        : undefined

  // Once both are known: remember them for the next visit, and give back the
  // space of a reserved row that has nothing to show.
  useEffect(() => {
    if (!reserved || place === undefined || draft === undefined) return
    const has: RowsMemory = { place: place !== null, draft: draft !== null }
    try {
      writeRowsMemory(localStorage, has)
    } catch {
      // Storage blocked.
    }
    const root = document.documentElement
    for (const kind of ['place', 'draft'] as RowKind[]) {
      if (reserved[kind] && !has[kind]) reserve(root, kind, false)
    }
  }, [reserved, place, draft])

  const showPlace = Boolean(reserved?.place && place)
  const showDraft = Boolean(reserved?.draft && draft)
  const any = showPlace || showDraft

  return (
    <div
      className="qt-today__resume"
      // A group, not a landmark: a place has one navigation, "Main".
      role={any ? 'group' : undefined}
      aria-label={any ? 'Pick up where you left off' : undefined}
    >
      <div className="qt-today__slot" data-slot="place">
        {showPlace && place ? (
          <Link
            href={place.href}
            className="qt-today__row"
            aria-label={`Your place: ${place.title}, ${Math.round(place.percent * 100)}% read`}
          >
            <Icon icon={PendingIcon} size={20} />
            <span className="qt-today__row-label">Your place</span>
            <span className="qt-today__row-title">{place.title}</span>
            <span className="qt-today__row-meta">
              {Math.round(place.percent * 100)}%
            </span>
          </Link>
        ) : null}
      </div>
      <div className="qt-today__slot" data-slot="draft">
        {showDraft && draft ? (
          <Link
            href={`/write?id=${encodeURIComponent(draft.id)}`}
            className="qt-today__row"
            aria-label={`Your draft: ${draft.title}, ${draft.words} ${draft.words === 1 ? 'word' : 'words'}`}
          >
            <Icon icon={WriteIcon} size={20} />
            <span className="qt-today__row-label">Your draft</span>
            <span className="qt-today__row-title">{draft.title}</span>
            <span className="qt-today__row-meta">
              {draft.words} {draft.words === 1 ? 'word' : 'words'}
            </span>
          </Link>
        ) : null}
      </div>
    </div>
  )
}
