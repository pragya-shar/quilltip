import { describe, expect, it } from 'vitest'

import { parseAmount } from '../../lib/stellar/v2/tab/bytes'
import {
  commitAcceptedTip,
  isTabClientError,
  signTabTip,
  voucherPayloadFor,
} from '../../lib/stellar/v2/tab'
import {
  FakeTabServer,
  PASSPHRASE,
  READER,
  SCOPE,
  TAB,
  WRITER_G,
  depsFor,
  freshDb,
} from './helpers'

// i128 amounts are canonical decimal strings: no sign, no leading zero, at
// most 39 digits.
const BAD = ['-1', '01', '1'.repeat(40), '+1', '1.0', ' 1', '1e3', '']

async function code(run: () => unknown): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error) {
    return isTabClientError(error) ? error.code : String(error)
  }
}

describe('amount strings', () => {
  it('accepts canonical values', () => {
    expect(parseAmount('0', 'x')).toBe(BigInt(0))
    expect(parseAmount('10', 'x')).toBe(BigInt(10))
    expect(parseAmount('9'.repeat(39), 'x')).toBe(BigInt('9'.repeat(39)))
  })

  for (const value of BAD) {
    it(`refuses ${JSON.stringify(value)}`, async () => {
      expect(await code(() => parseAmount(value, 'x'))).toBe('INVALID_INPUT')
      expect(
        await code(() =>
          voucherPayloadFor({
            tabContractId: TAB,
            networkPassphrase: PASSPHRASE,
            reader: READER,
            writer: WRITER_G,
            keyId: 0,
            publicKey: new Uint8Array(32),
            cumulative: value,
            receiptsRoot: '00'.repeat(32),
          })
        )
      ).toBe('INVALID_INPUT')
    })

    it(`commitAcceptedTip refuses cumulative ${JSON.stringify(value)}`, async () => {
      const db = freshDb()
      const deps = depsFor(db)
      const key = await deps.keys.generate(SCOPE)
      await deps.keys.bindKeyIds(SCOPE, [
        { keyId: 0, publicKey: key.info.publicKey },
      ])
      const server = new FakeTabServer(new Map([[0, key.info.publicKey]]))
      const prepared = server.prepare({
        keyId: 0,
        writer: WRITER_G,
        amount: BigInt(1),
      })
      const result = await signTabTip(prepared, deps)
      if (result.kind !== 'signed')
        throw new Error(`not signed: ${result.kind}`)
      const accepted = server.submit(result.submit)
      const bad = {
        ...accepted,
        voucher: { ...accepted.voucher, cumulative: value },
      }
      expect(await code(() => commitAcceptedTip(bad, deps))).toBe(
        'INVALID_INPUT'
      )
    })
  }
})
