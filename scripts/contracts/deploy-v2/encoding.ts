/**
 * Off-chain parts of a tab tip: the session-key signature over the voucher
 * payload, and the acceptor's countersignature over the acceptance payload
 * (docs/architecture/v2/03-tab-contract.md, section 3.5). The voucher payload
 * bytes come from the Tab contract's `voucher_payload` view; the acceptance
 * payload comes from the shared encoders in lib/stellar/v2/tab/encoding.ts.
 */
import { Keypair } from '@stellar/stellar-sdk'

import { acceptancePayloadBytes } from '../../../lib/stellar/v2/tab/encoding'

/**
 * XDR of the `AcceptancePayload` contract type for these voucher bytes, from
 * the shared TypeScript encoders (lib/stellar/v2/tab/encoding.ts).
 */
export function acceptancePayload(voucherPayload: Buffer): Buffer {
  return Buffer.from(acceptancePayloadBytes(voucherPayload))
}

export function sign(key: Keypair, bytes: Buffer): string {
  return Buffer.from(key.sign(bytes)).toString('hex')
}

export type VoucherJson = {
  reader: string
  writer: string
  key_id: number
  cumulative: string
  receipts_root: string
  signature: string
  acceptor: string | null
  acceptance_signature: string | null
}

/** A voucher in the JSON form the Stellar CLI takes for `Vec<Voucher>`. */
export function voucherJson(input: {
  reader: string
  writer: string
  keyId: number
  cumulative: bigint
  receiptsRoot: string
  payload: Buffer
  session: Keypair
  acceptor?: Keypair
}): VoucherJson {
  return {
    reader: input.reader,
    writer: input.writer,
    key_id: input.keyId,
    cumulative: input.cumulative.toString(),
    receipts_root: input.receiptsRoot,
    signature: sign(input.session, input.payload),
    acceptor: input.acceptor
      ? Buffer.from(input.acceptor.rawPublicKey()).toString('hex')
      : null,
    acceptance_signature: input.acceptor
      ? sign(input.acceptor, acceptancePayload(input.payload))
      : null,
  }
}
