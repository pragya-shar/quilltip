/**
 * The words of Add money, quick tips and turning quick tips off, and the
 * figures they carry. The reader never sees "tab", "contract", "key" or
 * "session": the balance, this device, your wallet, quick tips.
 */
import { formatMoney, formatTokenAmount } from '@/lib/payments/money'
import { shortAddress } from '@/lib/payments/format'
import type { QuickTipsVariant } from './plan'

/** The network in the reader's words, from the configured network. */
export function networkName(
  setting: string | undefined = process.env.NEXT_PUBLIC_STELLAR_NETWORK
): string {
  const value = setting?.trim().toUpperCase()
  if (value === 'MAINNET') return 'Stellar mainnet'
  return 'Stellar testnet'
}

/** The one testnet line, at the foot of the sheet where money comes in. */
export const TESTNET_FOOT =
  'Quilltip runs on Stellar testnet. Tips are practice money.'

/** The one definition, in these words wherever the choice appears. */
export const QUICK_TIPS_DEFINITION =
  'Quick tips: tip from your balance on this device without opening your wallet each time.'

export const LEDGER_FINE_PRINT =
  'The time follows Stellar testnet’s ledgers and can move by a few minutes.'

export const TURN_OFF_LATER =
  'You can turn quick tips off in Balance, from any device you sign in on. Signing out turns them off on this device.'

/** The Balance row for this device, its second line. */
export const OFF_WHEN_SIGNED_OUT = 'Off when you sign out.'

export const MONEY_ONLY_LINE =
  'Only money is added. This device will ask your wallet before it tips.'

export const NOTHING_ADDED = 'Nothing was added, and nothing was sent.'
export const NOTHING_SET_UP = 'Nothing was set up, and nothing was sent.'

/** "Fri 4 Dec, 14:20" in the reader's time zone. */
export function formatUntil(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`
}

/** "14:02": a time of day. */
export function formatTime(at: number, timeZone?: string): string {
  return formatUntil(new Date(at), timeZone).split(', ')[1] ?? ''
}

/** "Fri 21 Nov": a day without the time. */
export function formatDayShort(date: Date, timeZone?: string): string {
  return formatUntil(date, timeZone).split(',')[0]!
}

/** "86.5 XLM (≈ $10.40)": the cap leads in Lumens, dollars beside it. */
export function capWords(spendLimit: string, capCents: number | null): string {
  const xlm = formatTokenAmount(spendLimit)
  return capCents === null
    ? xlm
    : `${xlm} (${formatMoney(capCents, { converted: true })})`
}

/** The consent line of a request that sets up or renews quick tips. */
export function consentLine(until: string, cap: string): string {
  return `Tip from your balance on this device until ${until}, up to ${cap}, without asking your wallet each time.`
}

/** "≈ $0.000054": a fee in dollars, six decimals at most. */
export function feeDollars(feeCents: number): string {
  if (feeCents < 0.0001) return '≈ $0.00'
  return `≈ ${formatMoney(feeCents)}`
}

/** "0.0004213 XLM, ≈ $0.000054, paid by your wallet" */
export function feeRow(feeStroops: string, feeCents: number | null): string {
  const xlm = formatTokenAmount(feeStroops)
  return feeCents === null
    ? `${xlm}, paid by your wallet`
    : `${xlm}, ${feeDollars(feeCents)}, paid by your wallet`
}

/** "Albedo · GABC…WXYZ" */
export function fromRow(walletName: string | null, address: string): string {
  return walletName
    ? `${walletName} · ${shortAddress(address)}`
    : shortAddress(address)
}

/** State 10, said while the wallet is open. */
export function signingLine(input: {
  xlm: string
  dollars: string
  fee: string
  network: string
  quickTips: { until: string; cap: string } | null
}): string {
  const base = `Approve in your wallet. It asks you to send ${input.xlm} (${input.dollars}) to your Quilltip balance on ${input.network}`
  return input.quickTips
    ? `${base}, and to let this device tip from it until ${input.quickTips.until}, up to ${input.quickTips.cap}, plus the ${input.fee} network fee.`
    : `${base}, plus the ${input.fee} network fee.`
}

/**
 * A wallet shows a contract call's amount in stroops ("100000000"), not in
 * XLM: the sheet says what that number is.
 */
export function smallestUnitLine(stroops: string): string {
  return `Your wallet may show the amount as ${stroops}, Stellar’s smallest unit: that is ${formatTokenAmount(stroops)}.`
}

/** The reason line at the top of the quick tips sheet. */
export function whyLine(
  variant: QuickTipsVariant,
  input: { endedOn?: string | null; limitDollars?: string | null } = {}
): string {
  switch (variant) {
    case 'renew':
      return input.endedOn
        ? `Quick tips on this device ended on ${input.endedOn}. Your wallet approves each device for a few days at a time.`
        : 'Quick tips on this device ended. Your wallet approves each device for a few days at a time.'
    case 'gone':
      return 'This browser lost its approval, which happens when site data is cleared.'
    case 'revoked':
      return 'The approval for this device was turned off.'
    case 'stopped':
      return 'Quick tips stopped on this device after a check did not match. Your balance is safe.'
    case 'limit':
      return input.limitDollars
        ? `This device has tipped ${input.limitDollars}, the most its approval allows.`
        : 'This device has tipped the most its approval allows.'
    case 'pending':
      return 'Setting up this device is not confirmed yet. Approve it again in your wallet to finish. Nothing was sent.'
    case 'set-up':
      return 'Quick tips are not set up on this device yet.'
  }
}

/** What the wallet signs for quick tips alone (state 2). */
export function quickTipsSignsLine(until: string, cap: string): string {
  return `Your wallet signs one thing: this device may tip from your balance until ${until}, up to ${cap}, without asking your wallet each time. No money leaves your balance, and it does not send your tip; you tap Tip after.`
}

export function quickTipsSigningLine(network: string): string {
  return `Approve in your wallet. It asks you to allow this device to tip from your Quilltip balance on ${network}. It sends no money.`
}

export function turnOffSigningLine(network: string): string {
  return `Approve in your wallet. It asks you to record on ${network} that quick tips are off for this device. It sends no money.`
}

export const TURN_OFF_BODY =
  'Quilltip stops accepting tips from it at once. Then your wallet confirms it on Stellar testnet with one approval; no money moves. Tips already sent still settle.'
export const TURN_OFF_GAP =
  'Until your wallet confirms, the approval still exists on Stellar testnet with what is left of its limit, so finish confirming when you can.'
export const TURN_OFF_UNCONFIRMED =
  'Quick tips are off for this device in Quilltip. Your wallet did not confirm it on Stellar testnet, so it is not recorded there yet. ' +
  TURN_OFF_GAP

/** The balance sheet's quick tips line. */
export function balanceQuickTipsLine(
  state:
    | { kind: 'ready'; until: string; renewSoon: boolean }
    | { kind: 'needs-setup' }
    | { kind: 'checking' }
    | { kind: 'unavailable' }
): string {
  switch (state.kind) {
    case 'ready':
      return state.renewSoon
        ? `Quick tips on this device end ${state.until}.`
        : `Quick tips are on for this device until ${state.until}.`
    case 'needs-setup':
      return `Quick tips are not set up on this device. ${QUICK_TIPS_DEFINITION}`
    case 'checking':
      return 'Checking this device with Stellar testnet.'
    case 'unavailable':
      return 'This browser cannot keep quick tips set up. Open Quilltip in a normal window to tip.'
  }
}
