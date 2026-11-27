'use client'

import { ArrowUpRight, Loader2 } from 'lucide-react'
import type { WalletOption } from '@/lib/stellar/v2/wallet'
import { WalletIcon } from './WalletIcon'

function siteOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The second line of a row: how the wallet works from this page. */
function walletNote(option: WalletOption): string {
  const how = howToUse(option)
  return option.formerly ? `Formerly ${option.formerly}. ${how}` : how
}

function howToUse(option: WalletOption): string {
  if (option.access === 'unavailable') {
    return option.unavailableReason ?? 'Cannot be used on this page'
  }
  if (option.access === 'web') {
    return `Opens ${siteOf(option.webUrl ?? option.url)} in a new window`
  }
  if (option.access === 'not-installed') return 'Browser extension'
  return 'Installed'
}

/**
 * One wallet in the picker: a Connect button when the wallet can be used
 * here, an install link when its extension is missing, and plain text with
 * the reason when it cannot work on this page.
 */
export function WalletPickerRow({
  option,
  pending,
  onChoose,
}: {
  option: WalletOption
  pending: WalletOption | null
  onChoose: () => void
}) {
  // The note is part of the button's name, so it is not also a description.
  const body = (
    <span className="wallet-row-body">
      <WalletIcon name={option.name} src={option.icon} />
      <span className="wallet-row-text">
        <span className="wallet-install-name">{option.name}</span>
        <span className="wallet-install-note">{walletNote(option)}</span>
      </span>
    </span>
  )

  if (option.access === 'installed' || option.access === 'web') {
    const isPending = pending?.id === option.id
    return (
      <button
        type="button"
        className="wallet-install-option wallet-picker-option"
        aria-disabled={pending !== null && !isPending}
        onClick={onChoose}
      >
        {body}
        <span className="wallet-install-destination">
          {isPending ? (
            <>
              <Loader2 size={16} className="wallet-picker-spin" aria-hidden />
              Waiting
            </>
          ) : (
            'Connect'
          )}
        </span>
      </button>
    )
  }

  if (option.access === 'unavailable') {
    return (
      <div className="wallet-install-option wallet-picker-option wallet-picker-unavailable">
        {body}
        <span className="wallet-install-destination">Unavailable here</span>
      </div>
    )
  }

  return (
    <a
      href={option.url}
      target="_blank"
      rel="noopener noreferrer"
      className="wallet-install-option wallet-picker-option"
    >
      {body}
      <span className="wallet-install-destination">
        Get {option.name}
        <ArrowUpRight size={16} aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </span>
    </a>
  )
}
