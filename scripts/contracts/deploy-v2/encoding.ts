/**
 * Off-chain parts of a tab tip: the session-key signature over the voucher
 * payload, and the acceptor's countersignature over the acceptance payload
 * (docs/architecture/v2/03-tab-contract.md, section 3.5). The voucher payload
 * bytes come from the Tab contract's `voucher_payload` view; the acceptance
 * payload is built here and checked against contracts/shared/test-vectors.json.
 */
import { createHash } from 'crypto'
import { Keypair, xdr } from '@stellar/stellar-sdk'

export const TAB_ACCEPT_DOMAIN = 'quilltip_tab_accept_v1'

/**
 * XDR of the `AcceptancePayload` contract type: a map with the keys `domain`
 * (Symbol) and `payload_hash` (BytesN<32>, the SHA-256 of the voucher bytes).
 */
export function acceptancePayload(voucherPayload: Buffer): Buffer {
  const hash = createHash('sha256').update(voucherPayload).digest()
  const payload = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('domain'),
      val: xdr.ScVal.scvSymbol(TAB_ACCEPT_DOMAIN),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('payload_hash'),
      val: xdr.ScVal.scvBytes(hash),
    }),
  ]).toXDR()
  return Buffer.from(payload)
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
