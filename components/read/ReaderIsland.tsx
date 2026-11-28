'use client'

import type { Id } from '@/convex/_generated/dataModel'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/system/components/Button'
import { useBalanceReading } from '@/shell/balance'
import { sheetStack } from '@/shell/sheetStack'
import { useKeptLines } from '@/hooks/read/useKeptLines'
import { EmptyState } from '@/system/components/EmptyState'
import { showToast } from '@/system/toast'
import { usePassageActions } from '@/hooks/passages/usePassageActions'
import { parseReadAnchor, readAnchor } from '@/lib/tiptap/readAnchors'
import { sentenceSpans } from '@/hooks/read/sentences'
import {
  blockText,
  lineBlockOf,
  passagePlacement,
  rangeAt,
  sentenceAtLine,
  textBetween,
  textNodes,
} from '@/hooks/read/passageOffsets'
import { articleIdOf } from '@/hooks/read/payments'
import { useTippedLines } from '@/hooks/read/tippedLines'
import {
  FINISHED_AT,
  markOpened,
  readPlaces,
  savePlace,
} from '@/hooks/read/readingPlace'
import { READING_LINE } from '@/hooks/read/readingPosition'
import { useArticleView } from '@/hooks/read/useArticleView'
import {
  usePassageSelection,
  type ChosenPassage,
} from '@/hooks/read/usePassageSelection'
import { useReadingPosition } from '@/hooks/read/useReadingPosition'
import { paintPassages, type PaintedSpan } from './paintPassages'
import { READ_BODY_ID, READ_MARGIN_ID, type ReadArticle } from './readModel'
import { takeLiveArrival } from './liveArrival'
import { TipBar, type SentTip } from './TipBar'

type Tick = { top: number; height: number; kind: 'chosen' | 'place' }

/** Space the toast and the dock take at the bottom, and the header at top. */
const BOTTOM_RESERVE_PX = 200
const TOP_RESERVE_PX = 72

const body = () => document.getElementById(READ_BODY_ID)

/** Keeps a line in view above the dock and any confirmation: a tip never hides its line. */
function keepInView(span: PaintedSpan) {
  const root = body()
  if (!root) return
  const rect = rangeAt(
    root,
    span.startOffset,
    span.endOffset
  ).getBoundingClientRect()
  if (!rect.height) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const limit = window.innerHeight - BOTTOM_RESERVE_PX
  const delta =
    rect.bottom > limit
      ? rect.bottom - limit
      : rect.top < TOP_RESERVE_PX
        ? rect.top - TOP_RESERVE_PX
        : 0
  if (delta)
    window.scrollBy({ top: delta, behavior: reduce ? 'instant' : 'smooth' })
}

/** The block at the reading line, for the place tick. */
function blockAtReadingLine(root: HTMLElement): HTMLElement | null {
  const line = window.innerHeight * READING_LINE
  for (const node of textNodes(root)) {
    const block = lineBlockOf(root, node)
    if (!block) continue
    const rect = block.getBoundingClientRect()
    if (rect.bottom >= line) return block
  }
  return null
}

/**
 * Everything on the article that needs a script, attached beside the
 * server text: choosing a line, its mark and margin tick, the reader's
 * place, the tip bar and the receipt, and a quiet note if the article
 * changed since the page was rendered.
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
  const [tick, setTick] = useState<Tick | null>(null)
  const [margin, setMargin] = useState<HTMLElement | null>(null)

  const onChoose = useCallback((chosen: ChosenPassage) => {
    // A tap leaves the page where it is; a line under the dock comes up.
    requestAnimationFrame(() => keepInView(chosen))
  }, [])
  // While a tip is held, queued or sending, no line can be chosen or let go.
  const [locked, setLocked] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const { passage, cursor, clear, keep } = usePassageSelection(body, {
    onChoose,
    enabled: !locked,
  })
  // Keep is a toggle: its pressed state confirms; only failures are said.
  const actions = usePassageActions({ quiet: true })

  // Today's opening skips what this browser opened (`qt_opened`).
  useEffect(() => markOpened(article.id), [article.id])

  // `#s-{p}-{k}`: the browser lands on paragraph p by itself (its id is in
  // the server HTML, so this works with no script); here a later sentence
  // k is brought into view too, and p again if the text arrived after the
  // browser looked. Nothing is chosen.
  useEffect(() => {
    const goToSentence = () => {
      const anchor = parseReadAnchor(location.hash)
      const root = body()
      if (!anchor || !root) return
      const block = document.getElementById(readAnchor(anchor.paragraph))
      if (!block || !root.contains(block)) return
      if (anchor.sentence === 0) {
        block.scrollIntoView({ block: 'start', behavior: 'instant' })
        return
      }
      const { start, text, gaps } = blockText(root, block)
      const span = sentenceSpans(text, gaps)[anchor.sentence]
      if (!span) return
      const rect = rangeAt(
        root,
        start + span.start,
        start + span.end
      ).getBoundingClientRect()
      window.scrollBy({ top: rect.top - TOP_RESERVE_PX, behavior: 'instant' })
    }
    goToSentence()
    window.addEventListener('hashchange', goToSentence)
    // The fonts can reflow the text after the browser looked: land again
    // once they are in, unless the reader has moved by then.
    let moved = false
    const onMove = () => {
      moved = true
    }
    const MOVES = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    for (const type of MOVES)
      window.addEventListener(type, onMove, { once: true, passive: true })
    let live = true
    void document.fonts?.ready.then(() => {
      if (live && !moved) goToSentence()
    })
    return () => {
      live = false
      window.removeEventListener('hashchange', goToSentence)
      for (const type of MOVES) window.removeEventListener(type, onMove)
    }
  }, [])

  // The margin layer is server HTML beside the body.
  useEffect(() => setMargin(document.getElementById(READ_MARGIN_ID)), [])

  // Earlier tips are marked only where the text still reads as tipped.
  const tipped = useMemo(() => {
    // On the server, and before an answer, there is nothing to check.
    const root = tippedBefore.lines.length ? body() : null
    const before = root
      ? tippedBefore.lines.filter(
          (line) =>
            textBetween(root, line.startOffset, line.endOffset) === line.text
        )
      : []
    const all = [...before, ...tippedHere]
    return all.filter(
      (span, index) =>
        all.findIndex(
          (other) =>
            other.startOffset === span.startOffset &&
            other.endOffset === span.endOffset
        ) === index
    )
  }, [tippedBefore.lines, tippedHere])

  // Paint the chosen and tipped lines; place the chosen line's tick.
  useEffect(() => {
    const root = body()
    if (!root) return
    const cleanup = paintPassages(root, {
      chosen: passage,
      kept,
      tipped,
      cursor,
    })
    const place = () => {
      const frame = document.getElementById(READ_MARGIN_ID)
      if (!passage || !frame) return
      const at = passagePlacement(
        rangeAt(root, passage.startOffset, passage.endOffset),
        frame
      )
      setTick(at ? { ...at, kind: 'chosen' } : null)
    }
    if (passage) place()
    else setTick((current) => (current?.kind === 'chosen' ? null : current))
    const resize = new ResizeObserver(place)
    resize.observe(root)
    return () => {
      resize.disconnect()
      cleanup()
    }
  }, [passage, kept, tipped, cursor, selecting])

  // A native selection that settles leaves the marks to the highlights;
  // once it collapses, the marks are drawn again in the text.
  useEffect(() => {
    const onChange = () => {
      const selection = window.getSelection()
      const root = body()
      setSelecting(
        Boolean(
          selection &&
          !selection.isCollapsed &&
          root?.contains(selection.anchorNode)
        )
      )
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])

  // The keyboard cursor stays in view, and is read once by its words.
  useEffect(() => {
    if (cursor) keepInView(cursor)
  }, [cursor])

  // Escape lets the chosen line go, from anywhere on the page, unless a
  // sheet or menu is open (it closes first).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !passage) return
      if (sheetStack.get().some((entry) => entry.open)) return
      if ((event.target as Element | null)?.closest('dialog, [role="menu"]'))
        return
      clear()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [passage, clear])

  // Back at the reader's place: a quiet tick beside that paragraph, and
  // nothing chosen.
  const onRestored = useCallback(() => {
    const root = body()
    const frame = document.getElementById(READ_MARGIN_ID)
    if (!root || !frame) return
    const block = blockAtReadingLine(root)
    if (!block) return
    const rect = block.getBoundingClientRect()
    const origin = frame.getBoundingClientRect()
    setTick((current) =>
      current?.kind === 'chosen'
        ? current
        : { top: rect.top - origin.top, height: rect.height, kind: 'place' }
    )
  }, [])
  // Today's "Your place" reads this: the sentence, the share read, and
  // whether the reader reached the end.
  const onSave = useCallback(
    (position: { ratio: number }) => {
      const root = body()
      const line = root
        ? sentenceAtLine(root, window.innerHeight * READING_LINE)
        : null
      savePlace({
        articleId: article.id,
        href: article.href,
        title: article.title,
        sentence: line?.text ?? '',
        ...(line ? { at: line.startOffset } : {}),
        percent: position.ratio,
        updatedAt: Date.now(),
        finished: position.ratio >= FINISHED_AT,
      })
    },
    [article.href, article.id, article.title]
  )
  // Back to the saved sentence, not a share of the scroll: the same line
  // whatever the width, the font or the images above it.
  const savedSentence = useCallback(() => {
    const root = body()
    const at = readPlaces().find((p) => p.articleId === article.id)?.at
    if (!root || at === undefined) return null
    const range = rangeAt(root, at, at + 1)
    return root.contains(range.startContainer) ? range : null
  }, [article.id])
  useReadingPosition(article.id, {
    body,
    onRestored,
    onSave,
    sentence: savedSentence,
  })

  // `?highlight=<id>` (a kept line, from the Shelf): land on that line,
  // with a quiet tick and nothing chosen.
  const aimed = useRef(false)
  useEffect(() => {
    if (aimed.current || !keptOnServer) return
    const id = new URLSearchParams(location.search).get('highlight')
    const line = id ? keptOnServer.find((k) => k.id === id) : undefined
    if (!line) return
    aimed.current = true
    const root = body()
    const frame = document.getElementById(READ_MARGIN_ID)
    if (!root || !frame) return
    const range = rangeAt(root, line.startOffset, line.endOffset)
    const rect = range.getBoundingClientRect()
    window.scrollBy({
      top: rect.top - window.innerHeight * READING_LINE,
      behavior: 'instant',
    })
    const at = passagePlacement(range, frame)
    if (at) setTick({ ...at, kind: 'place' })
  }, [keptOnServer])

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
  // `?live=1` and the publish token are read once and cleared, for every
  // visitor; the arrival runs only for the author (see liveArrival.ts).
  const [arrivalArmed, setArrivalArmed] = useState(false)
  useEffect(() => {
    setArrivalArmed(takeLiveArrival(article.id))
  }, [article.id])
  const arrivalDone = useCallback(() => setArrivalArmed(false), [])

  const gone = status === 'gone'
  useEffect(() => {
    if (!gone) return
    body()?.replaceChildren()
    for (const node of document.querySelectorAll<HTMLElement>(
      '.qt-read__article, .qt-read__next'
    ))
      node.hidden = true
  }, [gone])

  const onSent = useCallback(
    (sent: SentTip) => {
      const span = sent.passage
      if (span) {
        setTipped((list) => [
          ...list,
          { startOffset: span.startOffset, endOffset: span.endOffset },
        ])
        requestAnimationFrame(() => keepInView(span))
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
  const onKeepChange = useCallback(
    async (next: boolean) => {
      setKeepPending(true)
      try {
        if (next) {
          await keep(
            async (chosen) => {
              const id = await actions.keep(article.id, chosen)
              if (id !== null)
                setKept((list) => [
                  ...list,
                  {
                    startOffset: chosen.startOffset,
                    endOffset: chosen.endOffset,
                    id,
                  },
                ])
              return id
            },
            { clearAfter: false }
          )
        } else if (keptHere) {
          if (await actions.remove(keptHere.id))
            setKept((list) => list.filter((k) => k !== keptHere))
        }
      } finally {
        setKeepPending(false)
      }
    },
    [actions, article.id, keep, keptHere]
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
      {margin && tick
        ? createPortal(
            <span
              key={`${tick.kind}:${tick.top}`}
              className="qt-read__tick"
              data-kind={tick.kind}
              style={{ top: tick.top, height: tick.height }}
            />,
            margin
          )
        : null}
      <p className="qt-visually-hidden" aria-live="polite">
        {cursor ? cursor.text : ''}
      </p>
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
        />
      ) : null}
    </>
  )
}
