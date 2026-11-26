/**
 * Local-network harness for the v2 contracts
 * (docs/architecture/v2/08-testing-and-deployment.md, section 8.1).
 *
 * Every network step first passes the network guard in LOCAL mode: the
 * standalone passphrase, an RPC URL on localhost and the `local` opt-in. The
 * Stellar CLI runs only through scripts/lib/stellar-cli.ts, which sets the
 * network flags itself. Nothing here can reach testnet or mainnet.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
  Address,
} from '@stellar/stellar-sdk'
import {
  basicNodeSigner,
  type ClientOptions,
} from '@stellar/stellar-sdk/contract'

import {
  decodeContractEventXdr,
  type DecodedContractEvent,
} from '../../convex/lib/chain/events'
import { resolveScriptStellarNetwork } from '../lib/network-guard'
import { runStellarCli } from '../lib/stellar-cli'

export const LOCAL_PASSPHRASE = 'Standalone Network ; February 2017'
export const XLM = BigInt(10_000_000)

/** The guarded LOCAL environment. `STELLAR_RPC_URL` may be overridden by the caller. */
export function localEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    QUILLTIP_NETWORK_GUARD_OPT_IN: 'local',
    NEXT_PUBLIC_STELLAR_NETWORK: 'LOCAL',
    STELLAR_NETWORK: 'LOCAL',
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL ?? 'http://localhost:8000/rpc',
    NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
    CONVEX_DEPLOYMENT: 'local:quilltip-integration',
    NEXT_PUBLIC_CONVEX_URL: 'http://127.0.0.1:3210',
  }
}

/** Passes the guard and returns the network it resolved (LOCAL only). */
export function guardedNetwork(operation: string) {
  const net = resolveScriptStellarNetwork(operation, localEnv())
  if (net.guard.network !== 'LOCAL' || net.passphrase !== LOCAL_PASSPHRASE) {
    throw new Error(
      `The integration suite runs on a LOCAL network only (got ${net.guard.network}).`
    )
  }
  return net
}

export class Harness {
  readonly net = guardedNetwork('local-network integration')
  readonly server = new rpc.Server(this.net.rpcUrl, { allowHttp: true })
  readonly friendbot = new URL('/friendbot', this.net.rpcUrl).toString()
  readonly nativeSac = Asset.native().contractId(LOCAL_PASSPHRASE)

  /**
   * Confirms that the RPC serves the local standalone network. The guard only
   * checks the URL; a process on localhost could serve another network.
   */
  async assertLocalNetwork(): Promise<void> {
    const { passphrase } = await this.server.getNetwork()
    if (passphrase !== LOCAL_PASSPHRASE) {
      throw new Error(
        `The RPC at ${this.net.rpcUrl} serves "${passphrase}", not the local standalone network.`
      )
    }
  }

  /** A funded account (friendbot gives 10,000 XLM). */
  async account(): Promise<Keypair> {
    const kp = Keypair.random()
    // A new Quickstart answers RPC health before friendbot is ready, so retry
    // gateway errors for up to two minutes.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.friendbot}?addr=${kp.publicKey()}`)
      if (res.ok) return kp
      const body = await res.text()
      if (res.status < 500 || attempt >= 60) {
        throw new Error(`friendbot ${res.status}: ${body}`)
      }
      await new Promise((r) => setTimeout(r, 2_000))
    }
  }

  async accounts(n: number): Promise<Keypair[]> {
    const out: Keypair[] = []
    for (let i = 0; i < n; i += 8) {
      out.push(
        ...(await Promise.all(
          Array.from({ length: Math.min(8, n - i) }, () => this.account())
        ))
      )
    }
    return out
  }

  /** Runs the Stellar CLI through the guarded wrapper and returns stdout. */
  cli(operation: string, args: string[]): string {
    const r = runStellarCli(operation, args, { env: localEnv() })
    if (r.status !== 0) {
      throw new Error(
        `stellar ${args.slice(0, 2).join(' ')} failed (${r.status}):\n${r.stderr}${r.stdout}`
      )
    }
    return r.stdout.trim()
  }

  /** Deploys the native asset contract if it does not exist yet. */
  ensureNativeSac(source: Keypair): string {
    const r = runStellarCli(
      'deploy native SAC',
      [
        'contract',
        'asset',
        'deploy',
        '--asset',
        'native',
        '--source-account',
        source.secret(),
      ],
      { env: localEnv() }
    )
    if (
      r.status !== 0 &&
      !/already exists|ExistingValue/i.test(r.stderr + r.stdout)
    ) {
      throw new Error(`asset deploy failed:\n${r.stderr}`)
    }
    return this.nativeSac
  }

  uploadWasm(path: string, source: Keypair): string {
    return this.cli('upload contract wasm', [
      'contract',
      'upload',
      '--wasm',
      path,
      '--source-account',
      source.secret(),
    ])
      .split('\n')
      .pop()!
      .trim()
  }

  /** Deploys a contract from an uploaded Wasm hash with constructor arguments. */
  deploy(
    wasmHash: string,
    source: Keypair,
    ctor: Record<string, string>
  ): string {
    const args = [
      'contract',
      'deploy',
      '--wasm-hash',
      wasmHash,
      '--source-account',
      source.secret(),
      '--',
    ]
    for (const [k, v] of Object.entries(ctor)) args.push(`--${k}`, v)
    return this.cli('deploy contract', args).split('\n').pop()!.trim()
  }

  /** Client options for a generated binding, signing as `kp`. */
  opts(contractId: string, kp: Keypair): ClientOptions {
    return {
      contractId,
      networkPassphrase: LOCAL_PASSPHRASE,
      rpcUrl: this.net.rpcUrl,
      allowHttp: true,
      publicKey: kp.publicKey(),
      ...basicNodeSigner(kp, LOCAL_PASSPHRASE),
    }
  }

  /** Native balance in stroops for an account or a contract. */
  async balance(address: string): Promise<bigint> {
    if (address.startsWith('G')) {
      return (await this.server.getAccountEntry(address)).balance
    }
    const r = await this.server.getSACBalance(
      address,
      Asset.native(),
      LOCAL_PASSPHRASE
    )
    return BigInt(r.balanceEntry?.amount ?? '0')
  }

  async latestLedger(): Promise<number> {
    return (await this.server.getLatestLedger()).sequence
  }

  /** Invokes a contract function that the generated binding does not expose. */
  async invokeRaw(
    contractId: string,
    fn: string,
    args: xdr.ScVal[],
    kp: Keypair
  ): Promise<unknown> {
    const account = await this.server.getAccount(kp.publicKey())
    const tx = new TransactionBuilder(account, {
      fee: '1000000',
      networkPassphrase: LOCAL_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: fn,
          args,
        })
      )
      .setTimeout(60)
      .build()
    const sim = await this.server.simulateTransaction(tx)
    if (!rpc.Api.isSimulationSuccess(sim))
      throw new Error(`simulate ${fn}: ${JSON.stringify(sim)}`)
    return sim.result ? scValToNative(sim.result.retval) : undefined
  }

  readWasm(dir: string, file: string): string {
    const path = join(dir, file)
    readFileSync(path)
    return path
  }
}

export type TxMetrics = {
  label: string
  feeCharged: bigint
  resourceFee: bigint
  nonRefundableCharged: bigint
  refundableCharged: bigint
  rentCharged: bigint
  instructions: number
  diskReadBytes: number
  writeBytes: number
  readOnlyEntries: number
  readWriteEntries: number
  eventBytes: number
  ledger: number
}

/** Fee and resource figures of a successful transaction. */
export function metrics(
  label: string,
  res: rpc.Api.GetSuccessfulTransactionResponse
): TxMetrics {
  const env = res.envelopeXdr
  let inner
  if (env.type === 'envelopeTypeTx') inner = env.v1
  else if (env.type === 'envelopeTypeTxFeeBump')
    inner = env.feeBump.tx.innerTx.v1
  else throw new Error(`${label}: unexpected envelope type ${env.type}`)
  const txExt = inner.tx.ext
  if (txExt.type !== 'sorobanData')
    throw new Error(`${label}: transaction has no Soroban data`)
  const data = txExt.sorobanData
  const r = data.resources
  const meta = res.resultMetaXdr
  if (meta.type !== 'v4')
    throw new Error(`${label}: unexpected transaction meta ${meta.type}`)
  const ext = meta.v4.sorobanMeta?.ext
  const v1 = ext && ext.type === 'v1' ? ext.v1 : null
  const eventBytes = res.events.contractEventsXdr
    .flat()
    .reduce((n, e) => n + e.toXdr().length, 0)
  return {
    label,
    feeCharged: res.resultXdr.feeCharged,
    resourceFee: data.resourceFee,
    nonRefundableCharged: v1
      ? v1.totalNonRefundableResourceFeeCharged
      : BigInt(-1),
    refundableCharged: v1 ? v1.totalRefundableResourceFeeCharged : BigInt(-1),
    rentCharged: v1 ? v1.rentFeeCharged : BigInt(-1),
    instructions: r.instructions,
    diskReadBytes: r.diskReadBytes,
    writeBytes: r.writeBytes,
    readOnlyEntries: r.footprint.readOnly.length,
    readWriteEntries: r.footprint.readWrite.length,
    eventBytes,
    ledger: res.ledger,
  }
}

/**
 * Decoded contract events of a transaction, with their raw base64. System
 * events (for example the code update an upgrade emits) carry no payment
 * facts, so they are left out, as the indexer leaves them out.
 */
export function events(
  res: rpc.Api.GetSuccessfulTransactionResponse
): (DecodedContractEvent & { xdr: string })[] {
  return res.events.contractEventsXdr
    .flat()
    .filter((e) => e.type === xdr.ContractEventType.contract)
    .map((e) => {
      const b64 = e.toXdr('base64')
      return { ...decodeContractEventXdr(b64), xdr: b64 }
    })
}

/** Count of system events in a transaction. */
export function systemEventCount(
  res: rpc.Api.GetSuccessfulTransactionResponse
): number {
  return res.events.contractEventsXdr
    .flat()
    .filter((e) => e.type === xdr.ContractEventType.system).length
}

export function addr(kp: Keypair): string {
  return kp.publicKey()
}

export function scAddress(a: string): xdr.ScVal {
  return new Address(a).toScVal()
}
