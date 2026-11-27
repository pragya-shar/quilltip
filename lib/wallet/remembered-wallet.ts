/**
 * The reader's last wallet choice, kept in `localStorage` per signed-in
 * reader (#562). Each record holds the wallet ID and the public address,
 * nothing else, under `quilltip:wallet:v1:<user ID>`. No wallet or SDK code
 * is imported here: `readRememberedWallet` is a small synchronous read that
 * any page can call to show the reader's last wallet without loading the
 * wallet kit.
 *
 * The record is a hint, never a credential: the adapter restores only a
 * wallet it offers, only when the wallet still reports the same address
 * without a prompt, and signs only after the checks in `signTransaction`
 * (`lib/stellar/v2/wallet.ts`).
 */

export const REMEMBERED_WALLET_PREFIX = 'quilltip:wallet:v1:'

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
type ListStorage = ReadStorage & Pick<Storage, 'key' | 'length'>

/** A Stellar account ID: G, then 55 base32 characters. */
const ACCOUNT_ID = /^G[A-Z2-7]{55}$/
/** A kit module ID: letters, digits, `_` and `-`. */
const WALLET_ID = /^[A-Za-z0-9_-]{1,40}$/
/** A Convex document ID, as the signed-in reader's ID. */
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The storage key for a reader, or null for an ID that cannot be one. */
export function rememberedWalletKey(
  userId: string | null | undefined
): string | null {
  return userId && USER_ID.test(userId)
    ? `${REMEMBERED_WALLET_PREFIX}${userId}`
    : null
}

/**
 * The reader's stored record when it is well formed, or null. A malformed
 * record is removed. Callers still check the wallet ID against the wallets
 * they offer.
 */
export function readRememberedWallet(
  storage: ReadStorage | null | undefined,
  userId: string | null | undefined
): RememberedWallet | null {
  const key = rememberedWalletKey(userId)
  if (!storage || !key) return null
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  const record = parseRecord(raw)
  if (!record) remove(storage, key)
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
  userId: string | null | undefined,
  record: RememberedWallet
) {
  const key = rememberedWalletKey(userId)
  if (!storage || !key) return
  if (!WALLET_ID.test(record.walletId) || !ACCOUNT_ID.test(record.address)) {
    return
  }
  try {
    storage.setItem(
      key,
      JSON.stringify({ walletId: record.walletId, address: record.address })
    )
  } catch {
    // Private mode or a full quota: the wallet just does not restore.
  }
}

/**
 * Removes a reader's record (when `userId` is given) and the kit's copy of
 * the last choice.
 */
export function forgetRememberedWallet(
  storage: ReadStorage | null | undefined,
  userId?: string | null
) {
  if (!storage) return
  const key = rememberedWalletKey(userId)
  for (const name of key
    ? [key, ...WALLET_KIT_STORAGE_KEYS]
    : WALLET_KIT_STORAGE_KEYS) {
    remove(storage, name)
  }
}

/**
 * Removes every reader's record and the kit's keys. For the sign-in pages,
 * where no reader is signed in.
 */
export function forgetAllRememberedWallets(
  storage: ListStorage | null | undefined
) {
  if (!storage) return
  const keys: string[] = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i)
      if (name?.startsWith(REMEMBERED_WALLET_PREFIX)) keys.push(name)
    }
  } catch {
    // Unreadable storage: the kit's keys are still removed below.
  }
  for (const name of [...keys, ...WALLET_KIT_STORAGE_KEYS]) {
    remove(storage, name)
  }
}

function remove(storage: ReadStorage, key: string) {
  try {
    storage.removeItem(key)
  } catch {
    // Read-only or blocked storage: nothing more can be done from here.
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
