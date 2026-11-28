'use client'

import type { Id } from '@/convex/_generated/dataModel'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/system/components/Button'
import { useBalanceReading } from '@/shell/balance'
import { useKeptLines } from '@/hooks/read/useKeptLines'
import { EmptyState } from '@/system/components/EmptyState'
import { showToast } from '@/system/toast'
import { usePassageActions } from '@/hooks/passages/usePassageActions'
import { articleIdOf } from '@/hooks/read/payments'
import { useTippedLines } from '@/hooks/read/tippedLines'
import { useArticleView } from '@/hooks/read/useArticleView'
import type { ChosenLine, LineEngineApi } from './LineEngine'
import type { PaintedSpan } from './paintPassages'
import { READ_BODY_ID, type ReadArticle } from './readModel'
import { TipBar, type SentTip } from './TipBar'

/**
 * The lines (choosing, marks, the tick, anchors, the place, resumed
 * intents): loaded after the page is interactive, never before the text.
 */
const LineEngine = dynamic(
  () => import('./LineEngine').then((module) => module.LineEngine),
  { ssr: false }
)

const body = () => document.getElementById(READ_BODY_ID)

/**
 * Everything on the article that needs a script, attached beside the
 * server text: the tip bar and the receipt, the kept lines, and a quiet
 * note if the article changed since the page was rendered. The lines
 * themselves (`LineEngine`) load after the page is interactive.
 */
export function ReaderIsland({ article }: { article: ReadArticle }) {
  // Lines tipped on this visit, marked from the press, and the reader's
  // earlier tips on this article, from the money layer's read.
  const [tippedHere, setTipped] = useState<PaintedSpan[]>([])
  const tippedBefore = useTippedLines(article.id)
  const signedIn = useBalanceReading().auth === 'signed-in'
  const keptOnServer = useKeptLines(article.id, signedIn)
  const [kept, setKept] = useState<(PaintedSpan & { id: Id<'highlights'> })[]>(
    []
  )
  // Kept lines come back from the server on every open; a Keep or a
  // removal here shows at once and is confirmed when the server answers.
  useEffect(() => {
    if (keptOnServer) setKept(keptOnServer)
  }, [keptOnServer])

  // The chosen line, as the engine reports it.
  const [passage, setPassage] = useState<ChosenLine | null>(null)
  const engine = useRef<LineEngineApi>(null)
  const clear = useCallback(() => engine.current?.clear(), [])
  // While a tip is held, queued or sending, no line can be chosen or let go.
  const [locked, setLocked] = useState(false)
  // Keep is a toggle: its pressed state confirms; only failures are said.
  const actions = usePassageActions({ quiet: true })

  // The text never waits for this: a note only if the article moved on.
  const status = useArticleView(article.writer.username, article.slug, {
    _id: article.id,
    ...article.version,
  })
  const said = useRef(false)
  useEffect(() => {
    if (said.current || status !== 'changed') return
    said.current = true
    showToast({
      title: 'This article was updated.',
      tone: 'info',
      action: { label: 'Reload', onAction: () => window.location.reload() },
    })
  }, [status])
  // Unpublished or deleted since the page was rendered: its text leaves the
  // page at once (a cached server copy can be up to a minute old).
  const gone = status === 'gone'
  useEffect(() => {
    if (!gone) return
    body()?.replaceChildren()
    for (const node of document.querySelectorAll<HTMLElement>(
      '.qt-read__article, .qt-read__next'
    ))
      node.hidden = true
  }, [gone])

  const [arrivalArmed, setArrivalArmed] = useState(false)
  const arrivalDone = useCallback(() => setArrivalArmed(false), [])
  const [resumeCeiling, setResumeCeiling] = useState<number | null>(null)

  const onSent = useCallback(
    (sent: SentTip) => {
      const span = sent.passage
      if (span) {
        setTipped((list) => [
          ...list,
          { startOffset: span.startOffset, endOffset: span.endOffset },
        ])
        requestAnimationFrame(() => engine.current?.keepInView(span))
      }
      clear()
    },
    [clear]
  )

  // Keep is a toggle on the chosen line (KeepButton). A kept line keeps
  // its highlight id, so letting it go removes that highlight.
  const [keepPending, setKeepPending] = useState(false)
  const keptHere = passage
    ? kept.find(
        (k) =>
          k.startOffset === passage.startOffset &&
          k.endOffset === passage.endOffset
      )
    : undefined
  const keepLine = useCallback(
    async (line: ChosenLine) => {
      const id = await actions.keep(article.id, line)
      if (id !== null)
        setKept((list) => [
          ...list,
          { startOffset: line.startOffset, endOffset: line.endOffset, id },
        ])
    },
    [actions, article.id]
  )
  const onKeepChange = useCallback(
    async (next: boolean) => {
      setKeepPending(true)
      try {
        if (next && passage) await keepLine(passage)
        else if (!next && keptHere) {
          if (await actions.remove(keptHere.id))
            setKept((list) => list.filter((k) => k !== keptHere))
        }
      } finally {
        setKeepPending(false)
      }
    },
    [actions, keepLine, keptHere, passage]
  )
  // A keep resumed after sign-in: kept for the line the engine chose again.
  const onResumedKeep = useCallback(
    (line: ChosenLine) => {
      setKeepPending(true)
      void keepLine(line).finally(() => setKeepPending(false))
    },
    [keepLine]
  )

  if (gone)
    return (
      <EmptyState
        title="This article is not here"
        body="It may have been unpublished or moved."
        action={
          <Button variant="primary" href="/">
            Go to Today
          </Button>
        }
      />
    )

  return (
    <>
      <LineEngine
        article={article}
        locked={locked}
        kept={kept}
        keptOnServer={keptOnServer}
        tippedHere={tippedHere}
        tippedBefore={tippedBefore.lines}
        onPassage={setPassage}
        onKeep={onResumedKeep}
        onResumeCeiling={setResumeCeiling}
        onArrival={setArrivalArmed}
        api={engine}
      />
      {/* An id that is not a document id gets no tip control. */}
      {articleIdOf(article.id) ? (
        <TipBar
          article={article}
          passage={passage}
          onClear={clear}
          kept={Boolean(keptHere)}
          keepPending={keepPending}
          onKeepChange={(next) => void onKeepChange(next)}
          onLockChange={setLocked}
          onSent={onSent}
          arrivalArmed={arrivalArmed}
          onArrivalDone={arrivalDone}
          resumeCeiling={resumeCeiling}
        />
      ) : null}
    </>
  )
}
