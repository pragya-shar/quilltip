'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Smartphone } from 'lucide-react'
import type { Pairing } from '@/lib/stellar/v2/walletconnect-pairing'
import { WALLETCONNECT_WALLETS } from '@/lib/stellar/wallet-catalog'
import { QrCode } from './QrCode'

/** Phones and narrow windows open the wallet app; others scan a code. */
const PHONE_QUERY = '(max-width: 639px), (pointer: coarse)'

function usePhoneLayout() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY)
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return phone
}

function minutesLeft(expiresAt: number) {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 60_000))
}

const WALLET_LIST = WALLETCONNECT_WALLETS.join(', ')

/**
 * The WalletConnect step of the wallet picker. On a computer the reader scans
 * the code with a phone wallet; on a phone the wallet app opens from a link.
 * The `wc:` link can also be copied. Back ends the pairing.
 */
export function WalletConnectPairing({
  pairing,
  onBack,
}: {
  pairing: Pairing
  onBack: () => void
}) {
  const phone = usePhoneLayout()
  const heading = useRef<HTMLHeadingElement>(null)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const [minutes, setMinutes] = useState(() => minutesLeft(pairing.expiresAt))

  useEffect(() => {
    heading.current?.focus()
  }, [])
  useEffect(() => {
    setMinutes(minutesLeft(pairing.expiresAt))
    const timer = setInterval(
      () => setMinutes(minutesLeft(pairing.expiresAt)),
      15_000
    )
    return () => clearInterval(timer)
  }, [pairing.expiresAt])

  async function copy() {
    try {
      await navigator.clipboard.writeText(pairing.uri)
      setCopied('yes')
    } catch {
      setCopied('no')
    }
  }

  const code = (
    <QrCode
      value={pairing.uri}
      label="QR code that connects a phone wallet to QuillTip"
    />
  )

  return (
    <section className="wallet-pair" aria-labelledby="wallet-pair-title">
      <button type="button" className="wallet-pair-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden />
        Back to wallets
      </button>
      <h3 id="wallet-pair-title" ref={heading} tabIndex={-1}>
        Connect a mobile wallet
      </h3>
      <p className="wallet-install-note">
        Use {WALLET_LIST} or another Stellar wallet that supports WalletConnect.
        Set it to testnet first.
      </p>

      {phone ? (
        <>
          <a className="wallet-pair-open" href={pairing.uri}>
            <Smartphone size={18} aria-hidden />
            Open in your wallet app
          </a>
          <details className="wallet-pair-more">
            <summary>Show a code to scan with another device</summary>
            <div className="wallet-pair-code">{code}</div>
          </details>
        </>
      ) : (
        <div className="wallet-pair-code">
          {code}
          <p>Open the wallet on your phone and scan this code.</p>
        </div>
      )}

      <div className="wallet-pair-actions">
        <button type="button" className="wallet-pair-copy" onClick={copy}>
          <Copy size={16} aria-hidden />
          Copy link
        </button>
        <span role="status" className="wallet-pair-copied">
          {copied === 'yes'
            ? 'Link copied.'
            : copied === 'no'
              ? 'Copying is blocked here. Scan the code instead.'
              : ''}
        </span>
      </div>
      <p className="wallet-install-note">
        The code expires in {minutes} {minutes === 1 ? 'minute' : 'minutes'}.
        Nothing is signed until you approve it on your phone.
      </p>
    </section>
  )
}
