import { describe, expect, it } from 'vitest'
import { consentFigures, keyUntil } from '@/lib/addMoney/consent'
import { failureView } from '@/lib/addMoney/failures'
import {
  capWords,
  consentLine,
  feeRow,
  formatUntil,
  networkName,
  signingLine,
} from '@/lib/addMoney/words'
import { stepFailureFromWallet } from '@/lib/addMoney/walletFailure'
import {
  SIGNED_FOR_ANOTHER_NETWORK,
  WalletError,
} from '@/lib/stellar/v2/wallet-errors'

const DAY_LEDGERS = 17_280

describe('the consent, from the prepared request', () => {
  it('states the last moment tips are accepted, one day before the end, as a date and a time', () => {
    const clock = { sequence: 1000, closedAt: Date.UTC(2026, 10, 28, 14, 20) }
    const figures = consentFigures(
      { validUntil: 1000 + 7 * DAY_LEDGERS, spendLimit: '865000000' },
      clock,
      0.12,
      'UTC'
    )
    expect(figures.until).toBe('Fri 4 Dec, 14:20')
    expect(figures.cap).toBe('86.5 XLM (≈ $10.38)')
    expect(consentLine(figures.until, figures.cap)).toBe(
      'Tip from your balance on this device until Fri 4 Dec, 14:20, up to 86.5 XLM (≈ $10.38), without asking your wallet each time.'
    )
    expect(consentLine(figures.until, figures.cap)).not.toMatch(/7 days|week/)
  })

  it('leads with Lumens, and drops the dollars with no price', () => {
    expect(capWords('500000000', null)).toBe('50 XLM')
    expect(capWords('500000000', 637)).toBe('50 XLM (≈ $6.37)')
  })

  it('has no date without a ledger clock', () => {
    expect(keyUntil(5000, null)).toBeNull()
  })

  it('writes the time on a 24 hour clock', () => {
    expect(formatUntil(new Date(Date.UTC(2026, 11, 4, 9, 5)), 'UTC')).toBe(
      'Fri 4 Dec, 09:05'
    )
  })
})

describe('the fee and the signing line', () => {
  it('shows the fee in exact Lumens and dollars to six decimals at most', () => {
    expect(feeRow('4213', 0.0054)).toBe(
      '0.0004213 XLM, ≈ $0.000054, paid by your wallet'
    )
    expect(feeRow('4213', 0.00001)).toBe(
      '0.0004213 XLM, ≈ $0.00, paid by your wallet'
    )
    expect(feeRow('4213', null)).toBe('0.0004213 XLM, paid by your wallet')
    // A passkey account's fee is paid by Quilltip's sponsor.
    expect(feeRow('1364691', 1.7, 'quilltip')).toBe(
      '0.1364691 XLM, ≈ $0.017, paid by Quilltip'
    )
  })

  it('names the network from the configuration', () => {
    expect(networkName('TESTNET')).toBe('Stellar testnet')
    expect(networkName(undefined)).toBe('Stellar testnet')
  })

  it('says what the wallet is asked, with quick tips when they are part of it', () => {
    const line = signingLine({
      xlm: '78.5546121 XLM',
      dollars: '$10.00',
      fee: '0.0004213 XLM',
      network: 'Stellar testnet',
      quickTips: { until: 'Fri 4 Dec, 14:20', cap: '86.5 XLM' },
    })
    expect(line).toBe(
      'Approve in your wallet. It asks you to send 78.5546121 XLM ($10.00) to your Quilltip balance on Stellar testnet, and to let this device tip from it until Fri 4 Dec, 14:20, up to 86.5 XLM, plus the 0.0004213 XLM network fee.'
    )
  })
})

describe('wallet errors, from the existing mapping', () => {
  it('treats declining, closing the window and no answer as the reader’s choice', () => {
    for (const kind of ['rejected', 'cancelled', 'timeout'] as const)
      expect(stepFailureFromWallet(new WalletError(kind, 'x'))).toEqual({
        kind: 'cancelled',
      })
    expect(
      failureView({ kind: 'cancelled' }, { balance: null, verb: 'add' })
    ).toBeNull()
  })

  it('keeps a blocked window in the sheet, naming the wallet', () => {
    const failure = stepFailureFromWallet(
      new WalletError('popup-blocked', 'x', { walletId: 'albedo' })
    )
    expect(failure).toEqual({ kind: 'popup-blocked', wallet: 'Albedo' })
    expect(failureView(failure, { balance: null, verb: 'add' })).toEqual({
      body: 'Your browser blocked the Albedo window. Allow pop-ups for this site, then tap Try again. Nothing was sent.',
      action: 'try-again',
    })
  })

  it('tells a network refused before the prompt from a signature made for another', () => {
    const before = stepFailureFromWallet(
      new WalletError('wrong-network', 'x', {
        walletPassphrase: 'Public Global Stellar Network ; September 2015',
      })
    )
    expect(failureView(before, { balance: null, verb: 'add' })?.body).toBe(
      'Switch your wallet to Testnet. It is on Mainnet. Quilltip runs on Stellar testnet only. Nothing was sent.'
    )
    const after = stepFailureFromWallet(
      new WalletError('wrong-network', SIGNED_FOR_ANOTHER_NETWORK)
    )
    expect(failureView(after, { balance: null, verb: 'add' })?.body).toBe(
      'Your wallet signed for another network. Switch it to Testnet, then try again. Nothing was sent.'
    )
  })

  it('names both accounts when the wallet is on another one', () => {
    const failure = stepFailureFromWallet(
      new WalletError('wrong-account', 'x', {
        expectedAddress:
          'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSWXYZ',
        walletAddress:
          'GDEFDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSSTUV',
      })
    )
    expect(failureView(failure, { balance: null, verb: 'add' })).toEqual({
      body: 'Switch your wallet to GABC…WXYZ. That is the wallet linked to your Quilltip account. Your wallet is on GDEF…STUV. Switch accounts in your wallet, then connect again. Nothing was signed.',
      action: 'connect-again',
    })
  })

  it('says the balance is unchanged when the network did not confirm', () => {
    expect(
      failureView({ kind: 'failed' }, { balance: '≈ $0.40', verb: 'add' })?.body
    ).toBe(
      'This did not go through. Stellar testnet did not confirm it, and your balance is unchanged at ≈ $0.40.'
    )
  })

  it('refuses a changed envelope and a fee above the ceiling with nothing signed or sent', () => {
    expect(
      failureView({ kind: 'envelope-changed' }, { balance: null, verb: 'add' })
        ?.body
    ).toMatch(/not sent/)
    expect(
      failureView(
        {
          kind: 'fee-too-high',
          feeStroops: '20000000',
          ceilingStroops: '10000000',
        },
        { balance: null, verb: 'add' }
      )?.body
    ).toBe(
      'Stellar testnet asked for a fee of 2 XLM, above the 1 XLM this allows. Nothing was signed.'
    )
  })
})
