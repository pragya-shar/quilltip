/**
 * Tab session keys in the browser (docs/architecture/v2/03-tab-contract.md,
 * section 3.5; 06-app-integration.md, section 6.6).
 *
 * - A key is an ed25519 pair. With WebCrypto Ed25519 the private key is a
 *   non-extractable `CryptoKey`: scripts can use it but cannot read it.
 * - Where WebCrypto Ed25519 is missing, the fallback is `@noble/curves` with
 *   the 32-byte seed in IndexedDB. Such a key is `extractable: true`, and the
 *   caller passes that flag to `tabs.prepareOpen` / `prepareRegisterKey` so
 *   Convex and the UI can show it.
 * - Records are keyed by Tab contract, reader address and public key. A new
 *   key is pending (`keyIds: []`) until `bindKeyIds` matches it, by public
 *   key, to the `key_id` the chain assigned.
 *
 * The private key never leaves this module: no function returns the seed or
 * the `CryptoKey`.
 */
import { ed25519 } from '@noble/curves/ed25519'

import { bytesToHex, hexToBytes } from './bytes'
import { TabClientError } from './errors'
import {
  KEYS_STORE,
  KEY_REF_INDEX,
  LEDGER_STORE,
  inTransaction,
  request,
  type TabDbOptions,
} from './idb'

/** Ledgers per day at 5 s per ledger (spec 3.1, `DAY`). */
export const DAY_LEDGERS = 17_280
/** Convex stops accepting under a key this many ledgers before `valid_until`. */
export const ACCEPT_MARGIN_LEDGERS = DAY_LEDGERS

export type SessionKeyScope = {
  /** The Tab contract (`C…`). */
  tabContractId: string
  /** The reader's verified Stellar address. */
  readerAddress: string
}

export type SessionKeyBackend = 'webcrypto' | 'noble'

/** What a caller may read about a local key. */
export type LocalSessionKeyInfo = {
  tabContractId: string
  readerAddress: string
  /** ed25519 public key, lowercase hex. */
  publicKey: string
  /** On-chain `key_id`s bound to this public key; empty while pending. */
  keyIds: number[]
  /** True for the `@noble/curves` fallback: the seed is readable by scripts. */
  extractable: boolean
  backend: SessionKeyBackend
  createdAt: number
  /** Set when the local ledger check stopped this key (spec 5.6, step 2). */
  unusable: { reason: string; at: number } | null
}

/** The stored record. Never returned to callers. */
type KeyRecord = {
  tab: string
  reader: string
  publicKey: string
  keyIds: number[]
  keyRefs: string[]
  backend: SessionKeyBackend
  extractable: boolean
  createdAt: number
  unusable: { reason: string; at: number } | null
  /** Present for `webcrypto`. */
  privateKey?: CryptoKey
  /** Present for `noble`. */
  seed?: Uint8Array
}

export type SessionKey = {
  readonly info: LocalSessionKeyInfo
  /** The raw 32-byte public key. */
  publicKey(): Uint8Array
  /** ed25519 signature over `message` directly, with no pre-hash. */
  sign(message: Uint8Array): Promise<Uint8Array>
  /** Deletes this key and its local ledgers from this browser. */
  forget(): Promise<void>
  /** The key's status against the server's view of it. */
  status(serverKey: ServerSessionKey | null, currentLedger: number): KeyStatus
}

/** The server's record of a key, as `tabs.getMyTab` returns it. */
export type ServerSessionKey = {
  keyId: number
  publicKey: string | null
  validUntilLedger: number
  revoked: boolean
}

/**
 * - `ready`: this browser holds the key and Convex accepts tips under it.
 * - `missing`: Convex has an active key this browser does not hold
 *   (cleared site data or storage eviction).
 * - `expired`: within 1 day of `valid_until` or past it; Convex refuses tips.
 * - `revoked`: revoked on chain or in the app.
 * - `unusable`: this browser stopped the key after a ledger mismatch.
 * - `pending`: generated here and not yet registered on chain.
 * - `none`: no key at all.
 */
export type KeyStatus =
  | 'ready'
  | 'missing'
  | 'expired'
  | 'revoked'
  | 'unusable'
  | 'pending'
  | 'none'

export type SessionKeyStoreOptions = TabDbOptions & {
  /** Defaults to `globalThis.crypto`. */
  crypto?: Crypto
  /** Skip WebCrypto and use the fallback (tests and the fixture page). */
  forceFallback?: boolean
  now?: () => number
}

function keyRef(tab: string, reader: string, keyId: number): string {
  return `${tab}|${reader}|${keyId}`
}

function infoOf(record: KeyRecord): LocalSessionKeyInfo {
  return {
    tabContractId: record.tab,
    readerAddress: record.reader,
    publicKey: record.publicKey,
    keyIds: [...record.keyIds],
    extractable: record.extractable,
    backend: record.backend,
    createdAt: record.createdAt,
    unusable: record.unusable ? { ...record.unusable } : null,
  }
}

function checkScope(scope: SessionKeyScope): void {
  if (
    typeof scope?.tabContractId !== 'string' ||
    !/^C[A-Z2-7]{55}$/.test(scope.tabContractId) ||
    typeof scope.readerAddress !== 'string' ||
    !/^[GC][A-Z2-7]{55}$/.test(scope.readerAddress)
  )
    throw new TabClientError(
      'INVALID_INPUT',
      'The key scope needs a Tab contract id and a reader address.'
    )
}

function checkKeyId(keyId: number): void {
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 0xffff_ffff)
    throw new TabClientError('INVALID_INPUT', 'keyId must be a u32')
}

/**
 * The pure status rule. Order: revoked, expired, missing, unusable, ready.
 * Revocation and expiry win because no new key material can fix them here.
 */
export function sessionKeyStatus(input: {
  serverKey: ServerSessionKey | null
  localKey: LocalSessionKeyInfo | null
  currentLedger: number
  acceptMarginLedgers?: number
}): KeyStatus {
  const { serverKey, localKey, currentLedger } = input
  const margin = input.acceptMarginLedgers ?? ACCEPT_MARGIN_LEDGERS
  if (!serverKey) {
    return localKey && localKey.keyIds.length === 0 ? 'pending' : 'none'
  }
  if (serverKey.revoked) return 'revoked'
  if (currentLedger + margin >= serverKey.validUntilLedger) return 'expired'
  if (
    !localKey ||
    !serverKey.publicKey ||
    localKey.publicKey !== serverKey.publicKey.toLowerCase() ||
    !localKey.keyIds.includes(serverKey.keyId)
  )
    return 'missing'
  if (localKey.unusable) return 'unusable'
  return 'ready'
}

/**
 * The reader's overall quick-tip state for the UI: the newest `ready` key,
 * else the newest key Convex would still accept (`missing` or `unusable`),
 * else a local key awaiting registration (`pending`), else the newest key's
 * status (`expired` or `revoked`), else `none`.
 */
export function tabKeyState(input: {
  serverKeys: ServerSessionKey[]
  localKeys: LocalSessionKeyInfo[]
  currentLedger: number
  acceptMarginLedgers?: number
}): { status: KeyStatus; keyId: number | null } {
  const byNewest = [...input.serverKeys].sort((a, b) => b.keyId - a.keyId)
  const statuses = byNewest.map((serverKey) => ({
    keyId: serverKey.keyId,
    status: sessionKeyStatus({
      serverKey,
      localKey:
        input.localKeys.find((k) => k.keyIds.includes(serverKey.keyId)) ?? null,
      currentLedger: input.currentLedger,
      acceptMarginLedgers: input.acceptMarginLedgers,
    }),
  }))
  const ready = statuses.find((s) => s.status === 'ready')
  if (ready) return ready
  const active = statuses.find(
    (s) => s.status === 'missing' || s.status === 'unusable'
  )
  if (active) return active
  if (input.localKeys.some((k) => k.keyIds.length === 0 && !k.unusable))
    return { status: 'pending', keyId: null }
  return statuses[0] ?? { status: 'none', keyId: null }
}

let webCryptoSupport: Promise<boolean> | null = null

/**
 * True when this engine generates, uses and stores a non-extractable
 * WebCrypto Ed25519 key. Cached per page load.
 */
export function supportsWebCryptoEd25519(
  cryptoImpl: Crypto | undefined = globalThis.crypto
): Promise<boolean> {
  if (cryptoImpl !== globalThis.crypto) return probe(cryptoImpl)
  webCryptoSupport ??= probe(cryptoImpl)
  return webCryptoSupport
}

async function probe(cryptoImpl: Crypto | undefined): Promise<boolean> {
  try {
    const subtle = cryptoImpl?.subtle
    if (!subtle) return false
    const pair = (await subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const message = new Uint8Array([1])
    const signature = await subtle.sign('Ed25519', pair.privateKey, message)
    return (
      pair.privateKey.extractable === false &&
      (await subtle.verify('Ed25519', pair.publicKey, signature, message))
    )
  } catch {
    return false
  }
}

function isDataCloneError(error: unknown): boolean {
  const inner =
    error instanceof TabClientError ? (error.cause as unknown) : error
  return (
    typeof inner === 'object' &&
    inner !== null &&
    (inner as { name?: string }).name === 'DataCloneError'
  )
}

export type SessionKeyStore = {
  /**
   * Generates and stores a pending key. Send its `publicKey` and
   * `extractable` to `tabs.prepareOpen` or `tabs.prepareRegisterKey`, then
   * `open_session` / `register_key`; call `bindKeyIds` once Convex lists it.
   */
  generate(scope: SessionKeyScope): Promise<SessionKey>
  /**
   * Binds pending keys to the on-chain ids Convex reports, matching by public
   * key. Returns the keys that gained an id.
   */
  bindKeyIds(
    scope: SessionKeyScope,
    serverKeys: Pick<ServerSessionKey, 'keyId' | 'publicKey'>[]
  ): Promise<SessionKey[]>
  /** The key bound to `keyId`, or null when this browser does not hold it. */
  get(scope: SessionKeyScope, keyId: number): Promise<SessionKey | null>
  getByPublicKey(
    scope: SessionKeyScope,
    publicKey: string
  ): Promise<SessionKey | null>
  list(scope: SessionKeyScope): Promise<SessionKey[]>
  /** Stops this browser from signing with the key (spec 5.6, step 2). */
  markUnusable(
    scope: SessionKeyScope,
    publicKey: string,
    reason: string
  ): Promise<void>
  /** Deletes the key and all its local ledgers. */
  forget(scope: SessionKeyScope, publicKey: string): Promise<void>
  /** The key status for `keyId` against the server record. */
  status(
    scope: SessionKeyScope,
    serverKey: ServerSessionKey,
    currentLedger: number
  ): Promise<KeyStatus>
}

export function createSessionKeyStore(
  options: SessionKeyStoreOptions = {}
): SessionKeyStore {
  const cryptoImpl = options.crypto ?? globalThis.crypto
  const now = options.now ?? (() => Date.now())

  function handle(record: KeyRecord): SessionKey {
    const publicKey = hexToBytes(record.publicKey, 32, 'publicKey')
    const info = infoOf(record)
    return {
      info,
      publicKey: () => publicKey.slice(),
      async sign(message: Uint8Array): Promise<Uint8Array> {
        if (!(message instanceof Uint8Array))
          throw new TabClientError('INVALID_INPUT', 'message must be bytes')
        if (record.backend === 'webcrypto') {
          if (!record.privateKey || !cryptoImpl?.subtle)
            throw new TabClientError(
              'CRYPTO_UNAVAILABLE',
              'WebCrypto is not available to use this key.'
            )
          return new Uint8Array(
            await cryptoImpl.subtle.sign(
              'Ed25519',
              record.privateKey,
              message as Uint8Array<ArrayBuffer>
            )
          )
        }
        if (!record.seed)
          throw new TabClientError('KEY_NOT_FOUND', 'The key seed is missing.')
        return ed25519.sign(message, record.seed)
      },
      forget: () => store.forget(scopeOf(record), record.publicKey),
      status: (serverKey, currentLedger) =>
        sessionKeyStatus({ serverKey, localKey: info, currentLedger }),
    }
  }

  function scopeOf(record: KeyRecord): SessionKeyScope {
    return { tabContractId: record.tab, readerAddress: record.reader }
  }

  async function newRecord(
    scope: SessionKeyScope,
    useWebCrypto: boolean
  ): Promise<KeyRecord> {
    const base = {
      tab: scope.tabContractId,
      reader: scope.readerAddress,
      keyIds: [] as number[],
      keyRefs: [] as string[],
      createdAt: now(),
      unusable: null,
    }
    if (useWebCrypto && cryptoImpl?.subtle) {
      const pair = (await cryptoImpl.subtle.generateKey(
        { name: 'Ed25519' },
        false,
        ['sign', 'verify']
      )) as CryptoKeyPair
      const raw = new Uint8Array(
        await cryptoImpl.subtle.exportKey('raw', pair.publicKey)
      )
      return {
        ...base,
        publicKey: bytesToHex(raw),
        backend: 'webcrypto',
        extractable: false,
        privateKey: pair.privateKey,
      }
    }
    if (!cryptoImpl?.getRandomValues)
      throw new TabClientError(
        'CRYPTO_UNAVAILABLE',
        'This browser has no secure random source.'
      )
    const seed = cryptoImpl.getRandomValues(new Uint8Array(32))
    return {
      ...base,
      publicKey: bytesToHex(ed25519.getPublicKey(seed)),
      backend: 'noble',
      extractable: true,
      seed,
    }
  }

  async function put(record: KeyRecord): Promise<void> {
    await inTransaction(options, [KEYS_STORE], 'readwrite', async (tx) => {
      await request(tx.objectStore(KEYS_STORE).add(record))
    })
  }

  async function readOne(
    scope: SessionKeyScope,
    publicKey: string
  ): Promise<KeyRecord | null> {
    return inTransaction(options, [KEYS_STORE], 'readonly', async (tx) => {
      const found = await request(
        tx
          .objectStore(KEYS_STORE)
          .get([scope.tabContractId, scope.readerAddress, publicKey])
      )
      return (found as KeyRecord | undefined) ?? null
    })
  }

  async function update(
    scope: SessionKeyScope,
    publicKey: string,
    change: (record: KeyRecord) => void
  ): Promise<void> {
    await inTransaction(options, [KEYS_STORE], 'readwrite', async (tx) => {
      const keys = tx.objectStore(KEYS_STORE)
      const found = (await request(
        keys.get([scope.tabContractId, scope.readerAddress, publicKey])
      )) as KeyRecord | undefined
      if (!found)
        throw new TabClientError('KEY_NOT_FOUND', 'No such session key.')
      change(found)
      await request(keys.put(found))
    })
  }

  const store: SessionKeyStore = {
    async generate(scope) {
      checkScope(scope)
      const useWebCrypto =
        !options.forceFallback && (await supportsWebCryptoEd25519(cryptoImpl))
      let record = await newRecord(scope, useWebCrypto)
      try {
        await put(record)
      } catch (error) {
        // An engine that generates the key but cannot store a CryptoKey in
        // IndexedDB falls back rather than losing the key on reload.
        if (record.backend !== 'webcrypto' || !isDataCloneError(error))
          throw error
        record = await newRecord(scope, false)
        await put(record)
      }
      return handle(record)
    },

    async bindKeyIds(scope, serverKeys) {
      checkScope(scope)
      const bound: KeyRecord[] = []
      await inTransaction(options, [KEYS_STORE], 'readwrite', async (tx) => {
        const keys = tx.objectStore(KEYS_STORE)
        for (const serverKey of serverKeys) {
          if (!serverKey.publicKey) continue
          checkKeyId(serverKey.keyId)
          const found = (await request(
            keys.get([
              scope.tabContractId,
              scope.readerAddress,
              serverKey.publicKey.toLowerCase(),
            ])
          )) as KeyRecord | undefined
          if (!found || found.keyIds.includes(serverKey.keyId)) continue
          found.keyIds = [...found.keyIds, serverKey.keyId].sort(
            (a, b) => a - b
          )
          found.keyRefs = found.keyIds.map((id) =>
            keyRef(found.tab, found.reader, id)
          )
          await request(keys.put(found))
          bound.push(found)
        }
      })
      return bound.map(handle)
    },

    async get(scope, keyId) {
      checkScope(scope)
      checkKeyId(keyId)
      const found = await inTransaction(
        options,
        [KEYS_STORE],
        'readonly',
        async (tx) =>
          (await request(
            tx
              .objectStore(KEYS_STORE)
              .index(KEY_REF_INDEX)
              .get(keyRef(scope.tabContractId, scope.readerAddress, keyId))
          )) as KeyRecord | undefined
      )
      return found ? handle(found) : null
    },

    async getByPublicKey(scope, publicKey) {
      checkScope(scope)
      const found = await readOne(scope, publicKey.toLowerCase())
      return found ? handle(found) : null
    },

    async list(scope) {
      checkScope(scope)
      const all = await inTransaction(
        options,
        [KEYS_STORE],
        'readonly',
        async (tx) =>
          (await request(
            tx
              .objectStore(KEYS_STORE)
              .getAll(
                IDBKeyRange.bound(
                  [scope.tabContractId, scope.readerAddress, ''],
                  [scope.tabContractId, scope.readerAddress, '￿']
                )
              )
          )) as KeyRecord[]
      )
      return all.sort((a, b) => a.createdAt - b.createdAt).map(handle)
    },

    async markUnusable(scope, publicKey, reason) {
      checkScope(scope)
      await update(scope, publicKey.toLowerCase(), (record) => {
        record.unusable ??= { reason, at: now() }
      })
    },

    async forget(scope, publicKey) {
      checkScope(scope)
      const id = [
        scope.tabContractId,
        scope.readerAddress,
        publicKey.toLowerCase(),
      ]
      await inTransaction(
        options,
        [KEYS_STORE, LEDGER_STORE],
        'readwrite',
        async (tx) => {
          const keys = tx.objectStore(KEYS_STORE)
          const found = (await request(keys.get(id))) as KeyRecord | undefined
          if (!found) return
          const ledgers = tx.objectStore(LEDGER_STORE)
          for (const keyId of found.keyIds) {
            // `[]` sorts after every string, so this covers every writer.
            await request(
              ledgers.delete(
                IDBKeyRange.bound(
                  [found.tab, found.reader, keyId, ''],
                  [found.tab, found.reader, keyId, []]
                )
              )
            )
          }
          await request(keys.delete(id))
        }
      )
    },

    async status(scope, serverKey, currentLedger) {
      const local = await store.get(scope, serverKey.keyId)
      return sessionKeyStatus({
        serverKey,
        localKey: local?.info ?? null,
        currentLedger,
      })
    },
  }
  return store
}
