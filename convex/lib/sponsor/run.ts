/**
 * The fee sponsor's network steps, with the RPC server and the sponsor key
 * passed in (`convex/sponsor.ts` wires them; a smoke run can drive them
 * against testnet directly). Every step applies the checks in `./policy`.
 * This module never reads the environment and never logs the key.
 */
import {
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk'
import {
  SIGNATURE_EXPIRY_LEDGERS,
  balanceCallArgs,
  checkDeployPayload,
  checkRecordedAuth,
  checkResourceFee,
  checkSignedMatchesPrepared,
  refuse,
  type BalanceCallSpec,
  type SponsorConfig,
} from './policy'

export type SponsorDeps = {
  server: rpc.Server
  passphrase: string
  sponsor: Keypair
  cfg: SponsorConfig
}

/** The expiry suggested to the signer: well inside `SIGNATURE_EXPIRY_LEDGERS`. */
export const SUGGESTED_EXPIRY_LEDGERS = 100
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

/** Signs as source, sends and waits; refuses on failure, reports the fee either way. */
async function signSendConfirm(
  d: SponsorDeps,
  tx: Transaction,
  sim: rpc.Api.SimulateTransactionSuccessResponse,
  onFee: (fee: string) => void
): Promise<Confirmed> {
  const prepared = rpc.assembleTransaction(tx, sim).build()
  prepared.sign(d.sponsor)
  const sent = await d.server.sendTransaction(prepared)
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    refuse('SPONSOR_SEND_REFUSED', `The network refused it (${sent.status}).`)
  }
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS
  while (Date.now() < deadline) {
    const got = await d.server.getTransaction(sent.hash)
    if (got.status === 'SUCCESS' || got.status === 'FAILED') {
      const raw = (got.resultXdr as unknown as { feeCharged: unknown })
        .feeCharged
      const fee = String(
        typeof raw === 'function' ? (raw as () => unknown)() : raw
      )
      onFee(fee)
      if (got.status === 'FAILED')
        refuse('SPONSOR_TX_FAILED', `The transaction failed: ${sent.hash}`)
      return { hash: sent.hash, ledger: got.ledger, fee }
    }
    await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS))
  }
  refuse('SPONSOR_PENDING', `Not confirmed yet: ${sent.hash}`)
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
  onFee: (fee: string) => void = () => {}
): Promise<Confirmed> {
  const signed = checkSignedMatchesPrepared(
    prepared,
    signedEntries,
    maxExpiration
  )
  const built = balanceCallArgs(spec)
  const tx = await buildTx(
    d,
    Operation.invokeContractFunction({ ...built, auth: signed }),
    Math.floor(Date.now() / 1000) + 120
  )
  const sim = await simulate(d, tx)
  checkResourceFee(spec.call, BigInt(sim.minResourceFee))
  return signSendConfirm(d, tx, sim, onFee)
}

/** Deploys a passkey account from the kit's `{ func, auth }`, after the allowlist checks. */
export async function runDeploy(
  d: SponsorDeps,
  payload: { func: string; auth: string[]; contractId: string },
  onFee: (fee: string) => void = () => {}
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
    Math.floor(Date.now() / 1000) + 120
  )
  const sim = await simulate(d, tx)
  checkResourceFee('deploy', BigInt(sim.minResourceFee))
  return signSendConfirm(d, tx, sim, onFee)
}
