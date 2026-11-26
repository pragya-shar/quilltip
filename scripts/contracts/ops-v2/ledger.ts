/**
 * Ledger entries a v2 contract set depends on, and their time to live.
 *
 * Tracked entries:
 * - the instance and the Wasm code of Core, Tab and the NFT;
 * - the native asset contract's instance and its balance entries for the
 *   three contracts (the Tab balance holds reader deposits);
 * - every persistent contract-data entry of the three contracts that a
 *   transaction of the set has read or written (articles, totals, accounts,
 *   claimable balances, NFT owners and royalties, role entries).
 *
 * Entries are found from transaction footprints: the deployment's recorded
 * transactions, and every transaction that emitted an event of the set since
 * the last scan. They are kept in `<set>/ledger-entries.json`, so an entry
 * stays tracked after its transaction leaves RPC retention. Temporary entries
 * (tip references, session keys, paid amounts) expire by design and are not
 * tracked.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Address, scValToNative, xdr } from '@stellar/stellar-sdk'

import { CONTRACTS, type ContractName } from '../deploy-v2/config'
import { rpc, type DeployNetwork } from '../deploy-v2/network'
import type { DeployState } from '../deploy-v2/state'
import { LEDGERS_PER_DAY } from './common'

export type EntryOwner = ContractName | 'sac'

export type TrackedEntry = {
  /** Base64 `LedgerKey`; the identity of the entry. */
  ledgerKey: string
  kind: 'instance' | 'code' | 'data'
  owner: EntryOwner
  /** Contract that owns an instance or data entry. */
  contractId?: string
  /** Base64 `ScVal` storage key of a data entry (for `--key-xdr`). */
  keyXdr?: string
  wasmHash?: string
  label: string
  source: 'deployment' | 'footprint' | 'file'
}

export type EntryRegistry = {
  version: 1
  /** Last ledger whose events were scanned for transactions. */
  scannedToLedger: number
  entries: TrackedEntry[]
}

// ------------------------------------------------------------ keys

const PERSISTENT = (
  xdr.ContractDataDurability as unknown as {
    persistent: xdr.ContractDataDurability
  }
).persistent

function dataKey(contractId: string, key: xdr.ScVal): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: PERSISTENT,
    })
  )
}

export function instanceEntry(
  owner: EntryOwner,
  contractId: string,
  source: TrackedEntry['source'] = 'deployment'
): TrackedEntry {
  return {
    ledgerKey: dataKey(
      contractId,
      xdr.ScVal.scvLedgerKeyContractInstance()
    ).toXDR('base64'),
    kind: 'instance',
    owner,
    contractId,
    keyXdr: xdr.ScVal.scvLedgerKeyContractInstance().toXDR('base64'),
    label: `${owner} instance`,
    source,
  }
}

export function codeEntry(owner: ContractName, wasmHash: string): TrackedEntry {
  return {
    ledgerKey: xdr.LedgerKey.contractCode(
      new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHash, 'hex') })
    ).toXDR('base64'),
    kind: 'code',
    owner,
    wasmHash,
    label: `${owner} Wasm ${wasmHash.slice(0, 12)}…`,
    source: 'deployment',
  }
}

export function dataEntry(
  owner: EntryOwner,
  contractId: string,
  keyXdr: string,
  source: TrackedEntry['source']
): TrackedEntry {
  const key = xdr.ScVal.fromXDR(keyXdr, 'base64')
  return {
    ledgerKey: dataKey(contractId, key).toXDR('base64'),
    kind: 'data',
    owner,
    contractId,
    keyXdr,
    label: `${owner} ${describeKey(key)}`,
    source,
  }
}

function short(text: string): string {
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text
}

function describeValue(value: unknown): string {
  if (value instanceof Uint8Array)
    return short(Buffer.from(value).toString('hex'))
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(describeValue).join(', ')
  if (typeof value === 'string') return short(value)
  if (value && typeof value === 'object')
    return Object.values(value).map(describeValue).join(', ')
  return String(value)
}

/** `Article(1a2b3c…9f0e)` for a `#[contracttype]` enum key. */
export function describeKey(key: xdr.ScVal): string {
  let native: unknown
  try {
    native = scValToNative(key)
  } catch {
    return key.toXDR('base64').slice(0, 16)
  }
  if (Array.isArray(native) && typeof native[0] === 'string') {
    const [name, ...rest] = native as [string, ...unknown[]]
    return rest.length ? `${name}(${rest.map(describeValue).join(', ')})` : name
  }
  return describeValue(native)
}

/** Entries known from the deployment state alone. */
export function deploymentEntries(state: DeployState): TrackedEntry[] {
  const entries: TrackedEntry[] = []
  for (const c of CONTRACTS) {
    const id = state.contracts?.[c]?.id
    if (id) entries.push(instanceEntry(c, id))
    const hash = state.uploads?.[c]?.wasmHash
    if (hash) entries.push(codeEntry(c, hash))
  }
  if (state.nativeSac) entries.push(instanceEntry('sac', state.nativeSac))
  return entries
}

/** Transaction hashes recorded in the deployment state. */
export function deploymentTxHashes(state: DeployState): string[] {
  const hashes = [
    ...Object.values(state.uploads ?? {}).map((u) => u?.tx?.hash),
    ...Object.values(state.contracts ?? {}).map((c) => c?.tx?.hash),
    ...Object.values(state.smoke ?? {}).map((s) => s?.tx?.hash),
  ]
  return [...new Set(hashes.filter((h): h is string => !!h))]
}

// ------------------------------------------------------------ footprints

type ScAddressLike = Parameters<typeof Address.fromScAddress>[0]

type FootprintKey = {
  type: string
  contractData?: {
    contract: ScAddressLike
    key: xdr.ScVal & { type?: string }
    durability: { name: string }
  }
  contractCode?: { hash: { value?: Uint8Array } | Uint8Array }
}

type EnvelopeLike = {
  type: string
  v1?: { tx: TxLike }
  feeBump?: { tx: { innerTx: { v1: { tx: TxLike } } } }
}
type TxLike = {
  ext: {
    type: string
    sorobanData?: {
      resources: {
        footprint: { readOnly: FootprintKey[]; readWrite: FootprintKey[] }
      }
    }
  }
}

/** Every ledger key in a transaction envelope's Soroban footprint. */
export function footprintKeys(envelopeXdr: string): FootprintKey[] {
  const env = xdr.TransactionEnvelope.fromXDR(
    envelopeXdr,
    'base64'
  ) as unknown as EnvelopeLike
  const tx =
    env.type === 'envelopeTypeTxFeeBump'
      ? env.feeBump?.tx.innerTx.v1.tx
      : env.v1?.tx
  const data = tx?.ext.type === 'sorobanData' ? tx.ext.sorobanData : undefined
  if (!data) return []
  return [
    ...data.resources.footprint.readOnly,
    ...data.resources.footprint.readWrite,
  ]
}

/**
 * Tracked entries among footprint keys: persistent data of the three
 * contracts, and native-asset balances held by them. Instances and code are
 * tracked from the deployment state.
 */
export function entriesFromFootprint(
  keys: FootprintKey[],
  contracts: Record<ContractName, string>,
  nativeSac: string | undefined
): TrackedEntry[] {
  const owners = new Map<string, ContractName>(
    CONTRACTS.map((c) => [contracts[c], c])
  )
  const found: TrackedEntry[] = []
  for (const key of keys) {
    if (key.type !== 'contractData' || !key.contractData) continue
    const { contract, key: storageKey, durability } = key.contractData
    if (durability.name !== 'persistent') continue
    if (storageKey.type === 'scvLedgerKeyContractInstance') continue
    const contractId = Address.fromScAddress(contract).toString()
    const keyXdr = storageKey.toXDR('base64')
    const owner = owners.get(contractId)
    if (owner) {
      found.push(dataEntry(owner, contractId, keyXdr, 'footprint'))
      continue
    }
    if (contractId === nativeSac && heldByContract(storageKey, owners)) {
      found.push(dataEntry('sac', contractId, keyXdr, 'footprint'))
    }
  }
  return found
}

/** A native-asset `Balance(<one of the three contracts>)` key. */
function heldByContract(
  key: xdr.ScVal,
  owners: Map<string, ContractName>
): boolean {
  try {
    const native = scValToNative(key) as unknown
    return (
      Array.isArray(native) &&
      native[0] === 'Balance' &&
      typeof native[1] === 'string' &&
      owners.has(native[1])
    )
  } catch {
    return false
  }
}

// ------------------------------------------------------------ registry

export function registryPath(setDir: string): string {
  return join(setDir, 'ledger-entries.json')
}

export function loadRegistry(path: string): EntryRegistry {
  if (!existsSync(path)) return { version: 1, scannedToLedger: 0, entries: [] }
  return JSON.parse(readFileSync(path, 'utf8')) as EntryRegistry
}

export function saveRegistry(path: string, registry: EntryRegistry): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

/** Adds entries not yet in the registry. Returns how many were added. */
export function mergeEntries(
  registry: EntryRegistry,
  entries: TrackedEntry[]
): number {
  const known = new Set(registry.entries.map((e) => e.ledgerKey))
  let added = 0
  for (const entry of entries) {
    if (known.has(entry.ledgerKey)) continue
    known.add(entry.ledgerKey)
    registry.entries.push(entry)
    added++
  }
  return added
}

/** Reads extra entries from a JSON file of `{ contract, keyXdr }` items. */
export function entriesFromFile(
  text: string,
  contracts: Record<ContractName, string>
): TrackedEntry[] {
  const items = JSON.parse(text) as unknown
  if (!Array.isArray(items))
    throw new Error('The entries file must hold a JSON array.')
  return items.map((item, index) => {
    const { contract, keyXdr } = (item ?? {}) as {
      contract?: string
      keyXdr?: string
    }
    if (!contract || !(CONTRACTS as readonly string[]).includes(contract))
      throw new Error(`Entry ${index}: contract must be core, tab or nft.`)
    if (!keyXdr) throw new Error(`Entry ${index}: keyXdr is required.`)
    xdr.ScVal.fromXDR(keyXdr, 'base64')
    const c = contract as ContractName
    return dataEntry(c, contracts[c], keyXdr, 'file')
  })
}

// ------------------------------------------------------------ scanning

type RpcEvent = { txHash: string; ledger: number }
type EventsPage = {
  events: RpcEvent[]
  cursor?: string
  latestLedger: number
}

/** Ledger sequence encoded in a `getEvents` cursor (TOID high 32 bits). */
export function ledgerOfCursor(cursor: string): number | null {
  const toid = cursor.split('-')[0]
  if (!toid || !/^\d+$/.test(toid)) return null
  return Number(BigInt(toid) >> BigInt(32))
}

export type Health = { latestLedger: number; oldestLedger: number }

export async function health(net: DeployNetwork): Promise<Health> {
  const result = await rpc<Health & { status: string }>(net, 'getHealth', {})
  return {
    latestLedger: result.latestLedger,
    oldestLedger: result.oldestLedger,
  }
}

/**
 * Transaction hashes of every event the contracts emitted from `fromLedger`
 * to the latest ledger. The caller checks retention first.
 */
export async function eventTxHashes(
  net: DeployNetwork,
  contractIds: string[],
  fromLedger: number
): Promise<{ hashes: string[]; toLedger: number }> {
  const hashes = new Set<string>()
  let cursor: string | undefined
  let toLedger = fromLedger
  for (let page = 0; page < 1000; page++) {
    const result = await rpc<EventsPage>(net, 'getEvents', {
      filters: [{ type: 'contract', contractIds }],
      pagination: cursor ? { cursor, limit: 1000 } : { limit: 1000 },
      ...(cursor ? {} : { startLedger: fromLedger }),
    })
    for (const event of result.events) hashes.add(event.txHash)
    toLedger = result.latestLedger
    const cursorLedger = result.cursor ? ledgerOfCursor(result.cursor) : null
    const done =
      result.events.length < 1000 &&
      (cursorLedger === null || cursorLedger >= result.latestLedger)
    if (done || !result.cursor || result.cursor === cursor) break
    cursor = result.cursor
  }
  return { hashes: [...hashes], toLedger }
}

/** Footprint keys of a transaction, or null when RPC no longer holds it. */
export async function transactionFootprint(
  net: DeployNetwork,
  hash: string
): Promise<FootprintKey[] | null> {
  const tx = await rpc<{ status: string; envelopeXdr?: string }>(
    net,
    'getTransaction',
    { hash }
  )
  if (tx.status === 'NOT_FOUND' || !tx.envelopeXdr) return null
  return footprintKeys(tx.envelopeXdr)
}

// ------------------------------------------------------------ TTL

export type TtlStatus = 'ok' | 'due' | 'archived' | 'absent'

export type TtlRow = {
  entry: TrackedEntry
  liveUntil: number | null
  /** Ledgers left; negative when archived. */
  remaining: number | null
  status: TtlStatus
}

export type ArchivalSettings = {
  maxEntryTtl: number
  minPersistentTtl: number
}

/** `CONFIG_SETTING_STATE_ARCHIVAL` from the network. */
export async function archivalSettings(
  net: DeployNetwork
): Promise<ArchivalSettings> {
  const key = xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({
      configSettingId: (
        xdr.ConfigSettingId as unknown as {
          configSettingStateArchival: xdr.ConfigSettingId
        }
      ).configSettingStateArchival,
    })
  ).toXDR('base64')
  const result = await rpc<{ entries: { xdr: string }[] }>(
    net,
    'getLedgerEntries',
    { keys: [key] }
  )
  const data = xdr.LedgerEntryData.fromXDR(
    result.entries[0]!.xdr,
    'base64'
  ) as unknown as {
    configSetting: {
      stateArchivalSettings: { maxEntryTtl: number; minPersistentTtl: number }
    }
  }
  const s = data.configSetting.stateArchivalSettings
  return {
    maxEntryTtl: Number(s.maxEntryTtl),
    minPersistentTtl: Number(s.minPersistentTtl),
  }
}

/** Classifies an entry from its live-until ledger. */
export function classify(
  liveUntil: number | null,
  latest: number,
  thresholdLedgers: number
): { status: TtlStatus; remaining: number | null } {
  if (liveUntil === null) return { status: 'absent', remaining: null }
  const remaining = liveUntil - latest
  if (remaining < 0) return { status: 'archived', remaining }
  return { status: remaining < thresholdLedgers ? 'due' : 'ok', remaining }
}

/** Live-until ledgers of tracked entries, 200 keys per request. */
export async function readTtls(
  net: DeployNetwork,
  entries: TrackedEntry[],
  thresholdLedgers: number
): Promise<{ latestLedger: number; rows: TtlRow[] }> {
  const live = new Map<string, number>()
  let latestLedger = 0
  for (let i = 0; i < entries.length; i += 200) {
    const keys = entries.slice(i, i + 200).map((e) => e.ledgerKey)
    const result = await rpc<{
      latestLedger: number
      entries?: { key: string; liveUntilLedgerSeq?: number }[]
    }>(net, 'getLedgerEntries', { keys })
    latestLedger = Math.max(latestLedger, result.latestLedger)
    for (const e of result.entries ?? []) {
      if (e.liveUntilLedgerSeq !== undefined)
        live.set(e.key, e.liveUntilLedgerSeq)
    }
  }
  if (entries.length === 0) latestLedger = (await health(net)).latestLedger
  const rows = entries.map((entry) => {
    const liveUntil = live.get(entry.ledgerKey) ?? null
    return {
      entry,
      liveUntil,
      ...classify(liveUntil, latestLedger, thresholdLedgers),
    }
  })
  return { latestLedger, rows }
}

/** Days for a number of ledgers, at 5 seconds per ledger. */
export function ledgersToDays(ledgers: number): string {
  return (ledgers / LEDGERS_PER_DAY).toFixed(1)
}
