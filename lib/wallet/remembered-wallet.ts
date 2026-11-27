/**
 * The reader's last wallet choice, kept in `localStorage` so the wallet can
 * reconnect after a page load without a prompt (#562). It holds the wallet ID
 * and the public address, nothing else. No wallet or SDK code is imported
 * here, so the sign-in pages can clear it without loading the wallet.
 *
 * The record is a hint, never a credential: the adapter restores only a
 * wallet it offers, reads the address from the wallet again, and signs only
 * after the account check in `signTransaction` (`lib/stellar/v2/wallet.ts`).
 */

export const REMEMBERED_WALLET_KEY = 'quilltip:wallet'

/**
 * What Stellar Wallets Kit keeps in `localStorage` for the same choice
 * (`LocalStorageKeys` in the kit), and the 1.x adapter's key. Cleared with
 * the record, so nothing of the reader's wallet is left behind.
 */
export const WALLET_KIT_STORAGE_KEYS = [
  '@StellarWalletsKit/activeAddress',
  '@StellarWalletsKit/selectedModuleId',
  '@StellarWalletsKit/usedWalletsIds',
  '@StellarWalletsKit/hardwareWalletPaths',
  '@StellarWalletsKit/wcSessionPaths',
  'selectedWalletId',
] as const

export type RememberedWallet = { walletId: string; address: string }

type ReadStorage = Pick<Storage, 'getItem' | 'removeItem'>
type WriteStorage = ReadStorage & Pick<Storage, 'setItem'>

/** A Stellar account ID: G, then 55 base32 characters. */
const ACCOUNT_ID = /^G[A-Z2-7]{55}$/
/** A kit module ID: letters, digits, `_` and `-`. */
const WALLET_ID = /^[A-Za-z0-9_-]{1,40}$/

/**
 * The stored record when it is well formed, or null. A malformed record is
 * removed. Callers still check the wallet ID against the wallets they offer.
 */
export function readRememberedWallet(
  storage: ReadStorage | null | undefined
): RememberedWallet | null {
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(REMEMBERED_WALLET_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  const record = parseRecord(raw)
  if (!record) {
    try {
      storage.removeItem(REMEMBERED_WALLET_KEY)
    } catch {
      // Storage is read-only here; the record is ignored either way.
    }
  }
  return record
}

function parseRecord(raw: string): RememberedWallet | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== 'address' || keys[1] !== 'walletId') {
    return null
  }
  const { walletId, address } = value as Record<string, unknown>
  if (typeof walletId !== 'string' || !WALLET_ID.test(walletId)) return null
  if (typeof address !== 'string' || !ACCOUNT_ID.test(address)) return null
  return { walletId, address }
}

/** Stores the reader's choice. Ignores storage that refuses writes. */
export function rememberWallet(
  storage: WriteStorage | null | undefined,
  record: RememberedWallet
) {
  if (!storage) return
  if (!WALLET_ID.test(record.walletId) || !ACCOUNT_ID.test(record.address)) {
    return
  }
  try {
    storage.setItem(
      REMEMBERED_WALLET_KEY,
      JSON.stringify({ walletId: record.walletId, address: record.address })
    )
  } catch {
    // Private mode or a full quota: the wallet just does not restore.
  }
}

/** Removes the record and the kit's copy of the same choice. */
export function forgetRememberedWallet(
  storage: ReadStorage | null | undefined
) {
  if (!storage) return
  for (const key of [REMEMBERED_WALLET_KEY, ...WALLET_KIT_STORAGE_KEYS]) {
    try {
      storage.removeItem(key)
    } catch {
      // Nothing more can be done from here.
    }
  }
}

/** `localStorage`, or null where it is missing or blocked. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
