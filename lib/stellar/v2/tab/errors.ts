/**
 * Errors thrown by the browser tab modules. Expected outcomes of a tab tip
 * (a ledger mismatch, a missing key) are returned as typed results by
 * `signTabTip`, not thrown; these errors cover broken environments and
 * invalid calls.
 */
export type TabClientErrorCode =
  /** IndexedDB is missing, blocked, or failed. */
  | 'STORAGE_UNAVAILABLE'
  /** Neither WebCrypto Ed25519 nor the fallback can produce a key. */
  | 'CRYPTO_UNAVAILABLE'
  /** The session key record is not in this browser. */
  | 'KEY_NOT_FOUND'
  /** The caller passed a malformed value. */
  | 'INVALID_INPUT'
  /** An accepted tip does not extend the local ledger. */
  | 'LEDGER_CONFLICT'

export class TabClientError extends Error {
  readonly code: TabClientErrorCode

  constructor(code: TabClientErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'TabClientError'
    this.code = code
  }
}

export function isTabClientError(value: unknown): value is TabClientError {
  return value instanceof TabClientError
}
