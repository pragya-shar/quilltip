import {
  Account,
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
} from '@stellar/stellar-sdk'
import { describe, it, expect } from 'vitest'
import {
  buildPractice,
  validateSigned,
  checkPractice,
  parsePracticeRecord,
} from './practice'
const pair = Keypair.random()
const record = {
  hash: 'a'.repeat(64),
  address: pair.publicKey(),
  expires: 2000,
  status: 'unknown',
}
describe('wallet practice transaction boundary', () => {
  it('builds only the fixed testnet payment and rejects unsigned or changed envelopes', () => {
    const original = buildPractice(new Account(pair.publicKey(), '1'))
    expect(original.networkPassphrase).toBe(Networks.TESTNET)
    expect(original.fee).toBe('10000')
    expect(original.operations).toEqual([
      expect.objectContaining({
        type: 'payment',
        amount: '1.0000000',
        destination: 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR',
      }),
    ])
    expect(() => validateSigned(original.toXDR(), original)).toThrow(/unsigned/)
    const changed = new TransactionBuilder(new Account(pair.publicKey(), '1'), {
      fee: '10000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          amount: '2',
          asset: Asset.native(),
        })
      )
      .setTimeout(180)
      .build()
    changed.sign(pair)
    expect(() => validateSigned(changed.toXDR(), original)).toThrow(/different/)
    original.sign(pair)
    expect(validateSigned(original.toXDR(), original).hash()).toEqual(
      original.hash()
    )
  })
  it('does not allow retry until the same Horizon has passed the transaction deadline', async () => {
    const horizon = (closed: string) => ({
      ledgers: () => ({
        order: () => ({
          limit: () => ({
            call: async () => ({ records: [{ closed_at: closed }] }),
          }),
        }),
      }),
      transactions: () => ({
        transaction: () => ({
          call: async () => {
            throw { response: { status: 404 } }
          },
        }),
      }),
    })
    expect(await checkPractice(record, horizon('1970-01-01T00:00:01Z'))).toBe(
      'unknown'
    )
    expect(await checkPractice(record, horizon('1970-01-01T00:00:03Z'))).toBe(
      'expired'
    )
  })
  it('validates persisted receipts and rechecks confirmation instead of trusting local status', () => {
    expect(
      parsePracticeRecord(JSON.stringify({ ...record, status: 'confirmed' }))
    ).toEqual(record)
    expect(
      parsePracticeRecord(JSON.stringify({ ...record, hash: '../../mainnet' }))
    ).toBeNull()
    expect(parsePracticeRecord('not json')).toBeNull()
  })
})
