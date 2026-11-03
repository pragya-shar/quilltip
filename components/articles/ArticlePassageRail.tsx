'use client'

import { useEffect, useRef } from 'react'
import type { Id } from '@/types/convex'

interface ArticlePassageRailProps {
  passages: { _id: Id<'highlights'>; text: string }[]
  onActivate: (id: Id<'highlights'>) => void
}

export function ArticlePassageRail({
  passages,
  onActivate,
}: ArticlePassageRailProps) {
  const disclosure = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const desktop = matchMedia('(min-width: 851px)')
    const syncLayout = () => {
      if (disclosure.current) disclosure.current.open = desktop.matches
    }
    syncLayout()
    desktop.addEventListener('change', syncLayout)
    return () => desktop.removeEventListener('change', syncLayout)
  }, [])

  return (
    <details className="reader-passage-rail" ref={disclosure}>
      <summary>
        <span aria-hidden="true">❝</span>
        Your passages · {passages.length}
      </summary>
      {passages.length === 0 ? (
        <p>Select a line in the article to keep it here.</p>
      ) : (
        <ul>
          {passages.map((passage) => (
            <li key={passage._id}>
              <button type="button" onClick={() => onActivate(passage._id)}>
                {passage.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
