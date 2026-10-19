'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Check, Heart } from './LandingIcons'
import { sampleSentences, type DemoReceipt } from './LandingTippingDemo'

export function LandingWriterReceipts({
  receipt,
}: {
  receipt: DemoReceipt | null
}) {
  const section = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(true)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { threshold: 0.15 }
    )
    if (section.current) observer.observe(section.current)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  const receipts = [
    {
      reader: receipt ? 'You' : 'A reader',
      amount: receipt ? receipt.amount : '2',
      quote: receipt ? receipt.words : sampleSentences[0],
    },
    { reader: 'Another reader', amount: '5', quote: sampleSentences[1] },
    { reader: 'A fellow reader', amount: '1', quote: sampleSentences[2] },
  ]
  return (
    <section
      className="writer-tips"
      id="writer-tips"
      ref={section}
      aria-labelledby="writer-tips-title"
    >
      <span id="features" className="landing-anchor" aria-hidden />
      <div className="tips-intro">
        <p className="tips-eyebrow">On the other side of a highlight</p>
        <h2 id="writer-tips-title" tabIndex={-1}>
          A few words.
          <br />A little love, returned.
        </h2>
        <p>
          A passage stays with a reader. Their support finds its way back to
          you.
        </p>
        <Link className="text-action" href="/write">
          Write something of your own ↗
        </Link>
      </div>
      <div className="tip-flow" data-playing={visible && pageVisible}>
        <div className="receipt-stream" data-paused={paused}>
          {receipts.map((item, index) => (
            <div
              key={index}
              className={`receipt-note note-${index}${index === 0 && receipt ? ' personal-arrival' : ''}`}
            >
              <div
                className={`floating-receipt receipt-${index}`}
                data-held={paused}
              >
                <button
                  type="button"
                  className="receipt-card-target"
                  aria-label={`${paused ? 'Resume' : 'Hold'} receipt motion. ${item.reader}, ${item.amount ? `${item.amount} test XLM, demo tip with no monetary value` : 'demo appreciation'}, for ${item.quote}`}
                  aria-pressed={paused}
                  onClick={() => setPaused((value) => !value)}
                />
                <div className="tip-receipt-heading">
                  <span>
                    <Heart size={15} fill="currentColor" aria-hidden />{' '}
                    {item.reader}
                  </span>
                  <strong>
                    {item.amount ? (
                      <>
                        <span>+{item.amount}</span>
                        <small className="receipt-amount-label">
                          test XLM · demo
                        </small>
                      </>
                    ) : (
                      'A little love'
                    )}
                  </strong>
                </div>
                <p>“{item.quote}”</p>
                <div className="tip-receipt-footer">
                  <span>To Maya Sen</span>
                  <span>
                    <Check size={12} aria-hidden />{' '}
                    {item.amount
                      ? 'Demo receipt'
                      : 'Demo appreciation received'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="receipt-playback-controls">
        <span className="receipt-demo-label">
          Demo receipts · no real payments
        </span>
      </div>
    </section>
  )
}
