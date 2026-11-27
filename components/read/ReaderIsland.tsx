'use client'

import type { Id } from '@/convex/_generated/dataModel'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { sheetStack } from '@/shell/sheetStack'
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
  textNodes,
} from '@/hooks/read/passageOffsets'
import { FINISHED_AT, markOpened, savePlace } from '@/hooks/read/readingPlace'
import { READING_LINE } from '@/hooks/read/readingPosition'
import { useArticleView } from '@/hooks/read/useArticleView'
import {
  usePassageSelection,
  type ChosenPassage,
} from '@/hooks/read/usePassageSelection'
import { useReadingPosition } from '@/hooks/read/useReadingPosition'
import { paintPassages, type PaintedSpan } from './paintPassages'
import { RECEIPT_SHEET, type ReceiptProps } from './receipt'
import { preloadSheet } from '@/shell/sheets/loadSheet'
import { READ_BODY_ID, READ_MARGIN_ID, type ReadArticle } from './readModel'
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
  const [tipped, setTipped] = useState<PaintedSpan[]>([])
  const [kept, setKept] = useState<(PaintedSpan & { id: Id<'highlights'> })[]>(
    []
  )
  const [tick, setTick] = useState<Tick | null>(null)
  const [margin, setMargin] = useState<HTMLElement | null>(null)

  const onChoose = useCallback((chosen: ChosenPassage) => {
    // A tap leaves the page where it is; a line under the dock comes up.
    requestAnimationFrame(() => keepInView(chosen))
  }, [])
  const { passage, clear, keep } = usePassageSelection(body, { onChoose })
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
      const { start, text } = blockText(root, block)
      const span = sentenceSpans(text)[anchor.sentence]
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
    return () => window.removeEventListener('hashchange', goToSentence)
  }, [])

  // The margin layer is server HTML beside the body.
  useEffect(() => setMargin(document.getElementById(READ_MARGIN_ID)), [])

  // Paint the chosen and tipped lines; place the chosen line's tick.
  useEffect(() => {
    const root = body()
    if (!root) return
    const cleanup = paintPassages(root, { chosen: passage, kept, tipped })
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
  }, [passage, kept, tipped])

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
      savePlace({
        articleId: article.id,
        href: article.href,
        title: article.title,
        sentence: root
          ? sentenceAtLine(root, window.innerHeight * READING_LINE)
          : '',
        percent: position.ratio,
        updatedAt: Date.now(),
        finished: position.ratio >= FINISHED_AT,
      })
    },
    [article.href, article.id, article.title]
  )
  useReadingPosition(article.id, { body, onRestored, onSave })

  // The text never waits for this: a note only if the article moved on.
  const status = useArticleView(article.writer.username, article.slug, {
    _id: article.id,
    ...article.version,
  })
  const said = useRef(false)
  useEffect(() => {
    if (said.current || (status !== 'changed' && status !== 'gone')) return
    said.current = true
    showToast(
      status === 'changed'
        ? {
            title: 'This article was updated.',
            tone: 'info',
            action: {
              label: 'Reload',
              onAction: () => window.location.reload(),
            },
          }
        : { title: 'This article is no longer published.', tone: 'info' }
    )
  }, [status])

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
      const receipt: ReceiptProps = {
        amount: sent.amount,
        writerName: article.writer.name,
        articleTitle: article.title,
        line: span?.text ?? null,
      }
      clear()
      // The receipt's code loads now, so it is there by the press.
      void preloadSheet(RECEIPT_SHEET)?.catch(() => {})
      showToast({
        title: `You tipped ${article.writer.firstName}`,
        tone: 'done',
        action: {
          label: 'Receipt',
          onAction: () => sheetStack.open(RECEIPT_SHEET, receipt),
        },
      })
    },
    [article.title, article.writer.firstName, article.writer.name, clear]
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
      <TipBar
        article={article}
        passage={passage}
        onClear={clear}
        kept={Boolean(keptHere)}
        keepPending={keepPending}
        onKeepChange={(next) => void onKeepChange(next)}
        onSent={onSent}
      />
    </>
  )
}
