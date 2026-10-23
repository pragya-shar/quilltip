'use client'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Check, Wallet, ShieldCheck } from './WalletIcons'
import { selectedWords, sentences } from './reading-model'

const WalletPractice = lazy(() => import('./WalletPractice'))
type Scenario =
  | 'normal'
  | 'missing'
  | 'declined'
  | 'network'
  | 'funds'
  | 'failed'
export function WalletPreview({
  onModeChange,
}: {
  onModeChange: (sample: boolean) => void
}) {
  const [practice, setPractice] = useState(
    new URLSearchParams(location.search).get('wallet') !== 'sample'
  )
  const [practiceOpened, setPracticeOpened] = useState(
    new URLSearchParams(location.search).get('wallet') !== 'sample'
  )
  useEffect(() => onModeChange(!practice), [practice, onModeChange])
  const [quote, setQuote] = useState<string | null>(null)
  const noteRef = useRef<HTMLElement>(null)
  const [sheet, setSheet] = useState(false)
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [issue, setIssue] = useState<Exclude<Scenario, 'normal'> | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!sheet || !matchMedia('(max-width:760px)').matches) return
    const node = noteRef.current
    if (!node) return
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow
    node.setAttribute('role', 'dialog')
    node.setAttribute('aria-modal', 'true')
    document.body.style.overflow = 'hidden'
    node
      .querySelector<HTMLElement>('.wallet-sheet-close')
      ?.focus({ preventScroll: true })
    function trap(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSheet(false)
        return
      }
      if (e.key !== 'Tab') return
      const items = [
        ...node!.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],summary,select'
        ),
      ].filter((x) => x.getClientRects().length)
      const first = items[0],
        last = items.at(-1)
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          !node!.contains(document.activeElement))
      ) {
        e.preventDefault()
        last?.focus()
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          !node!.contains(document.activeElement))
      ) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      node.removeAttribute('role')
      node.removeAttribute('aria-modal')
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [sheet])
  const recovery = {
    missing: [
      'Freighter isn’t available.',
      'In the app, install and unlock Freighter in this browser. You can continue here with a demo wallet.',
      'Use demo wallet',
    ],
    declined: [
      'Connection declined.',
      'Nothing was sent. Your passage and amount are still here.',
      'Try connecting again',
    ],
    network: [
      'Switch to Stellar testnet.',
      'This demo uses test XLM. In Freighter, check the network before approving.',
      'Use demo testnet',
    ],
    funds: [
      'Not enough test XLM.',
      'In the app, add free testnet funds. No purchase is needed for this demo.',
      'Add demo test funds',
    ],
    failed: [
      'The demo tip didn’t go through.',
      'No payment was made. Review your unchanged tip and try again.',
      'Review again',
    ],
  }
  function connect() {
    if (['missing', 'declined', 'network'].includes(scenario)) {
      setIssue(scenario as Exclude<Scenario, 'normal'>)
      return
    }
    setConnected(true)
    setReview(true)
  }
  function approve() {
    if (['funds', 'failed'].includes(scenario)) {
      setIssue(scenario as Exclude<Scenario, 'normal'>)
      return
    }
    setPending(true)
  }
  function recover() {
    setScenario('normal')
    setIssue(null)
    setConnected(true)
    setReview(true)
  }

  const [tipping, setTipping] = useState(false)
  const [appreciated, setAppreciated] = useState(false)
  const [target, setTarget] = useState('passage')
  const [amount, setAmount] = useState(2)
  const [connected, setConnected] = useState(false)
  const [review, setReview] = useState(false)
  const [receipt, setReceipt] = useState<{
    amount: number
    target: string
    quote: string | null
  } | null>(null)
  const ready = target === 'article' || Boolean(quote)
  function changeTarget(value: string) {
    setIssue(null)
    setPending(false)
    setTarget(value)
    setReview(false)
    setReceipt(null)
    setAppreciated(false)
    setTipping(false)
    setSheet(value === 'article')
  }
  function choose(value: string) {
    setIssue(null)
    setPending(false)
    setQuote(value)
    setReview(false)
    setReceipt(null)
    setAppreciated(false)
    setTipping(false)
    setSheet(true)
  }
  return (
    <section
      className={`wallet-preview wallet-desk ${practice ? 'is-practice' : ''} ${sheet ? 'wallet-sheet-open' : ''}`}
      id="wallet-preview"
      aria-labelledby="wallet-preview-title"
    >
      <h2 id="wallet-preview-title" className="wallet-mode-heading">
        {practice
          ? 'Real wallet practice · Stellar testnet'
          : 'Sample tipping · no wallet needed'}
      </h2>
      <div className="wallet-mode-switch">
        <button
          className="text-action"
          onClick={() => {
            const next = !practice
            onModeChange?.(!next)
            setPracticeOpened(true)
            setPractice(next)
            setSheet(false)
            const url = new URL(location.href)
            url.searchParams.set('wallet', next ? 'practice' : 'sample')
            history.replaceState(null, '', url)
          }}
        >
          {practice
            ? 'Explore sample tipping instead ↗'
            : 'Try a real wallet transfer ↗'}
        </button>
      </div>
      {practiceOpened && (
        <div hidden={!practice}>
          <Suspense fallback={<p role="status">Opening wallet practice…</p>}>
            <WalletPractice />
          </Suspense>
        </div>
      )}
      {!practice && (
        <div className="wallet-desk-surface">
          <article className="wallet-story">
            <div className="wallet-desk-label">
              QUILLTIP <span>Sample article</span>
            </div>
            <h3>The words we carry</h3>
            <p className="wallet-byline">By Maya Sen</p>
            <div
              className="wallet-targets"
              role="group"
              aria-label="What to tip"
            >
              <button
                aria-pressed={target === 'passage'}
                onClick={() => changeTarget('passage')}
              >
                A passage
              </button>
              <button
                aria-pressed={target === 'article'}
                onClick={() => changeTarget('article')}
              >
                Whole article
              </button>
            </div>
            <p className="wallet-invitation">
              {target === 'passage'
                ? 'Tap the words you’d like to appreciate.'
                : 'A little support for the whole story.'}
            </p>
            <div className="wallet-story-lines">
              {sentences.map((_, i) => (
                <button
                  key={i}
                  disabled={target === 'article'}
                  aria-pressed={
                    target === 'passage' && quote === selectedWords(i)
                  }
                  onClick={() => choose(selectedWords(i))}
                >
                  {selectedWords(i)}
                </button>
              ))}
            </div>
            <div className="wallet-story-footer">
              Reading needs no wallet. Highlighting doesn’t require a tip.
              {ready && (
                <button
                  className="text-action wallet-reopen"
                  onClick={() => setSheet(true)}
                >
                  View your {target === 'article' ? 'article' : 'highlight'}
                </button>
              )}
              {quote && (
                <a className="wallet-continue" href={'/articles'}>
                  Continue reading
                </a>
              )}
            </div>
          </article>
          {sheet && (
            <button
              className="wallet-sheet-backdrop"
              aria-label="Return to the story"
              onClick={() => setSheet(false)}
            />
          )}
          <aside
            ref={noteRef}
            className="wallet-note"
            aria-label="Your passage and optional tip"
          >
            <button
              className="wallet-sheet-close"
              onClick={() => setSheet(false)}
            >
              Back to story ×
            </button>
            <div className="wallet-desk-label">
              <Wallet size={22} /> Your wallet <span>Demo · testnet</span>
            </div>
            <div className="wallet-connection-row">
              <span
                className={connected ? 'wallet-dot connected' : 'wallet-dot'}
              />
              <span>
                {connected ? 'Demo wallet connected' : 'No wallet connected'}
              </span>
              {connected && <Check size={18} />}
            </div>
            <div className="wallet-tip-context">
              {ready ? (
                <>
                  <small>
                    {target === 'article'
                      ? 'Whole article'
                      : 'Selected passage'}
                  </small>
                  <blockquote>
                    {target === 'article' ? 'The words we carry' : quote}
                  </blockquote>
                </>
              ) : (
                <p>Choose a line from the story to begin.</p>
              )}
            </div>
            {ready && !receipt && (
              <div className="wallet-kept">
                <p role="status">
                  {target === 'passage'
                    ? 'Highlight kept for this visit.'
                    : 'The whole article is selected.'}
                </p>
                <button
                  className="button primary"
                  disabled={appreciated}
                  onClick={() => setAppreciated(true)}
                >
                  {appreciated
                    ? 'Appreciation sent · demo'
                    : 'Send appreciation'}{' '}
                  <Check size={18} />
                </button>
                <button
                  className="text-action wallet-tip-toggle"
                  aria-expanded={tipping}
                  onClick={() => {
                    setTipping(!tipping)
                    setReview(false)
                    setIssue(null)
                    setPending(false)
                  }}
                >
                  {tipping ? 'Close tip options' : 'Add a tip, if you like'}
                </button>
              </div>
            )}
            {tipping && !receipt && (
              <>
                <fieldset
                  className="wallet-amounts"
                  disabled={!ready || review || pending}
                >
                  <legend>A little appreciation · test XLM</legend>
                  {[1, 2, 5].map((value) => (
                    <button
                      key={value}
                      aria-pressed={amount === value}
                      onClick={() => setAmount(value)}
                    >
                      {value}
                    </button>
                  ))}
                </fieldset>
                {issue ? (
                  <div className="wallet-recovery" role="alert">
                    <h4>{recovery[issue][0]}</h4>
                    <p>{recovery[issue][1]}</p>
                    <button className="button primary" onClick={recover}>
                      {recovery[issue][2]}
                    </button>
                    <button
                      className="text-action"
                      onClick={() => {
                        setIssue(null)
                        setReview(false)
                        setTipping(false)
                        setSheet(false)
                      }}
                    >
                      Keep reading
                    </button>
                  </div>
                ) : pending ? (
                  <div className="wallet-pending" role="status">
                    <h4>Waiting for confirmation…</h4>
                    <p>
                      Your {amount} test XLM demo tip is pending. Don’t send it
                      again.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => {
                        setReceipt({ amount, target, quote })
                        setPending(false)
                        setReview(false)
                      }}
                    >
                      Simulate confirmation
                    </button>
                    <button
                      className="text-action"
                      onClick={() => {
                        setPending(false)
                        setIssue('failed')
                      }}
                    >
                      Simulate a failed tip
                    </button>
                  </div>
                ) : review ? (
                  <div className="wallet-inline-review">
                    <ShieldCheck size={24} />
                    <h4>Your approval comes first.</h4>
                    <p>{amount} test XLM to sample writer Maya Sen.</p>
                    <small>
                      In Freighter, this is a separate transaction approval.
                      Connecting alone never sends a tip.
                    </small>
                    <button className="button primary" onClick={approve}>
                      Approve demo tip <Check size={18} />
                    </button>
                    <button
                      className="text-action"
                      onClick={() => setReview(false)}
                    >
                      Cancel approval
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="button primary"
                      disabled={!ready}
                      onClick={connect}
                    >
                      {connected ? 'Review demo tip' : 'Connect demo wallet'}{' '}
                      <Wallet size={18} />
                    </button>
                    <p className="wallet-action-note">
                      {connected
                        ? 'Review the amount before approving.'
                        : 'Connection shares an address. Sending needs your approval.'}
                    </p>
                  </>
                )}
              </>
            )}
            <div role="status" aria-live="polite">
              {receipt && (
                <div className="wallet-inline-receipt">
                  <Check size={28} />
                  <small>Sample receipt · simulated</small>
                  <h4>A little thanks, delivered.</h4>
                  <strong>
                    {receipt.amount} <small>test XLM</small>
                  </strong>
                  <p>For sample writer Maya Sen</p>
                  <button
                    className="text-action"
                    onClick={() => {
                      setReceipt(null)
                      setQuote(null)
                      setTarget('passage')
                      setSheet(false)
                      setTipping(false)
                      setAppreciated(false)
                    }}
                  >
                    Choose another passage
                  </button>
                </div>
              )}
            </div>
            <details className="wallet-recovery-options">
              <summary>Try a recovery scenario</summary>
              <label htmlFor="wallet-scenario">Demo situation</label>
              <select
                id="wallet-scenario"
                value={scenario}
                onChange={(e) => {
                  setScenario(e.target.value as Scenario)
                  setIssue(null)
                  setReview(false)
                  setPending(false)
                  setReceipt(null)
                }}
              >
                <option value="normal">Normal connection</option>
                <option value="missing">Freighter missing</option>
                <option value="declined">Connection declined</option>
                <option value="network">Wrong network</option>
                <option value="funds">Insufficient test funds</option>
                <option value="failed">Tip fails</option>
              </select>
              <p>
                Choose a situation, then try the tip. Nothing connects or sends
                money.
              </p>
            </details>
            <details className="wallet-desk-help">
              <summary>First wallet? Start here</summary>
              <p>
                Freighter holds your Stellar account and lets you approve
                transactions. No installation is needed for this demo.
              </p>
              <ol>
                <li>
                  <a
                    href="https://freighter.app/#download"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get Freighter from the official site ↗
                  </a>{' '}
                  and follow its create-wallet flow.
                </li>
                <li>
                  Back up your recovery phrase securely. Never share it;
                  QuillTip will never ask for it.
                </li>
                <li>
                  QuillTip currently uses Stellar testnet. Use free test XLM,
                  not purchased funds.
                </li>
                <li>
                  Connect your wallet, then review the recipient, amount,
                  network and any fee before approving a tip.
                </li>
              </ol>
              <a
                href="https://help.freighter.app/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Can’t connect? Freighter help ↗
              </a>
            </details>
            <p className="wallet-demo-disclaimer">
              Demo only · no connection or payment. Test XLM has no monetary
              value.
            </p>
          </aside>
        </div>
      )}
    </section>
  )
}
