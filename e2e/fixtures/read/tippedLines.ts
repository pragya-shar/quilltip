// The read suite's source of the reader's earlier tipped lines: the tips
// the fixture server accepted for this run, read once on open, standing in
// for the money layer's read of the caller's own tips on one article.
import { useEffect, useState } from 'react'
import type {
  TippedLinesView,
  TippedLinesSource,
} from '../../../hooks/read/tippedLines'

const run = new URLSearchParams(location.search).get('run') ?? 'default'

type Accepted = {
  target: {
    kind: string
    articleId: string
    passage?: { text: string; startOffset: number; endOffset: number }
  }
}

export const useFixtureTippedLines: TippedLinesSource = (articleId) => {
  const [view, setView] = useState<TippedLinesView>({
    status: 'loading',
    lines: [],
  })
  useEffect(() => {
    let live = true
    fetch(`/api/tips?run=${run}`)
      .then((response) => response.json() as Promise<{ accepted: Accepted[] }>)
      .then(({ accepted }) => {
        if (!live) return
        const lines = accepted.flatMap(({ target }) =>
          target.kind === 'passage' &&
          target.articleId === articleId &&
          target.passage
            ? [
                {
                  text: target.passage.text,
                  startOffset: target.passage.startOffset,
                  endOffset: target.passage.endOffset,
                },
              ]
            : []
        )
        setView({ status: 'ready', lines })
      })
      .catch(() => live && setView({ status: 'unavailable', lines: [] }))
    return () => {
      live = false
    }
  }, [articleId])
  return view
}
