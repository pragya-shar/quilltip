/**
 * Balance fixture page: `/?screen=tip|balance|earnings&seed=<scenario>&run=<id>`.
 * It mounts the real payments provider, hooks and screens over a stand-in
 * backend (`backend.ts`), stand-in Convex hooks (`convex-react.ts`) and a
 * stand-in signer (`signer.ts`). `run` makes a fresh backend; the same `run`
 * after a reload keeps it, as a server would.
 */
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PaymentsShell } from '../../../components/payments/PaymentsShell'
import { BalanceScreenLive } from '../../../components/payments/BalanceScreenLive'
import { EarningsScreenLive } from '../../../components/payments/EarningsScreenLive'
import { PassageTip } from '../../../components/payments/PassageTip'
import { useTip } from '../../../hooks/payments/useTip'
import type { Id } from '../../../convex/_generated/dataModel'
import type { PassageRef } from '../../../lib/payments/types'
import * as backend from './backend'
import { AppBoundary } from './AppBoundary'
import { MiniApp } from './MiniApp'
import { SCENARIOS, controls } from './scenarios'

const params = new URLSearchParams(location.search)
const screen = params.get('screen') ?? 'tip'
const seed = params.get('seed') ?? 'reader-ready'
const run = params.get('run') ?? 'default'
if (params.get('theme') === 'dark')
  document.documentElement.setAttribute('data-theme', 'dark')

if (backend.current().seed !== `${seed}:${run}`) {
  backend.reset(`${seed}:${run}`, SCENARIOS[seed] ?? (() => {}))
  // A new backend starts with an empty outbox, as a new device would.
  localStorage.removeItem('quilltip-balance-outbox')
}
;(window as unknown as { __fixture: typeof controls }).__fixture = controls

const PARAGRAPHS = [
  'Some drafts need a night away from you before they tell you what they are. You leave the page, you sleep, and in the morning the sentence you loved is plainly wrong.',
  'Leave it overnight. The work does not go anywhere, and the part of you that edits is a different person after breakfast.',
  'Read it aloud once. Your ear catches what your eye forgives, and every place you stumble is a place a reader will stumble too.',
  'Then cut the paragraph you are proudest of, and see if anyone misses it.',
]

const ARTICLE_ID = 'article-1' as Id<'articles'>
const META = {
  articleTitle: 'Leave It Overnight',
  writerName: 'Ada Lovelace',
  href: null,
}

function PassageTipLive({
  passage,
  onClose,
}: {
  passage: PassageRef
  onClose(): void
}) {
  const target = useMemo(
    () => ({ kind: 'passage' as const, articleId: ARTICLE_ID, passage }),
    [passage]
  )
  const tip = useTip(target, META)
  if (!tip.ready && !tip.warming) return null
  if (tip.unavailable && tip.unavailable !== 'not-loaded')
    return (
      <p
        data-testid="tip-unavailable"
        data-amount={tip.signedOut?.amount.display ?? ''}
        data-amounts={(tip.signedOut?.amounts ?? [])
          .map((a) => a.display)
          .join(' ')}
        style={{ position: 'fixed', bottom: 0 }}
      >
        Unavailable: {tip.unavailable}
      </p>
    )
  return <PassageTip tip={tip} writerName="Ada Lovelace" onClose={onClose} />
}

function Article() {
  const [passage, setPassage] = useState<PassageRef | null>(null)
  useEffect(() => {
    const pick = () => {
      const selection = window.getSelection()
      const article = document.querySelector('[data-testid="article-body"]')
      if (!selection || selection.isCollapsed || !article) return
      if (!article.contains(selection.anchorNode)) return
      const text = selection.toString().trim()
      if (!text) return
      const start = Math.max(0, (article.textContent ?? '').indexOf(text))
      setPassage((prev) =>
        prev && prev.text === text && prev.startOffset === start
          ? prev
          : { text, startOffset: start, endOffset: start + text.length }
      )
    }
    document.addEventListener('pointerup', pick)
    document.addEventListener('keyup', pick)
    return () => {
      document.removeEventListener('pointerup', pick)
      document.removeEventListener('keyup', pick)
    }
  }, [])
  return (
    <main
      style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 240px' }}
    >
      <h1
        style={{ fontFamily: 'Georgia, serif', fontSize: 34, lineHeight: 1.1 }}
      >
        Leave It Overnight
      </h1>
      <p style={{ color: '#666' }}>Ada Lovelace</p>
      <div
        data-testid="article-body"
        style={{ fontFamily: 'Georgia, serif', fontSize: 19, lineHeight: 1.6 }}
      >
        {PARAGRAPHS.map((p) => (
          <p key={p.slice(0, 12)} style={{ margin: '0 0 1em' }}>
            {p}
          </p>
        ))}
      </div>
      {passage ? (
        <PassageTipLive
          key={`${passage.startOffset}:${passage.endOffset}`}
          passage={passage}
          onClose={() => {
            window.getSelection()?.removeAllRanges()
            setPassage(null)
          }}
        />
      ) : null}
    </main>
  )
}

function Fixture() {
  if (screen === 'app')
    return (
      <AppBoundary>
        <MiniApp article={<Article />} />
        <PaymentsShell />
      </AppBoundary>
    )
  return (
    <>
      {screen === 'balance' ? (
        <main style={{ padding: '16px' }}>
          <BalanceScreenLive />
        </main>
      ) : screen === 'earnings' ? (
        <main style={{ padding: '16px' }}>
          <EarningsScreenLive />
        </main>
      ) : (
        <Article />
      )}
      <PaymentsShell />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>
)
