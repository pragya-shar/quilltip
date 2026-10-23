'use client'

import Link from 'next/link'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Heart,
  UserCircle,
  X,
} from './LandingIcons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { visibleTimer } from './visibleTimer'

export const sampleSentences = [
  'There are words we read, and words we carry.',
  'A sentence can feel like a hand on your shoulder, a window left open, a small permission to begin again.',
  'Sometimes, a stranger finds the words we could not find for ourselves.',
] as const
export type DemoReceipt = { words: string; amount: string | null }

export function LandingTippingDemo({
  ready = true,
  onReceipt,
}: {
  ready?: boolean
  onReceipt?: (receipt: DemoReceipt | null) => void
}) {
  const [selected, setSelected] = useState(0)
  const [receipt, setReceipt] = useState<DemoReceipt | null>(null)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(true)
  const [reduced, setReduced] = useState(true)
  const [tipOpen, setTipOpen] = useState(false)
  const [amount, setAmount] = useState('2')
  const paper = useRef<HTMLElement>(null)
  const sentenceRefs = useRef<(HTMLSpanElement | null)[]>([])
  const receiptRef = useRef<HTMLElement>(null)
  const tipTrigger = useRef<HTMLElement | null>(null)
  const receiptPending = useRef(false)

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    if (typeof IntersectionObserver !== 'function')
      return () => media.removeEventListener('change', update)
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { threshold: 0.35 }
    )
    if (paper.current) observer.observe(paper.current)
    return () => {
      media.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!ready || !visible || reduced || paused || receipt || tipOpen) return
    const words = (sampleSentences[selected] ?? sampleSentences[0]).split(
      /\s+/
    ).length
    return visibleTimer(
      () => setSelected((index) => (index + 1) % sampleSentences.length),
      700 + words * 35 + Math.max(4400, words * 300)
    )
  }, [ready, visible, reduced, paused, receipt, tipOpen, selected])

  useLayoutEffect(() => {
    if (receipt) receiptRef.current?.focus({ preventScroll: true })
  }, [receipt])

  function chooseSentence(index: number) {
    setSelected(index)
    setPaused(true)
    setReceipt(null)
    onReceipt?.(null)
  }
  function appreciate(tip: string | null = null) {
    const next = {
      words: sampleSentences[selected] ?? sampleSentences[0],
      amount: tip,
    }
    setReceipt(next)
    setPaused(true)
    onReceipt?.(next)
  }
  function openTip(event: React.MouseEvent<HTMLButtonElement>) {
    tipTrigger.current = event.currentTarget
    setTipOpen(true)
    receiptPending.current = false
  }

  return (
    <div className="sample-wallet-layout">
      <div className="product-area" id="try-it">
        <div className="paper-margin margin-left" aria-hidden>
          <span>
            A line worth <br />
            coming back to.
          </span>
          <svg viewBox="0 0 85 60">
            <path
              pathLength="100"
              d="M20 8 15 43Q34 39 69 42m-12-10 12 10-12 11"
            />
          </svg>
        </div>
        <div className="paper-margin margin-right" aria-hidden>
          <span>
            this stays <br />
            with me.
          </span>
          <svg viewBox="0 0 100 65">
            <path
              pathLength="100"
              d="M80 5Q87 48 12 49m0 0 14-10m-14 10 15 7"
            />
          </svg>
        </div>
        <article
          ref={paper}
          className="reading-paper"
          aria-label="Interactive sample by Maya Sen"
          data-held={paused}
          data-sweep-playing={
            ready && visible && pageVisible && !tipOpen && !paused
          }
        >
          {!receipt && (
            <button
              type="button"
              className="hero-card-target"
              aria-label={
                paused || reduced
                  ? 'Highlight the next sentence'
                  : 'Hold this highlighted passage'
              }
              aria-pressed={paused}
              onClick={() =>
                paused || reduced
                  ? chooseSentence((selected + 1) % 3)
                  : setPaused(true)
              }
            />
          )}
          <div className="sample-invitation">
            <p className="sample-label">Interactive sample</p>
            <button
              type="button"
              className="text-action"
              onClick={() => {
                chooseSentence((selected + 1) % 3)
                sentenceRefs.current[(selected + 1) % 3]?.focus({
                  preventScroll: true,
                })
              }}
            >
              Choose a sentence <ArrowRight size={14} aria-hidden />
            </button>
          </div>
          <div className="article-top">
            <span className="byline">
              <span className="author-avatar" aria-hidden>
                <UserCircle size={34} />
              </span>
              <span>
                Maya Sen
                <span className="author-note">Writer of this passage</span>
              </span>
            </span>
            <span className="article-kind">Notes on being human</span>
          </div>
          <h2>The words we carry</h2>
          <p
            className="passage"
            aria-label="Sample passage. Choose a sentence to keep its highlight."
          >
            {sampleSentences.map((sentence, index) => (
              <span key={sentence}>
                <span
                  role="button"
                  ref={(element) => {
                    sentenceRefs.current[index] = element
                  }}
                  tabIndex={0}
                  aria-pressed={index === selected}
                  className={
                    `sample-sentence sentence-${index}` +
                    (index === selected ? ' is-selected' : '')
                  }
                  onClick={() => chooseSentence(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      chooseSentence(index)
                    }
                  }}
                >
                  {index === selected ? (
                    <mark
                      key={selected}
                      className={
                        'animated-highlight' +
                        (paused || reduced ? ' highlight-settled' : '')
                      }
                    >
                      {sentence}
                    </mark>
                  ) : (
                    sentence
                  )}
                </span>{' '}
              </span>
            ))}
          </p>
          {receipt ? (
            <section
              className="writer-receipt"
              ref={receiptRef}
              tabIndex={-1}
              aria-labelledby="sample-receipt-title"
            >
              <blockquote className="arrival-quote">
                “{receipt.words}”
              </blockquote>
              <div className="receipt-top">
                <span>
                  <Heart size={17} fill="currentColor" aria-hidden />A note for
                  Maya
                </span>
                <span>
                  {receipt.amount
                    ? `${receipt.amount} test XLM`
                    : 'Appreciation preview'}
                </span>
              </div>
              <h3 id="sample-receipt-title">
                <Check size={18} aria-hidden />A note for Maya
              </h3>
              <p>
                For the highlighted words in <em>The words we carry</em> by Maya
                Sen.
              </p>
              <p className="demo-receipt-note">
                Demo receipt · nothing sent or saved
              </p>
              <div className="receipt-actions">
                <a className="text-action" href="#writer-tips">
                  See Maya’s receipt <ArrowRight size={16} aria-hidden />
                </a>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => {
                    const next = (selected + 1) % 3
                    chooseSentence(next)
                    sentenceRefs.current[next]?.focus({ preventScroll: true })
                  }}
                >
                  Read another line <ArrowRight size={16} aria-hidden />
                </button>
                <Link className="text-action" href="/articles">
                  Continue reading <ArrowRight size={16} aria-hidden />
                </Link>
              </div>
            </section>
          ) : (
            <div className="reader-tools">
              <div className="appreciation-actions">
                <button
                  className="button primary appreciate-button"
                  type="button"
                  onClick={() => appreciate()}
                >
                  <Heart size={19} aria-hidden />
                  Appreciate for free
                </button>
                <button className="text-action" type="button" onClick={openTip}>
                  Add a tip
                </button>
              </div>
              <div className="reading-controls">
                <Link className="text-action another-line" href="/articles">
                  Continue reading <ArrowRight size={16} aria-hidden />
                </Link>
              </div>
            </div>
          )}
        </article>
        <p className="moment-footnote">
          Interactive preview · no wallet connected · no transaction sent
        </p>
      </div>
      <aside
        className="wallet-invite"
        id="how-it-works"
        aria-labelledby="wallet-invite-title"
      >
        <div className="wallet-invite-art" aria-hidden>
          <span className="invite-receipt">
            <i />
            <i />
            <b>1</b>
          </span>
          <svg viewBox="0 0 72 58" fill="none">
            <path d="M12 17V11a5 5 0 0 1 5-5h39v11M12 17h45a5 5 0 0 1 5 5v27H17a5 5 0 0 1-5-5V17Z" />
            <path d="M62 28H47a6 6 0 0 0 0 12h15" />
            <circle cx="48" cy="34" r="1.5" />
          </svg>
        </div>
        <div className="wallet-invite-copy">
          <h2 id="wallet-invite-title">Curious how tipping works?</h2>
          <p>Try connecting and approving with free test funds.</p>
        </div>
        <Link
          className="text-action wallet-invite-cta"
          href="/wallet/practice?returnTo=%2F%23try-it"
        >
          Practice a transfer <ArrowUpRight size={18} aria-hidden />
        </Link>
        <small>
          1 test XLM · no monetary value · separate from article tipping
        </small>
      </aside>
      <Dialog open={tipOpen} onOpenChange={setTipOpen}>
        <DialogContent
          className="landing-blend blend-study type-study landing-tip-dialog"
          overlayClassName="landing-tip-overlay"
          hideCloseButton
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (receiptPending.current)
              receiptRef.current?.focus({ preventScroll: true })
            else tipTrigger.current?.focus({ preventScroll: true })
          }}
        >
          <DialogClose asChild>
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="Close tip dialog"
            >
              <X size={22} />
            </button>
          </DialogClose>
          <DialogTitle>Preview a little appreciation.</DialogTitle>
          <DialogDescription>
            A little support for the words that stayed with you.
          </DialogDescription>
          <blockquote>“{sampleSentences[selected]}”</blockquote>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              receiptPending.current = true
              setTipOpen(false)
              appreciate(amount)
            }}
          >
            <fieldset>
              <legend>
                Choose a demo amount · test XLM has no monetary value
              </legend>
              <div className="amounts">
                {['1', '2', '5'].map((value) => (
                  <label
                    key={value}
                    className={amount === value ? 'chosen' : ''}
                  >
                    <input
                      type="radio"
                      name="amount"
                      value={value}
                      checked={amount === value}
                      onChange={() => setAmount(value)}
                    />
                    {value} test XLM
                  </label>
                ))}
              </div>
              <button className="button primary send-tip" type="submit">
                Preview {amount} test XLM receipt{' '}
                <Heart size={18} aria-hidden />
              </button>
            </fieldset>
          </form>
          <p className="modal-disclaimer">
            Quick receipt preview · no wallet connects or payment is made.
          </p>
          <Link className="text-action" href="/guide">
            Read the wallet guide <ArrowRight size={16} aria-hidden />
          </Link>
        </DialogContent>
      </Dialog>
    </div>
  )
}
