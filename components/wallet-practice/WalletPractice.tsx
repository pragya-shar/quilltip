'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  withPracticeLock,
  savePracticeStatus,
  clearPracticeRecord,
} from '@/lib/stellar/practice-storage'
import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'
import {
  Wallet,
  Check,
  ArrowUpRight,
  SealCheck,
  PaperPlaneTilt,
} from './WalletIcons'
import {
  RECIPIENT,
  AMOUNT,
  PENDING_KEY,
  server,
  buildPractice,
  validateSigned,
  checkPractice,
  makeKit,
  ensureNetwork,
  Networks,
  parsePracticeRecord,
  type PracticeRecord,
  type PracticeKit,
} from '@/lib/stellar/practice'

const wallets: [string, string][] = [
  ['freighter', 'Freighter'],
  ['xbull', 'xBull'],
  ['albedo', 'Albedo'],
]
export default function WalletPractice() {
  const kit = useRef<PracticeKit | null>(null),
    lock = useRef(false)
  const returnUrl = getSafeReturnPath(
    new URLSearchParams(location.search).get('returnTo'),
    '/#try-it'
  )
  const hasStory =
    /^\/[^/]+\/[^/]+$/.test(returnUrl.split('?')[0] || '') &&
    !returnUrl.startsWith('/wallet/')
  const [wallet, setWallet] = useState('freighter'),
    [address, setAddress] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [missing, setMissing] = useState(false),
    [balance, setBalance] = useState<string | null>(null),
    [record, setRecord] = useState<PracticeRecord | null>(() => {
      try {
        return parsePracticeRecord(localStorage.getItem(PENDING_KEY))
      } catch {
        return null
      }
    })
  const run = useCallback(async (label: string, task: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(label)
    setError('')
    try {
      await task()
    } catch (caught) {
      const e = caught as {
        message?: string
        response?: {
          data?: {
            extras?: {
              result_codes?: { operations?: string[]; transaction?: string }
            }
          }
        }
      }
      const code = e.response?.data?.extras?.result_codes
      setError(
        code
          ? `Transaction failed (${code.operations?.join(', ') || code.transaction}). Check your test balance before trying again.`
          : (e.message === 'Freighter is not connected'
              ? 'Freighter is not available in this browser. Open this preview in the Chrome profile where Freighter is installed, unlock the extension, and try again.'
              : e.message) ||
              'The wallet request was closed or could not finish. Try again when ready.'
      )
    } finally {
      lock.current = false
      setBusy('')
    }
  }, [])
  async function loadBalance(a: string) {
    setBalance(null)
    setMissing(false)
    try {
      const account = await server.loadAccount(a)
      setBalance(
        account.balances.find((b) => b.asset_type === 'native')?.balance ?? null
      )
      setMissing(false)
    } catch (e) {
      if ((e as { response?: { status: number } }).response?.status === 404) {
        setMissing(true)
        setBalance(null)
      } else throw e
    }
  }
  async function connect() {
    await run('Connecting…', async () => {
      kit.current ??= await makeKit()
      kit.current.setWallet(wallet)
      const { address: a } = await kit.current.getAddress()
      await ensureNetwork(kit.current, wallet)
      setAddress(a)
      await loadBalance(a)
    })
  }
  async function fund() {
    await run('Requesting free test funds…', async () => {
      const res = await fetch(
        'https://friendbot.stellar.org/?addr=' + encodeURIComponent(address),
        { signal: AbortSignal.timeout(30000) }
      )
      if (!res.ok)
        throw new Error(
          'The testnet faucet is unavailable or this account is already funded. Check your balance and try later.'
        )
      await loadBalance(address)
    })
  }
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === PENDING_KEY) {
        const latest = parsePracticeRecord(event.newValue)
        setRecord(latest)
        setBalance(null)
        setMissing(false)
      }
    }
    window.addEventListener('storage', synchronize)
    return () => window.removeEventListener('storage', synchronize)
  }, [])
  const refreshRecord = useCallback(async (r: PracticeRecord) => {
    const status = await checkPractice(r)
    const next = { ...r, status }
    if (!savePracticeStatus(next)) return
    setRecord((previous) =>
      previous?.hash === next.hash && previous.status === next.status
        ? previous
        : next
    )
  }, [])
  useEffect(() => {
    if (record?.status !== 'unknown') return
    let checks = 0
    const check = () => {
      if (!lock.current)
        void run('Checking confirmation…', () => refreshRecord(record))
    }
    const timer = setInterval(() => {
      if (++checks > 12) {
        clearInterval(timer)
        return
      }
      check()
    }, 5000)
    return () => clearInterval(timer)
  }, [record, refreshRecord, run])
  async function send() {
    await run('Review and approve in your wallet…', () =>
      withPracticeLock(async () => {
        const prior = parsePracticeRecord(localStorage.getItem(PENDING_KEY))
        if (prior) {
          setRecord(prior)
          throw new Error(
            'Check the existing practice transfer before starting another.'
          )
        }
        if (!kit.current) throw new Error('Connect your wallet first.')
        await ensureNetwork(kit.current, wallet)
        const current = await kit.current.getAddress()
        if (current.address !== address)
          throw new Error(
            'Your wallet account changed. Reconnect to review the correct account.'
          )
        await server.loadAccount(RECIPIENT).catch(() => {
          throw new Error(
            'The demo receiver is unavailable on testnet. Please try later.'
          )
        })
        const account = await server.loadAccount(address),
          tx = buildPractice(account)
        const { signedTxXdr } = await kit.current.signTransaction(tx.toXDR(), {
          address,
          networkPassphrase: Networks.TESTNET,
          submit: false,
        })
        const signed = validateSigned(signedTxXdr, tx)
        const r: PracticeRecord = {
          hash: signed.hash().toString('hex'),
          status: 'unknown',
          expires: Number(tx.timeBounds!.maxTime) * 1000,
          address,
        }
        // Save the hash before sending so reloads and timeouts cannot invite a duplicate transfer.
        localStorage.setItem(PENDING_KEY, JSON.stringify(r))
        setRecord(r)
        setBusy('Submitting to Stellar testnet…')
        try {
          const result = await server.submitTransaction(signed)
          const next: PracticeRecord = {
            ...r,
            status: result.successful ? 'confirmed' : 'failed',
          }
          if (savePracticeStatus(next)) setRecord(next)
        } catch (e) {
          if (
            (
              e as {
                response?: { data?: { extras?: { result_codes?: unknown } } }
              }
            ).response?.data?.extras?.result_codes
          ) {
            const next: PracticeRecord = { ...r, status: 'failed' }
            if (savePracticeStatus(next)) setRecord(next)
            throw e
          }
          setError(
            'Confirmation is not available yet. Keep this transaction link; do not send again.'
          )
        }
      })
    )
  }
  const pending = record?.status === 'unknown'
  const confirmed = record?.status === 'confirmed'
  const previousStatus = useRef(record?.status)
  const [celebrate, setCelebrate] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    if (confirmed && previousStatus.current !== 'confirmed') {
      setCelebrate(true)
      timer = setTimeout(() => setCelebrate(false), 2200)
    }
    previousStatus.current = record?.status
    return () => clearTimeout(timer)
  }, [confirmed, record?.status])
  return (
    <div className="wallet-practice">
      <div className="practice-intro">
        <p className="wallet-eyebrow">A little practice, on us</p>
        <h3>
          {confirmed
            ? 'You’ve made the connection.'
            : 'Your first send, without the stakes.'}
        </h3>
        <p>
          {confirmed
            ? 'Now you know what happens between approving a transfer and receiving a confirmation.'
            : 'Send 1 test XLM to QuillTip’s demo wallet. Practice only — this doesn’t tip an article.'}
        </p>
        <div
          className={`practice-vignette ${confirmed ? 'is-delivered' : ''} ${busy ? 'is-working' : ''}`}
          aria-hidden="true"
        >
          <div className="practice-mini-receipt">
            <span>QUILLTIP</span>
            <i />
            <i />
            <strong>
              1 <small>test XLM</small>
            </strong>
            <span className="mini-receipt-status">
              {confirmed ? 'RECEIVED' : 'A LITTLE PRACTICE'}
            </span>
          </div>
          <div className="practice-wallet-art">
            <Wallet size={42} weight="light" />
            <span>Your wallet</span>
            <div className="practice-wallet-clasp" />
          </div>
          <div className="practice-travel">
            <PaperPlaneTilt size={24} />
          </div>
          <span className="practice-margin-note">
            {confirmed ? 'Signed, sent, received.' : 'You’re in control.'}
            <svg viewBox="0 0 100 50">
              <path d="M90 5Q80 43 12 30m0 0 13-9m-13 9 15 7" />
            </svg>
          </span>
        </div>
        <small>Stellar testnet · test funds have no monetary value.</small>
      </div>
      <div className={`practice-slip ${confirmed ? 'practice-delivered' : ''}`}>
        {celebrate && (
          <div className="practice-confetti" aria-hidden="true">
            {Array.from({ length: 26 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
        )}
        <ol className="practice-progress" aria-label="Transfer progress">
          {['Connect', 'Approve', 'Receive'].map((label, i) => (
            <li
              key={label}
              aria-current={
                (confirmed ? 2 : address ? 1 : 0) === i ? 'step' : undefined
              }
              className={
                confirmed || (i === 0 && address) || (i === 1 && record)
                  ? 'done'
                  : ''
              }
            >
              <span>
                {confirmed || (i === 0 && address) || (i === 1 && record) ? (
                  <Check size={13} />
                ) : (
                  i + 1
                )}
              </span>
              {label}
            </li>
          ))}
        </ol>
        <span className="practice-badge">STELLAR TESTNET</span>
        {record ? (
          <>
            {confirmed && (
              <div className="practice-seal" aria-hidden="true">
                <SealCheck size={48} weight="light" />
              </div>
            )}
            <h4>
              {record.status === 'confirmed'
                ? 'Signed. Sent. Received.'
                : record.status === 'failed'
                  ? 'The transfer failed.'
                  : record.status === 'expired'
                    ? 'This attempt expired.'
                    : 'Checking your transfer.'}
            </h4>
            {confirmed && (
              <div className="practice-receipt-amount">
                1 <span>test XLM</span>
              </div>
            )}
            <p>
              {record.status === 'confirmed'
                ? 'Delivered to QuillTip’s demo receiver. Your wallet did the signing; Stellar confirmed the transfer.'
                : record.status === 'failed'
                  ? 'The payment did not succeed. A network fee may still apply.'
                  : record.status === 'expired'
                    ? 'No transfer was recorded before this attempt expired. You can start again.'
                    : 'No confirmation yet. Please do not send another transfer.'}
            </p>
            <a
              className="practice-proof"
              href={'https://stellar.expert/explorer/testnet/tx/' + record.hash}
              target="_blank"
              rel="noopener noreferrer"
            >
              View your transaction <ArrowUpRight size={18} />
            </a>
            {pending && (
              <button
                className="text-action"
                disabled={Boolean(busy)}
                onClick={() =>
                  run('Checking confirmation…', () => refreshRecord(record))
                }
              >
                Check status
              </button>
            )}
            {!pending && (
              <button
                className="text-action"
                disabled={Boolean(busy)}
                onClick={() =>
                  run('Refreshing your balance…', async () => {
                    setBalance(null)
                    setMissing(false)
                    if (clearPracticeRecord(record.hash)) {
                      setRecord(null)
                      if (address) await loadBalance(address)
                    } else {
                      setRecord(
                        parsePracticeRecord(localStorage.getItem(PENDING_KEY))
                      )
                    }
                  })
                }
              >
                Start another practice
              </button>
            )}
          </>
        ) : (
          <>
            <h4>{address ? 'Ready when you are.' : 'Choose your wallet.'}</h4>
            {!address ? (
              <>
                <div
                  className="practice-wallet-choices"
                  role="group"
                  aria-label="Choose a wallet"
                >
                  {wallets.map(([id, name]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={wallet === id}
                      disabled={Boolean(busy)}
                      onClick={() => setWallet(id)}
                    >
                      <Wallet size={22} weight="light" />
                      <span>{name}</span>
                      {wallet === id && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <button
                  className="button primary"
                  disabled={Boolean(busy)}
                  onClick={connect}
                >
                  Connect {wallets.find((w) => w[0] === wallet)?.[1]}{' '}
                  <ArrowUpRight size={19} />
                </button>
                <details className="practice-help">
                  <summary>Need help connecting?</summary>
                  <p>
                    Use the browser where your wallet is installed. For
                    Freighter, open this preview in Chrome rather than the Codex
                    preview, then unlock the extension and choose Testnet.
                  </p>
                  <a
                    href="https://freighter.app/#download"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get Freighter ↗
                  </a>
                  <p>Once connected, you can request free test XLM here.</p>
                </details>
              </>
            ) : (
              <>
                <p className="practice-address">
                  Connected account <code>{address}</code>
                </p>
                <p>
                  {missing
                    ? 'This account needs testnet funding.'
                    : balance !== null
                      ? `${Number(balance).toFixed(2)} test XLM available`
                      : 'Balance unavailable. Check before sending.'}
                </p>
                <button
                  className="text-action"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    run('Checking balance…', () => loadBalance(address))
                  }
                >
                  Refresh balance
                </button>
                {(missing || Number(balance) < 2) && (
                  <button
                    className="button primary"
                    disabled={Boolean(busy)}
                    onClick={fund}
                  >
                    Get free test XLM
                  </button>
                )}
                <dl>
                  <div>
                    <dt>Amount</dt>
                    <dd>{AMOUNT} test XLM</dd>
                  </div>
                  <div>
                    <dt>Maximum network fee</dt>
                    <dd>0.001 test XLM</dd>
                  </div>
                </dl>
                <p className="practice-address">
                  To QuillTip’s demo receiver<code>{RECIPIENT}</code>
                </p>
                <button
                  className="button primary"
                  disabled={
                    Boolean(busy) ||
                    missing ||
                    balance === null ||
                    Number(balance) < 1.001
                  }
                  onClick={send}
                >
                  Approve 1 test XLM in wallet
                </button>
                <button
                  className="text-action"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setAddress('')
                    setBalance(null)
                    setMissing(false)
                  }}
                >
                  Change wallet
                </button>
              </>
            )}
          </>
        )}
        <p className="practice-live" role="status" aria-live="polite">
          {busy && <span className="practice-spinner" aria-hidden="true" />}
          {busy || (confirmed ? 'Transfer confirmed on Stellar testnet.' : '')}
        </p>
        {error && (
          <p role="alert" className="practice-error">
            {error}
          </p>
        )}
        <a className="text-action practice-return" href={returnUrl}>
          {hasStory
            ? 'Back to your article'
            : returnUrl.startsWith('/articles')
              ? 'Back to articles'
              : returnUrl.startsWith('/reading-desk')
                ? 'Back to reading walkthrough'
                : 'Back to home'}{' '}
          <ArrowUpRight size={16} />
        </a>
        <small>
          Never enter your recovery phrase here. This demo only asks your wallet
          to connect and approve.
        </small>
      </div>
    </div>
  )
}
