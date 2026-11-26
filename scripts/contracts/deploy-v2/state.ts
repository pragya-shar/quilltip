/**
 * Deployment state, one JSON file per contract set. It holds public data only
 * (addresses, IDs, hashes, ledgers, fees), so a rerun skips finished steps and
 * resumes where a failed run stopped.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { dirname } from 'path'

import type { ContractName, ContractSet } from './config'
import type { TxRecord } from './network'

export type BuildRecord = {
  commit: string
  outDir: string
  image: string
  stellarCli: string
  /** Wasm SHA-256 and size per contract. */
  wasm: Record<ContractName, { sha256: string; bytes: number }>
  /** True when a second build of the commit gave the same hashes. */
  reproduced: boolean
}

export type ContractRecord = { id: string; salt: string; tx: TxRecord | null }

export type CheckRecord = {
  name: string
  expected: string
  actual: string
  ok: boolean
}

export type SmokeRecord = {
  flow: string
  tx: TxRecord | null
  /** What the flow did, for the evidence document. */
  detail: string
}

export type DeployState = {
  version: 1
  set: ContractSet
  network: 'TESTNET' | 'LOCAL'
  passphrase: string
  commit?: string
  build?: BuildRecord
  keys?: Record<string, string>
  nativeSac?: string
  uploads?: Partial<
    Record<ContractName, { wasmHash: string; tx: TxRecord | null }>
  >
  contracts?: Partial<Record<ContractName, ContractRecord>>
  config?: { nftBaseUri: string }
  verify?: { at: string; checks: CheckRecord[]; ok: boolean }
  smoke?: Record<string, SmokeRecord>
  /** Values the smoke flows pass between steps (IDs, key IDs). Public. */
  smokeData?: Record<string, string>
  /** Names (never values) set on the integration Convex deployment. */
  convexEnv?: { at: string; names: string[] }
}

export function loadState(
  path: string,
  init: Pick<DeployState, 'set' | 'network' | 'passphrase'>
): DeployState {
  if (!existsSync(path)) return { version: 1, ...init }
  const state = JSON.parse(readFileSync(path, 'utf8')) as DeployState
  if (state.set !== init.set || state.network !== init.network) {
    throw new Error(
      `${path} belongs to set ${state.set} on ${state.network}, not ${init.set} on ${init.network}.`
    )
  }
  if (state.passphrase !== init.passphrase) {
    throw new Error(`${path} was written for another network passphrase.`)
  }
  return state
}

/** Writes atomically, so an interrupted run never leaves a partial file. */
export function saveState(path: string, state: DeployState): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}
