/**
 * `SettlementSubmitter` implementations (docs/architecture/v2/05-flows-and-admin.md,
 * section 5.7, item 4).
 *
 * `localKeySubmitter` signs `Tab.settle` with the settler key and sends it
 * through RPC. A hosted relayer implements the same interface: it simulates
 * through RPC, `prepare` returns its own job reference, and `send` and
 * `lookup` call the relayer. The caller runs the network guard and reads the
 * secret; this module never reads the environment.
 */
import {
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk'
import type { RpcClient } from './rpc'
import {
  settleArgs,
  type LookupOutcome,
  type PreparedSubmission,
  type SendOutcome,
  type SettleVoucher,
  type SettlementSubmitter,
  type SimulationOutcome,
} from './settler'

/** Inclusion fee per settlement transaction, on top of the resource fee. */
export const SETTLE_INCLUSION_FEE = '10000'

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export function localKeySubmitter(args: {
  /** Raw ed25519 seed or a `Keypair` of the settler account. */
  keypair: Keypair
  passphrase: string
  tabContractId: string
  server: rpc.Server
  /** Used for `getTransaction`, which returns the contract events. */
  rpcClient: RpcClient
}): SettlementSubmitter {
  const { keypair, passphrase, tabContractId, server, rpcClient } = args
  const settler = keypair.publicKey()
  const contract = new Contract(tabContractId)

  async function build(vouchers: SettleVoucher[], maxTime: number) {
    const account = await server.getAccount(settler)
    return new TransactionBuilder(account, {
      fee: String(Math.max(Number(BASE_FEE), Number(SETTLE_INCLUSION_FEE))),
      networkPassphrase: passphrase,
    })
      .addOperation(contract.call('settle', ...settleArgs(settler, vouchers)))
      .setTimebounds(0, maxTime)
      .build()
  }

  return {
    kind: 'localKey',
    settlerAddress: settler,

    async simulate(vouchers): Promise<SimulationOutcome> {
      let tx
      try {
        tx = await build(vouchers, Math.floor(Date.now() / 1000) + 300)
      } catch (error) {
        return { ok: false, kind: 'transient', message: message(error) }
      }
      let sim
      try {
        sim = await server.simulateTransaction(tx)
      } catch (error) {
        return { ok: false, kind: 'transient', message: message(error) }
      }
      if (rpc.Api.isSimulationError(sim)) {
        return { ok: false, kind: 'contract', message: sim.error.slice(0, 500) }
      }
      return { ok: true }
    },

    async prepare(vouchers, maxTime): Promise<PreparedSubmission> {
      const prepared = await server.prepareTransaction(
        await build(vouchers, maxTime)
      )
      prepared.sign(keypair)
      const txHash = Buffer.from(prepared.hash()).toString('hex')
      return { reference: txHash, txHash, envelopeXdr: prepared.toXDR() }
    },

    async send(prepared): Promise<SendOutcome> {
      if (!prepared.envelopeXdr) {
        return { status: 'rejected', message: 'No signed envelope' }
      }
      try {
        const tx = TransactionBuilder.fromXDR(prepared.envelopeXdr, passphrase)
        const r = await server.sendTransaction(tx)
        if (r.status === 'PENDING' || r.status === 'DUPLICATE') {
          return { status: 'sent' }
        }
        if (r.status === 'TRY_AGAIN_LATER') {
          return { status: 'transient', message: 'TRY_AGAIN_LATER' }
        }
        return {
          status: 'rejected',
          message:
            `ERROR ${r.errorResult ? r.errorResult.toXDR('base64') : ''}`.trim(),
        }
      } catch (error) {
        return { status: 'transient', message: message(error) }
      }
    },

    async lookup(prepared): Promise<LookupOutcome> {
      const hash = prepared.txHash ?? prepared.reference
      const r = await rpcClient.getTransaction(hash)
      if (r.status === 'NOT_FOUND') return { status: 'not_found' }
      if (r.status === 'FAILED') {
        return { status: 'failed', txHash: r.txHash, ledger: r.ledger }
      }
      return {
        status: 'success',
        txHash: r.txHash,
        ledger: r.ledger ?? 0,
        contractEventsXdr: r.contractEventsXdr,
      }
    },

    async balance(): Promise<bigint | null> {
      try {
        const entry = await server.getAccountEntry(settler)
        return BigInt(entry.balance.toString())
      } catch {
        return null
      }
    },
  }
}
