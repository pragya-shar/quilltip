/**
 * What each stopped step says, and what the reader can do next. A wallet
 * declined, closed or left unanswered is the reader's choice: no message
 * here (`null`); the sheet closes back to the tip, or returns to the amount
 * with one neutral line. Everything else stays in the sheet with plain
 * words and says what did not happen.
 */
import { shortAddress } from '@/lib/payments/format'
import { formatTokenAmount } from '@/lib/payments/money'
import type { StepFailure } from './services'

export type FailureAction =
  | 'try-again'
  | 'connect-again'
  | 'check-again'
  | 'choose-another'

export type FailureView = { body: string; action: FailureAction }

/** `verb`: "added" for Add money, "set up" for quick tips. */
export function failureView(
  failure: StepFailure,
  context: { balance: string | null; verb: 'add' | 'approve' }
): FailureView | null {
  switch (failure.kind) {
    case 'cancelled':
      return null
    case 'popup-blocked':
      return {
        body: `Your browser blocked the ${failure.wallet} window. Allow pop-ups for this site, then tap Try again. Nothing was sent.`,
        action: 'try-again',
      }
    case 'locked':
      return {
        body: 'Your wallet is locked. Unlock it, then connect again. Nothing was sent.',
        action: 'connect-again',
      }
    case 'wrong-network':
      return failure.when === 'before'
        ? {
            body: `Switch your wallet to Testnet.${failure.network ? ` It is on ${failure.network}.` : ''} Quilltip runs on Stellar testnet only. Nothing was sent.`,
            action: 'check-again',
          }
        : {
            body: 'Your wallet signed for another network. Switch it to Testnet, then try again. Nothing was sent.',
            action: 'try-again',
          }
    case 'unsupported':
      return {
        body: `${failure.wallet} cannot sign this kind of request. Choose another wallet. Nothing was sent.`,
        action: 'choose-another',
      }
    case 'wrong-account':
      return {
        body: `Switch your wallet to ${shortAddress(failure.expected)}. That is the wallet linked to your Quilltip account.${failure.actual ? ` Your wallet is on ${shortAddress(failure.actual)}.` : ''} Switch accounts in your wallet, then connect again. Nothing was signed.`,
        action: 'connect-again',
      }
    case 'fee-too-high':
      return {
        body: `Stellar testnet asked for a fee of ${formatTokenAmount(failure.feeStroops)}, above the ${formatTokenAmount(failure.ceilingStroops)} this allows. Nothing was signed.`,
        action: 'try-again',
      }
    case 'envelope-changed':
      return {
        body: 'Your wallet changed the request, so it was not sent. Nothing was sent.',
        action: 'try-again',
      }
    case 'not-ours':
      return {
        body: 'This request does not match this device, so it was not signed. Nothing was sent.',
        action: 'try-again',
      }
    case 'offline':
      return {
        body: 'You are offline. Nothing was sent. Try again when you are back online.',
        action: 'try-again',
      }
    case 'refused':
      return {
        body: `${failure.message} Nothing was sent.`,
        action: 'try-again',
      }
    case 'failed':
      return {
        body:
          context.verb === 'add'
            ? `This did not go through. Stellar testnet did not confirm it, and your balance is unchanged${context.balance ? ` at ${context.balance}` : ''}.`
            : 'This did not go through. Stellar testnet did not confirm it, and nothing changed.',
        action: 'try-again',
      }
    case 'expired':
      return {
        body:
          context.verb === 'add'
            ? `This timed out. Stellar testnet did not confirm it in time.${context.balance ? ` Your balance shows ${context.balance}; check it before you try again.` : ''}`
            : 'This timed out. Stellar testnet did not confirm it in time. Check this device before you try again.',
        action: 'try-again',
      }
    case 'wallet-failed':
      return {
        body: `${failure.message} Nothing was sent.`.replace(
          /Nothing was (sent|signed)\. Nothing was sent\.$/,
          'Nothing was $1.'
        ),
        action: 'try-again',
      }
  }
}
