/**
 * The reconciliation's chain read (#573): the Tab contract's
 * `account(reader)` and `paid(reader, key_id, writer)`, all at one ledger.
 */
import { describe, expect, it } from 'vitest'
import { nativeToScVal, xdr } from '@stellar/stellar-sdk'
import {
  endOfLedgerEventId,
  readTabChainState,
} from '../../convex/chain/tabReconcile'
import type { RpcClient } from '../../convex/lib/chain/rpc'
import shared from '../../contracts/shared/test-vectors.json'
import { rpcEventId } from './coreEvents'
import { seedAddress } from './fixtures'

const PASSPHRASE = shared.network.passphrase
const TAB = shared.tab_contract
const READER = shared.vouchers[0]!.reader
const WRITER = shared.vouchers[0]!.writer
const OTHER = seedAddress(41)

const accountValue = (balance: bigint) =>
  xdr.ScVal.scvMap(
    [
      ['balance', nativeToScVal(balance, { type: 'i128' })],
      ['next_key_id', nativeToScVal(1, { type: 'u32' })],
      ['withdraw_unlock', nativeToScVal(0, { type: 'u32' })],
    ].map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol(key as string),
          val: val as xdr.ScVal,
        })
    )
  )

type Answer = { ledger: number; value: xdr.ScVal }

/** An RPC client that answers each view call from `answers`, in order. */
function fakeRpc(answers: Answer[]) {
  const calls: string[] = []
  const rpc = {
    async simulateTransaction(txXdr: string) {
      expect(typeof txXdr).toBe('string')
      calls.push(txXdr)
      const next = answers.shift()
      if (!next) throw new Error('no answer left')
      return {
        latestLedger: next.ledger,
        retvalXdr: next.value.toXDR('base64'),
      }
    },
  } as unknown as RpcClient
  return { rpc, calls }
}

const chain = { passphrase: PASSPHRASE }
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })
const pairs = [
  { keyId: 0, writer: WRITER },
  { keyId: 2, writer: OTHER },
]

describe('reconciliation chain read (#573)', () => {
  it('reads the balance and every pair at one ledger', async () => {
    const { rpc, calls } = fakeRpc([
      { ledger: 900, value: accountValue(BigInt(5_000_000)) },
      { ledger: 900, value: i128(BigInt(1_000_000)) },
      { ledger: 900, value: i128(BigInt(600_000)) },
    ])
    expect(await readTabChainState(rpc, chain, TAB, READER, pairs)).toEqual({
      ledger: 900,
      balance: '5000000',
      paid: [
        { keyId: 0, writer: WRITER, paid: '1000000' },
        { keyId: 2, writer: OTHER, paid: '600000' },
      ],
    })
    expect(calls).toHaveLength(3)
  })

  it('reads again when the ledger moved between calls', async () => {
    const { rpc, calls } = fakeRpc([
      { ledger: 900, value: accountValue(BigInt(5_000_000)) },
      { ledger: 901, value: i128(BigInt(1_000_000)) },
      { ledger: 901, value: i128(BigInt(600_000)) },
      { ledger: 902, value: accountValue(BigInt(4_000_000)) },
      { ledger: 902, value: i128(BigInt(2_000_000)) },
      { ledger: 902, value: i128(BigInt(600_000)) },
    ])
    expect(await readTabChainState(rpc, chain, TAB, READER, pairs)).toEqual({
      ledger: 902,
      balance: '4000000',
      paid: [
        { keyId: 0, writer: WRITER, paid: '2000000' },
        { keyId: 2, writer: OTHER, paid: '600000' },
      ],
    })
    expect(calls).toHaveLength(6)
  })

  it('gives up when every read spans ledgers', async () => {
    const answers: Answer[] = []
    for (let i = 0; i < 3; i++) {
      answers.push(
        { ledger: 900 + 2 * i, value: accountValue(BigInt(1)) },
        { ledger: 901 + 2 * i, value: i128(BigInt(0)) }
      )
    }
    const { rpc } = fakeRpc(answers)
    await expect(
      readTabChainState(rpc, chain, TAB, READER, [pairs[0]!])
    ).rejects.toThrow(/chain moved/)
  })

  it('a reader without an account on chain has balance 0', async () => {
    const { rpc } = fakeRpc([
      { ledger: 900, value: xdr.ScVal.scvVoid() },
      { ledger: 900, value: i128(BigInt(1_000_000)) },
    ])
    expect(
      await readTabChainState(rpc, chain, TAB, READER, [pairs[0]!])
    ).toMatchObject({ balance: '0', ledger: 900 })
  })

  it('the reconciliation balance sorts after every event of its ledger and before the next', () => {
    const id = endOfLedgerEventId(7_000_000)
    expect(id).toHaveLength(rpcEventId(7_000_000, 1, 1, 0).length)
    expect(id > rpcEventId(7_000_000, 1, 1, 0)).toBe(true)
    expect(id > rpcEventId(7_000_000, 1_048_575, 4095, 9)).toBe(true)
    expect(id < rpcEventId(7_000_001, 1, 1, 0)).toBe(true)
  })
})
