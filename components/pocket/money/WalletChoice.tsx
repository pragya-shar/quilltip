'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/system/components/Button'
import { Spinner } from '@/system/components/Spinner'
import type { WalletRow } from '@/lib/addMoney/services'

/** A phone browser has no extensions: install links lead nowhere there. */
function onPhone(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true
  )
}

const ORDER: Record<WalletRow['access'], number> = {
  mobile: 0,
  installed: 1,
  web: 2,
  'not-installed': 3,
  unavailable: 4,
}

/**
 * The wallet picker inside the sheet: rows a reader can use on this page,
 * each a 56 px button with the wallet's name and how it opens. On a phone
 * the web wallets lead and the extension install links give way to one
 * plain line. A row that cannot work here is not drawn as a choice.
 */
export function WalletChoice({
  title,
  load,
  onChoose,
  onNoWallet,
  pendingId,
}: {
  title: string
  load: () => Promise<WalletRow[]>
  onChoose: (row: WalletRow) => void
  /** "No wallet on this phone?": the reader cannot connect one here. */
  onNoWallet: () => void
  pendingId: string | null
}) {
  const [rows, setRows] = useState<WalletRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  const phone = onPhone()
  useEffect(() => {
    let alive = true
    load()
      .then((all) => alive && setRows(all))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [load])
  useEffect(() => {
    if (rows) first.current?.focus({ preventScroll: true })
  }, [rows])

  if (failed)
    return (
      <p className="qt-add__body">
        Wallets could not load here. Check your connection, then try again.
      </p>
    )
  if (!rows)
    return (
      <p className="qt-add__body qt-add__status">
        <Spinner /> Checking your wallet.
      </p>
    )
  const usable = rows
    .filter((r) => ['installed', 'web', 'mobile'].includes(r.access))
    .sort((a, b) => ORDER[a.access] - ORDER[b.access])
  const install = phone ? [] : rows.filter((r) => r.access === 'not-installed')
  return (
    <div className="qt-add__wallets">
      <h3 className="qt-add__heading">{title}</h3>
      {usable.length === 0 ? (
        <p className="qt-add__body">No wallet can be used on this page.</p>
      ) : (
        <ul className="qt-add__rows">
          {usable.map((row, i) => (
            <li key={row.id}>
              <button
                ref={i === 0 ? first : undefined}
                type="button"
                className="qt-add__wallet"
                aria-busy={pendingId === row.id || undefined}
                disabled={pendingId !== null && pendingId !== row.id}
                onClick={() => pendingId === null && onChoose(row)}
              >
                <span className="qt-add__wallet-mark" aria-hidden="true">
                  {row.name.charAt(0)}
                </span>
                <span className="qt-add__wallet-text">
                  <span className="qt-add__wallet-name">{row.name}</span>
                  <span className="qt-add__wallet-how">{row.howToUse}</span>
                </span>
                <span className="qt-add__wallet-go">
                  {pendingId === row.id ? <Spinner /> : 'Connect'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {phone ? (
        <p className="qt-add__fine">
          Browser extensions such as Varial work in a desktop browser.
        </p>
      ) : install.length > 0 ? (
        <ul className="qt-add__installs">
          {install.map((row) => (
            <li key={row.id}>
              {row.installUrl ? (
                <a href={row.installUrl} target="_blank" rel="noreferrer">
                  Install {row.name}
                </a>
              ) : (
                row.name
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="qt-add__fine">
        Connecting shares your address. It does not send money. Keep your
        recovery phrase private; Quilltip will never ask for it.
      </p>
      {phone ? (
        <Button variant="quiet" onClick={onNoWallet}>
          No wallet on this phone?
        </Button>
      ) : null}
    </div>
  )
}
