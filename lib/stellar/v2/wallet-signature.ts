/**
 * Envelope checks the wallet adapter runs with the Stellar SDK. Loaded with
 * the Wallets Kit, never in the first load.
 *
 * - `checkSourceSignature`: for wallets that cannot report their network
 *   (xBull, LOBSTR, Rabet, Hana, Albedo), the adapter cannot refuse a wrong
 *   network before signing. It checks the signature after: a signature by
 *   the connected key that does not verify over the transaction hash for
 *   Quilltip's passphrase was made for another network.
 * - `describeEnvelope`: whether an envelope calls a Soroban contract.
 */
import {
  FeeBumpTransaction,
  Keypair,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk'
import type { SignatureCheck } from './wallet'

const SOROBAN_OPERATIONS = new Set([
  'invokeHostFunction',
  'extendFootprintTtl',
  'restoreFootprint',
])

function hintsEqual(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

export async function checkSourceSignature(
  signedTxXdr: string,
  address: string,
  passphrase: string
): Promise<SignatureCheck> {
  const tx = TransactionBuilder.fromXDR(signedTxXdr, passphrase)
  const key = Keypair.fromPublicKey(address)
  const hint = key.signatureHint()
  const hash = tx.hash()
  const byKey = tx.signatures.filter((signature) =>
    hintsEqual(signature.hint.toBytes(), hint)
  )
  if (byKey.length === 0) return 'wrong-account'
  return byKey.some((signature) =>
    key.verify(hash, signature.signature.toBytes())
  )
    ? 'ok'
    : 'wrong-network'
}

export async function describeEnvelope(
  xdr: string,
  passphrase: string
): Promise<{ soroban: boolean }> {
  const parsed = TransactionBuilder.fromXDR(xdr, passphrase)
  const tx: Transaction =
    parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed
  return {
    soroban: tx.operations.some((operation) =>
      SOROBAN_OPERATIONS.has(operation.type)
    ),
  }
}
