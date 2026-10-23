import Link from 'next/link'
import { ArrowRight, Plus } from './LandingIcons'
import { LandingWriterReceipts } from './LandingWriterReceipts'
import type { DemoReceipt } from './LandingTippingDemo'

export default function LandingBelowFold({
  receipt = null,
}: {
  receipt?: DemoReceipt | null
}) {
  return (
    <>
      <LandingWriterReceipts receipt={receipt} />
      <section
        className="landing-notes"
        id="questions"
        aria-labelledby="landing-notes-title"
      >
        <span id="faq" className="landing-anchor" aria-hidden />
        <div className="landing-notes-intro">
          <h2 id="landing-notes-title">A few questions.</h2>
          <p>The practical bits, before you begin.</p>
        </div>
        <div className="landing-questions">
          <details>
            <summary>
              Do I need an account or a wallet to read?
              <Plus size={18} aria-hidden />
            </summary>
            <p>
              You can browse published articles without signing in or connecting
              a wallet. <Link href="/articles">Browse articles</Link>.
            </p>
          </details>
          <details>
            <summary>
              Can I tip a passage or the whole article?
              <Plus size={18} aria-hidden />
            </summary>
            <p>
              Both. Highlight a passage to attach your tip to its exact words,
              or choose the whole article. Tips currently use free test XLM with
              no monetary value.{' '}
              <Link href="/guide">Read the wallet guide</Link>.
            </p>
          </details>
          <details>
            <summary>
              What do I need to start writing?
              <Plus size={18} aria-hidden />
            </summary>
            <p>
              Create an account or sign in to write, save drafts and publish. A
              Stellar wallet is needed to receive tips.{' '}
              <Link className="text-action" href="/write">
                Start writing <ArrowRight size={16} aria-hidden />
              </Link>
            </p>
          </details>
        </div>
      </section>
    </>
  )
}
