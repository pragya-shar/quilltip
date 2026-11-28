/**
 * The fee sponsor's network steps, with the RPC server and the sponsor key
 * passed in (`convex/sponsor.ts` wires them; tests drive them with a fake
 * server). Every step applies the checks in `./policy`. This module never
 * reads the environment and never logs the key.
 */
import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import {
  RESOURCE_FEE_CAP,
  DEPLOY_RESOURCE_FEE_CAP,
  SIGNATURE_EXPIRY_LEDGERS,
  balanceCallArgs,
  checkDeployPayload,
  checkRecordedAuth,
  checkResourceFee,
  checkSignedMatchesPrepared,
  refuse,
  type BalanceCallSpec,
  type SponsorConfig,
  type SponsoredCall,
} from './policy'

/** The RPC calls the sponsor uses: a real `rpc.Server` or a test fake. */
export type SponsorServer = Pick<
  rpc.Server,
  | 'getAccount'
  | 'getAccountEntry'
  | 'getLedgerEntries'
  | 'simulateTransaction'
  | 'sendTransaction'
  | 'getTransaction'
>

export type SponsorDeps = {
  server: SponsorServer
  passphrase: string
  sponsor: Keypair
  cfg: SponsorConfig
  /** How long to wait for a sent transaction's result (default 45 s). */
  confirmTimeoutMs?: number
  /** Polling interval while waiting (default 500 ms). */
  pollMs?: number
}

/**
 * Callbacks for the record keeping: `onSent` runs once the network accepted
 * the transaction and before any polling, so a hash is never lost; `onFee`
 * reports the fee charged when the result is known (success or failure).
 */
export type SendHooks = {
  onSent?: (hash: string, envelopeFee: string) => Promise<void> | void
  onFee?: (fee: string) => void
}

/** The expiry suggested to the signer: well inside `SIGNATURE_EXPIRY_LEDGERS`. */
export const SUGGESTED_EXPIRY_LEDGERS = 100
/** Seconds a sent transaction can still land: its upper time bound. */
export const SUBMIT_TIME_BOUND_S = 120
const CONFIRM_POLL_MS = 500
const CONFIRM_TIMEOUT_MS = 45_000

/** Refuses below the floor, after logging an alert for the operators. */
export async function checkFloor(d: SponsorDeps): Promise<bigint> {
  let balance: bigint
  try {
    const entry = await d.server.getAccountEntry(d.sponsor.publicKey())
    balance = BigInt(String((entry as unknown as { balance: unknown }).balance))
  } catch {
    refuse('SPONSOR_UNAVAILABLE', 'The fee sponsor account cannot be read.')
  }
  if (balance < d.cfg.minBalanceStroops) {
    console.error(
      `[sponsor] ALERT balance ${balance} stroops is below the floor ${d.cfg.minBalanceStroops}; sponsored calls are refused until it is refilled.`
    )
    refuse('SPONSOR_LOW_BALANCE', 'Sponsored calls are paused for now.')
  }
  return balance
}

type Union<T> = { type: string; value: T }

/**
 * The WASM hash of a deployed contract, from its instance entry, or null when
 * it has none (not deployed). Used to refuse a reader whose account is not
 * the allowlisted passkey account code: an unknown `__check_auth` could burn
 * fees up to the cap on every call.
 */
export async function contractWasmHash(
  server: SponsorServer,
  contractId: string
): Promise<string | null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      // SDK 17: enum members are values, not factories.
      durability: xdr.ContractDataDurability.persistent,
    } as never)
  )
  const res = await server.getLedgerEntries(key)
  const data = res.entries[0]?.val as unknown as
    | Union<{ val: Union<{ executable: Union<{ toXDR(): Uint8Array }> }> }>
    | undefined
  const instance = data?.value?.val
  if (!instance || instance.type !== 'scvContractInstance') return null
  const exe = instance.value.executable
  if (exe.type !== 'contractExecutableWasm') return null
  return Buffer.from(exe.value.toXDR()).toString('hex')
}

async function checkReaderAccount(d: SponsorDeps, reader: string) {
  if (!d.cfg.accountWasmHash) return
  let hash: string | null
  try {
    hash = await contractWasmHash(d.server, reader)
  } catch {
    refuse('SPONSOR_UNAVAILABLE', 'The account cannot be read right now.')
  }
  if (hash !== d.cfg.accountWasmHash) {
    refuse(
      'SPONSOR_READER_NOT_ALLOWED',
      'Only a Quilltip passkey account is sponsored.'
    )
  }
}

async function buildTx(
  d: SponsorDeps,
  op: xdr.Operation,
  maxTime: number
): Promise<Transaction> {
  const account = await d.server.getAccount(d.sponsor.publicKey())
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: d.passphrase,
  })
    .addOperation(op)
    .setTimebounds(0, maxTime)
    .build()
}

async function simulate(d: SponsorDeps, tx: Transaction) {
  const sim = await d.server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) {
    refuse('SPONSOR_SIMULATION_FAILED', sim.error.slice(0, 500))
  }
  return sim as rpc.Api.SimulateTransactionSuccessResponse
}

export type Confirmed = { hash: string; ledger: number; fee: string }

function feeCharged(got: { resultXdr: unknown }): string {
  const raw = (got.resultXdr as { feeCharged: unknown }).feeCharged
  return String(typeof raw === 'function' ? (raw as () => unknown)() : raw)
}

/**
 * Assembles, checks the fee of the envelope that will be signed against the
 * cap, signs as source, sends, records the hash, then waits. A transaction
 * that is sent but not confirmed in time is `SPONSOR_PENDING`: never failed,
 * because it can still land until its time bound.
 */
async function signSendConfirm(
  d: SponsorDeps,
  tx: Transaction,
  sim: rpc.Api.SimulateTransactionSuccessResponse,
  resourceCap: bigint,
  hooks: SendHooks
): Promise<Confirmed> {
  const prepared = rpc.assembleTransaction(tx, sim).build()
  // The envelope's fee is what is paid: inclusion fee plus the resource fee
  // from the simulation's transaction data, which a wrong or hostile RPC
  // could set apart from `minResourceFee`.
  if (BigInt(prepared.fee) > resourceCap + BigInt(BASE_FEE)) {
    refuse(
      'SPONSOR_FEE_OVER_CAP',
      `The envelope fee ${prepared.fee} is over the cap ${resourceCap + BigInt(BASE_FEE)}.`
    )
  }
  prepared.sign(d.sponsor)
  const sent = await d.server.sendTransaction(prepared)
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    refuse('SPONSOR_SEND_REFUSED', `The network refused it (${sent.status}).`)
  }
  await hooks.onSent?.(sent.hash, prepared.fee)
  const deadline = Date.now() + (d.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS)
  while (Date.now() < deadline) {
    let got: Awaited<ReturnType<SponsorServer['getTransaction']>> | null = null
    try {
      got = await d.server.getTransaction(sent.hash)
    } catch {
      // A read error says nothing about the transaction: keep waiting.
    }
    if (got && (got.status === 'SUCCESS' || got.status === 'FAILED')) {
      const fee = feeCharged(got)
      hooks.onFee?.(fee)
      if (got.status === 'FAILED') {
        refuse('SPONSOR_TX_FAILED', `The transaction failed: ${sent.hash}`)
      }
      return { hash: sent.hash, ledger: got.ledger, fee }
    }
    await new Promise((r) => setTimeout(r, d.pollMs ?? CONFIRM_POLL_MS))
  }
  refuse('SPONSOR_PENDING', `Not confirmed yet: ${sent.hash}`)
}

/** What the network says now about a sent transaction (for reconciliation). */
export async function lookupSent(
  server: SponsorServer,
  hash: string
): Promise<
  | { status: 'SUCCESS' | 'FAILED'; fee: string; ledger: number }
  | { status: 'NOT_FOUND' }
> {
  const got = await server.getTransaction(hash)
  if (got.status === 'SUCCESS' || got.status === 'FAILED') {
    return { status: got.status, fee: feeCharged(got), ledger: got.ledger }
  }
  return { status: 'NOT_FOUND' }
}

export type PreparedEntries = {
  entries: string[]
  contexts: number
  latestLedger: number
  maxExpiration: number
  feeStroops: bigint
  maxTime: number
}

/** Simulates a balance call in recording mode and checks the auth it asks for. */
export async function runPrepare(
  d: SponsorDeps,
  spec: BalanceCallSpec,
  now: number
): Promise<PreparedEntries> {
  const built = balanceCallArgs(spec)
  await checkFloor(d)
  await checkReaderAccount(d, spec.reader)
  const maxTime = Math.floor(now / 1000) + 300
  const sim = await simulate(
    d,
    await buildTx(d, Operation.invokeContractFunction(built), maxTime)
  )
  const auth = sim.result?.auth ?? []
  const { contexts } = checkRecordedAuth(auth, spec)
  const resourceFee = BigInt(sim.minResourceFee)
  checkResourceFee(spec.call, resourceFee)
  return {
    entries: auth.map((e) => e.toXDR('base64')),
    contexts,
    latestLedger: sim.latestLedger,
    maxExpiration: sim.latestLedger + SIGNATURE_EXPIRY_LEDGERS,
    feeStroops: resourceFee + BigInt(BASE_FEE),
    maxTime,
  }
}

/** Submits the prepared call with the signed entries, as source and fee payer. */
export async function runSubmit(
  d: SponsorDeps,
  spec: BalanceCallSpec,
  prepared: string[],
  signedEntries: string[],
  maxExpiration: number,
  hooks: SendHooks = {}
): Promise<Confirmed> {
  const signed = checkSignedMatchesPrepared(
    prepared,
    signedEntries,
    maxExpiration
  )
  const built = balanceCallArgs(spec)
  await checkFloor(d)
  const tx = await buildTx(
    d,
    Operation.invokeContractFunction({ ...built, auth: signed }),
    Math.floor(Date.now() / 1000) + SUBMIT_TIME_BOUND_S
  )
  const sim = await simulate(d, tx)
  checkResourceFee(spec.call, BigInt(sim.minResourceFee))
  return signSendConfirm(
    d,
    tx,
    sim,
    RESOURCE_FEE_CAP[spec.call as SponsoredCall],
    hooks
  )
}

/** Deploys a passkey account from the kit's `{ func, auth }`, after the allowlist checks. */
export async function runDeploy(
  d: SponsorDeps,
  payload: { func: string; auth: string[]; contractId: string },
  hooks: SendHooks = {}
): Promise<Confirmed> {
  if (!d.cfg.accountWasmHash || !d.cfg.accountDeployer) {
    refuse('SPONSOR_DEPLOY_DISABLED', 'Account creation is not configured.')
  }
  const { func, auth } = checkDeployPayload({
    func: payload.func,
    auth: payload.auth,
    wasmHash: d.cfg.accountWasmHash,
    deployer: d.cfg.accountDeployer,
    expectedContractId: payload.contractId,
    passphrase: d.passphrase,
  })
  await checkFloor(d)
  const tx = await buildTx(
    d,
    Operation.invokeHostFunction({ func, auth }),
    Math.floor(Date.now() / 1000) + SUBMIT_TIME_BOUND_S
  )
  const sim = await simulate(d, tx)
  checkResourceFee('deploy', BigInt(sim.minResourceFee))
  return signSendConfirm(d, tx, sim, DEPLOY_RESOURCE_FEE_CAP, hooks)
}
