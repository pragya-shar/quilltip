/**
 * What a client is told when a sponsored call does not go through: a code
 * and a fixed sentence chosen by the code. "Nothing was sent" is said only
 * when that is known. RPC, configuration and guard text, and anything
 * derived from a secret, never reaches a sentence or a log line of a
 * function a public caller can reach (`errorDetail` is for operators).
 */
import { ConvexError } from 'convex/values'
import { SponsorRefusal } from './policy'

export type SponsorErrorData = { code: string; message: string }

const PAUSED = 'Sponsored calls are paused for now.'
const REFUSED = 'That request was refused. Nothing was sent.'
const NOT_SENT = 'That did not go through. Nothing was sent.'
const FAILED_ON_CHAIN = 'That did not go through. Your balance did not change.'
const WAITING = 'Waiting for Stellar testnet to confirm it.'
const UNKNOWN = 'That did not go through.'

/** Codes whose sentence the client sees; everything else is logged only. */
const SENTENCE: Record<string, string> = {
  SPONSOR_DISABLED: PAUSED,
  SPONSOR_CONFIG_INVALID: PAUSED,
  CHAIN_CONFIG_INVALID: PAUSED,
  SPONSOR_UNAVAILABLE: PAUSED,
  SPONSOR_LOW_BALANCE: PAUSED,
  SPONSOR_DEPLOY_DISABLED: PAUSED,
  SPONSOR_NOT_READY: PAUSED,
  SPONSOR_INVALID: REFUSED,
  SPONSOR_CALL_NOT_ALLOWED: REFUSED,
  SPONSOR_AUTH_REFUSED: REFUSED,
  SPONSOR_SIGNED_MISMATCH: REFUSED,
  SPONSOR_FEE_OVER_CAP: REFUSED,
  SPONSOR_READER_NOT_ALLOWED: REFUSED,
  SPONSOR_DEPLOY_REFUSED: REFUSED,
  SPONSOR_SIMULATION_FAILED: NOT_SENT,
  SPONSOR_SEND_REFUSED: NOT_SENT,
  SPONSOR_TX_FAILED: FAILED_ON_CHAIN,
  SPONSOR_PENDING: WAITING,
}

/**
 * Store refusals: their messages are written for the client already. All are
 * fixed except `SPONSOR_RATE_LIMITED`, which carries the minutes to wait.
 */
const STORE_CODES = new Set([
  'NOT_SIGNED_IN',
  'SPONSOR_BUDGET_REACHED',
  'SPONSOR_RATE_LIMITED',
  'SPONSOR_EXPIRED',
  'SPONSOR_UNKNOWN_REQUEST',
  'SPONSOR_BAD_STATE',
  'SPONSOR_READER_NOT_PASSKEY',
])

export function codeOf(error: unknown): string | null {
  if (error instanceof SponsorRefusal) return error.code
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined
    return typeof data?.code === 'string' ? data.code : null
  }
  return null
}

/**
 * The client's view of an error: a code and a fixed sentence. `signed`
 * says whether a signed envelope may have reached the node, which decides
 * whether "Nothing was sent" may be said for an error we did not classify.
 */
export function toClientError(
  error: unknown,
  signed = false
): ConvexError<SponsorErrorData> {
  const code = codeOf(error)
  if (code && STORE_CODES.has(code) && error instanceof ConvexError) {
    return error as ConvexError<SponsorErrorData>
  }
  if (code && SENTENCE[code]) {
    return new ConvexError({ code, message: SENTENCE[code] })
  }
  return signed
    ? new ConvexError({ code: 'SPONSOR_PENDING', message: WAITING })
    : new ConvexError({
        code: 'SPONSOR_FAILED',
        message: `${UNKNOWN} Nothing was sent.`,
      })
}

/**
 * The detail behind an error, for operators only: never returned to a
 * client and never logged inside a function a public caller can reach (a
 * development deployment sends those log lines to the caller). The public
 * entries hand it to a scheduled internal function that logs it.
 */
export function errorDetail(error: unknown): { code: string; detail: string } {
  const code = codeOf(error) ?? 'unclassified'
  const text = error instanceof Error ? error.message : String(error)
  return { code, detail: text.slice(0, 500) }
}
