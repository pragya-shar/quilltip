'use client'

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { sheetStack } from '@/shell/sheetStack'
import { parseReadAnchor, readAnchor } from '@/lib/tiptap/readAnchors'
import { sentenceSpans } from '@/hooks/read/sentences'
import {
  anchorAt,
  blockText,
  lineBlockOf,
  passagePlacement,
  rangeAt,
  sentenceAtLine,
  textBetween,
  textNodes,
} from '@/hooks/read/passageOffsets'
import {
  FINISHED_AT,
  markOpened,
  readPlaces,
  savePlace,
} from '@/hooks/read/readingPlace'
import { READING_LINE } from '@/hooks/read/readingPosition'
import type { TippedLine } from '@/hooks/read/tippedLines'
import {
  usePassageSelection,
  type ChosenPassage,
} from '@/hooks/read/usePassageSelection'
import { useReadingPosition } from '@/hooks/read/useReadingPosition'
import { useResumedIntent } from '@/hooks/read/useResumedIntent'
import { takeLiveArrival } from './liveArrival'
import { paintPassages, type PaintedSpan } from './paintPassages'
import { READ_BODY_ID, READ_MARGIN_ID, type ReadArticle } from './readModel'
import type { IntentPassage } from './signInIntent'

type Tick = { top: number; height: number; kind: 'chosen' | 'place' }

/** The chosen line as the tip bar holds it: with its anchor, when it has one. */
export type ChosenLine = ChosenPassage & { anchor: string | null }

/** What the island asks of the engine. */
export type LineEngineApi = {
  clear(): void
  keepInView(span: PaintedSpan): void
}

/** Space the toast and the dock take at the bottom, and the header at top. */
const BOTTOM_RESERVE_PX = 200
const TOP_RESERVE_PX = 72

const body = () => document.getElementById(READ_BODY_ID)

/**
 * Where an anchored block lands: its scroll margin plus the page's scroll
 * padding, the offset the browser itself uses for `#s-{p}-0` with no
 * script, so every landing is the same in every engine.
 */
function anchorTop(block: Element): number {
  const margin = parseFloat(getComputedStyle(block).scrollMarginTop) || 0
  const padding =
    parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
  return margin + padding
}

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
 * The reading view's lines, loaded after the page is interactive (it is a
 * lazy boundary: nothing here is needed before a first interaction, and
 * the server text never waits for it): choosing a line by tap, selection
 * or keyboard, its mark and margin tick, landing on `#s-{p}-{k}` and
 * `?highlight=`, the reader's place, the intents resumed after sign-in and
 * the arrival after a first publish. It renders only the tick and a live
 * region; the island owns the tip bar and the kept lines.
 */
export function LineEngine({
  article,
  locked,
  kept,
  keptOnServer,
  tippedHere,
  tippedBefore,
  onPassage,
  onKeep,
  onResumeCeiling,
  onArrival,
  api,
}: {
  article: ReadArticle
  /** A tip holds the chosen line: it can be neither changed nor let go. */
  locked: boolean
  kept: PaintedSpan[]
  /** Kept lines from the server, for `?highlight=`. */
  keptOnServer: (PaintedSpan & { id: string })[] | undefined
  tippedHere: PaintedSpan[]
  tippedBefore: TippedLine[]
  onPassage: (line: ChosenLine | null) => void
  /** A keep resumed after sign-in, for its line. */
  onKeep: (line: ChosenLine) => void
  onResumeCeiling: (cents: number) => void
  onArrival: (armed: boolean) => void
  api: Ref<LineEngineApi>
}) {
  const [tick, setTick] = useState<Tick | null>(null)
  const [margin, setMargin] = useState<HTMLElement | null>(null)
  const [selecting, setSelecting] = useState(false)

  const onChoose = useCallback((chosen: ChosenPassage) => {
    // A tap leaves the page where it is; a line under the dock comes up.
    requestAnimationFrame(() => keepInView(chosen))
  }, [])
  const { passage, cursor, clear, choose } = usePassageSelection(body, {
    onChoose,
    enabled: !locked,
  })
  useImperativeHandle(api, () => ({ clear, keepInView }), [clear])

  // The island holds the chosen line for the tip bar, with its anchor.
  const lineOf = useCallback((chosen: ChosenPassage): ChosenLine => {
    const root = body()
    return {
      ...chosen,
      anchor: root ? anchorAt(root, chosen.startOffset) : null,
    }
  }, [])
  useEffect(() => {
    onPassage(passage ? lineOf(passage) : null)
  }, [passage, onPassage, lineOf])

  // Today's opening skips what this browser opened (`qt_opened`).
  useEffect(() => markOpened(article.id), [article.id])

  // `?live=1` and the publish token are read once and cleared, for every
  // visitor; the arrival runs only for the author (see liveArrival.ts).
  useEffect(() => {
    onArrival(takeLiveArrival(article.id))
  }, [article.id, onArrival])

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
      // The paragraph's top, or its sentence's, lands at one offset.
      let top = block.getBoundingClientRect().top
      if (anchor.sentence > 0) {
        const { start, text, gaps } = blockText(root, block)
        const span = sentenceSpans(text, gaps)[anchor.sentence]
        if (!span) return
        top = rangeAt(
          root,
          start + span.start,
          start + span.end
        ).getBoundingClientRect().top
      }
      window.scrollBy({ top: top - anchorTop(block), behavior: 'instant' })
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
    const root = tippedBefore.length ? body() : null
    const before = root
      ? tippedBefore.filter(
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
  }, [tippedBefore, tippedHere])

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
  // sheet or menu is open (it closes first), or a tip holds the line (the
  // press captured it; the mark and the receipt use it).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !passage) return
      if (locked) return
      if (sheetStack.get().some((entry) => entry.open)) return
      if ((event.target as Element | null)?.closest('dialog, [role="menu"]'))
        return
      clear()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [passage, clear, locked])

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

  // After sign-in, on this page, once (the sign-in contract's resume): the
  // line the reader had chosen is chosen again, only where the text still
  // reads the same. A tip's amount is set within its ceiling (the tip bar);
  // nothing is sent. A keep is kept, since keeping is not money.
  const resumedTip = useResumedIntent('tip')
  const resumedKeep = useResumedIntent('keep')
  const chooseLine = useCallback(
    (line: IntentPassage): ChosenPassage | null => {
      const root = body()
      if (!root) return null
      if (textBetween(root, line.startOffset, line.endOffset) !== line.text)
        return null
      const chosen: ChosenPassage = {
        text: line.text,
        startOffset: line.startOffset,
        endOffset: line.endOffset,
        startContainerPath: `text.${line.startOffset}`,
        endContainerPath: `text.${line.endOffset}`,
        via: 'intent',
      }
      choose(chosen)
      requestAnimationFrame(() => keepInView(chosen))
      return chosen
    },
    [choose]
  )
  useEffect(() => {
    if (!resumedTip || resumedTip.articleId !== article.id) return
    if (resumedTip.passage) chooseLine(resumedTip.passage)
    onResumeCeiling(resumedTip.amount.cents)
  }, [resumedTip, article.id, chooseLine, onResumeCeiling])
  useEffect(() => {
    if (!resumedKeep || resumedKeep.articleId !== article.id) return
    const chosen = chooseLine(resumedKeep.passage)
    if (chosen) onKeep(lineOf(chosen))
    // Once per resumed intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumedKeep, article.id, chooseLine])

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
    </>
  )
}
