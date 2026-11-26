/**
 * Tab contract calls and views for the tab screens, encoded with the
 * generated Tab bindings' contract spec (03-tab-contract.md, section 3.2).
 * Loaded only with the tab screens (`import()`), never in a first load.
 */
import {
  Account,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import { Client as TabClient } from '@/lib/stellar/v2/bindings/tab'
import type { ContractCall } from '@/lib/stellar/v2/tx'
import { walletFundsFromAccount } from './amounts'
import type { TabCall, TabCallRequest, TabLimits, WalletFunds } from './types'

/** Any valid account works as the source of a view simulation. */
const VIEW_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

let spec: TabClient['spec'] | null = null
function tabSpec(contractId: string, networkPassphrase: string) {
  // The spec is the same for every Tab instance; no network is contacted.
  spec ??= new TabClient({
    contractId,
    networkPassphrase,
    rpcUrl: 'http://localhost',
    allowHttp: true,
  }).spec
  return spec
}

function hexBytes(hex: string, length: number): Uint8Array {
  if (hex.length !== length * 2 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`Expected ${length} bytes of lowercase hex.`)
  }
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** The named arguments of each Tab method, in the bindings' shape. */
export function tabCallArgs(
  call: TabCall,
  source: string
): { method: string; args: Record<string, unknown> } {
  switch (call.method) {
    case 'open_session':
      return {
        method: call.method,
        args: {
          reader: source,
          amount: BigInt(call.amount),
          public_key: hexBytes(call.key.publicKey, 32),
          valid_until: call.key.validUntil,
          spend_limit: BigInt(call.key.spendLimit),
        },
      }
    case 'deposit':
      return {
        method: call.method,
        args: { reader: source, amount: BigInt(call.amount) },
      }
    case 'register_key':
      return {
        method: call.method,
        args: {
          reader: source,
          public_key: hexBytes(call.key.publicKey, 32),
          valid_until: call.key.validUntil,
          spend_limit: BigInt(call.key.spendLimit),
        },
      }
    case 'revoke_key':
      return {
        method: call.method,
        args: { reader: source, key_id: call.keyId },
      }
    case 'withdraw_start':
    case 'withdraw':
      return { method: call.method, args: { reader: source } }
    case 'claim':
      return { method: call.method, args: { recipient: source } }
  }
}

/** The `ContractCall` for `sendContractCall`. */
export function tabContractCall(request: TabCallRequest): ContractCall {
  const { method, args } = tabCallArgs(request.call, request.source)
  return {
    contractId: request.tabContractId,
    method,
    args: tabSpec(
      request.tabContractId,
      request.networkPassphrase
    ).funcArgsToScVals(method, args),
    source: request.source,
    maxTime: request.maxTime,
    networkPassphrase: request.networkPassphrase,
  }
}

type ViewServer = Pick<rpc.Server, 'simulateTransaction'>

/** Simulates a read-only call and returns the native return value. */
export async function readTabView(
  server: ViewServer,
  input: {
    tabContractId: string
    networkPassphrase: string
    method: string
    args?: Record<string, unknown>
  }
): Promise<unknown> {
  const args = tabSpec(
    input.tabContractId,
    input.networkPassphrase
  ).funcArgsToScVals(input.method, input.args ?? {})
  const tx = new TransactionBuilder(new Account(VIEW_SOURCE, '0'), {
    fee: '100',
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(new Contract(input.tabContractId).call(input.method, ...args))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`${input.method}: simulation failed`)
  }
  return scValToNative(sim.result.retval)
}

export async function readClaimable(
  server: ViewServer,
  input: { tabContractId: string; networkPassphrase: string; owner: string }
): Promise<string> {
  const value = await readTabView(server, {
    ...input,
    method: 'claimable',
    args: { owner: input.owner },
  })
  return BigInt(value as bigint).toString()
}

export async function readTabLimits(
  server: ViewServer,
  input: { tabContractId: string; networkPassphrase: string }
): Promise<TabLimits> {
  const config = (await readTabView(server, {
    ...input,
    method: 'config',
  })) as { min_deposit: bigint; max_balance: bigint }
  return {
    minDeposit: BigInt(config.min_deposit).toString(),
    maxBalance: BigInt(config.max_balance).toString(),
  }
}

type AccountServer = Pick<rpc.Server, 'getAccountEntry' | 'getLatestLedger'>

/**
 * What the wallet can spend now: its native balance minus the minimum
 * balance (from the latest ledger header's base reserve) and selling
 * liabilities. Null when the account does not exist yet.
 */
export async function readWalletFunds(
  server: AccountServer,
  address: string
): Promise<WalletFunds | null> {
  let entry: Awaited<ReturnType<AccountServer['getAccountEntry']>>
  try {
    entry = await server.getAccountEntry(address)
  } catch {
    return null
  }
  const ledger = await server.getLatestLedger()
  let sellingLiabilities = '0'
  let numSponsoring = 0
  let numSponsored = 0
  if (entry.ext.type === 'v1') {
    const v1 = entry.ext.v1
    sellingLiabilities = v1.liabilities.selling.toString()
    if (v1.ext.type === 'v2') {
      numSponsoring = v1.ext.v2.numSponsoring
      numSponsored = v1.ext.v2.numSponsored
    }
  }
  return walletFundsFromAccount({
    balance: entry.balance.toString(),
    numSubEntries: entry.numSubEntries,
    numSponsoring,
    numSponsored,
    sellingLiabilities,
    baseReserve: ledger.headerXdr.baseReserve.toString(),
  })
}
