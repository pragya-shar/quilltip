/**
 * `runTabTip` with the real tab library (fake-indexeddb, Node WebCrypto) and
 * the stand-in tab ledger from scripts/tab/helpers.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  commitAcceptedTip,
  createSessionKeyStore,
  signTabTip,
  type PreparedTabTip,
  type SubmitTipArgs,
} from '../../lib/stellar/v2/tab'
import {
  convexErrorCode,
  runTabTip,
  type TabTipDeps,
  type TabTipStep,
} from '../../lib/tab-ui/tip-flow'
import {
  FakeTabServer,
  SCOPE,
  WRITER_G,
  depsFor,
  freshDb,
} from '../tab/helpers'

const refusal = (code: string) =>
  Object.assign(new Error(code), { data: { code, message: `${code} message` } })

async function setup() {
  const db = freshDb()
  const keys = createSessionKeyStore({ ...db, forceFallback: true })
  const key = await keys.generate(SCOPE)
  await keys.bindKeyIds(SCOPE, [{ keyId: 0, publicKey: key.info.publicKey }])
  const signing = depsFor(db, { keys })
  const server = new FakeTabServer(new Map([[0, key.info.publicKey]]))
  const requests: string[] = []
  const steps: TabTipStep[] = []
  let n = 0
  const deps: TabTipDeps = {
    prepareTip: async ({ requestId }) => {
      requests.push(requestId)
      return server.prepare({
        keyId: 0,
        writer: WRITER_G,
        amount: BigInt(1_000_000),
      })
    },
    submitTip: async (args: SubmitTipArgs) => server.submit(args),
    sign: (prepared: PreparedTabTip) => signTabTip(prepared, signing),
    commit: (accepted) => commitAcceptedTip(accepted, signing),
    newRequestId: () => `req-${++n}`,
    onStep: (s) => steps.push(s),
    sleep: async () => {},
  }
  return { deps, server, requests, steps, signing }
}

const input = { articleId: 'a1', amountCents: 10, keyId: 0 }

describe('runTabTip', () => {
  it('prepares, signs with no wallet, submits and commits three tips in order', async () => {
    const { deps, server, steps, signing } = await setup()
    for (let i = 0; i < 3; i++) {
      const out = await runTabTip(deps, input)
      expect(out).toMatchObject({
        kind: 'accepted',
        amount: '1000000',
        writer: WRITER_G,
        alreadyAccepted: false,
      })
    }
    expect(steps.slice(0, 3)).toEqual(['preparing', 'signing', 'sending'])
    expect(server.pairs.get(`0|${WRITER_G}`)?.seq).toBe(3)
    const record = await signing.ledger.read(SCOPE, 0, WRITER_G)
    expect(record?.committed?.seq).toBe(3)
  })

  it('resubmits the same signed voucher after a lost response', async () => {
    const { deps } = await setup()
    const sent: SubmitTipArgs[] = []
    const submit = deps.submitTip
    let lose = 2
    deps.submitTip = async (args) => {
      sent.push(args)
      const result = await submit(args)
      if (lose-- > 0) throw new TypeError('Failed to fetch')
      return result
    }
    const out = await runTabTip(deps, input)
    expect(out).toMatchObject({ kind: 'accepted', alreadyAccepted: true })
    expect(sent).toHaveLength(3)
    expect(new Set(sent.map((a) => a.signature)).size).toBe(1)
  })

  it('reports an unconfirmed tip when every resend is lost', async () => {
    const { deps } = await setup()
    deps.submitTip = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await runTabTip(deps, input)).toEqual({ kind: 'unconfirmed' })
  })

  it('prepares once more with a new requestId on retry_prepare, and not twice', async () => {
    const { deps, requests } = await setup()
    const sign = vi
      .fn<TabTipDeps['sign']>()
      .mockResolvedValue({
        kind: 'retry_prepare',
        reason: 'concurrent_update',
      } as never)
    deps.sign = sign
    const out = await runTabTip(deps, input)
    expect(out).toMatchObject({ kind: 'refused' })
    expect(sign).toHaveBeenCalledTimes(2)
    expect(requests).toEqual(['req-1', 'req-2'])
  })

  it('retries once from prepare after a stale submit (another browser tab won the seq)', async () => {
    const { deps, server, requests, signing } = await setup()
    const submit = deps.submitTip
    let stale = true
    deps.submitTip = async (args) => {
      if (stale) {
        stale = false
        // Another browser tab's tip for the same pair is accepted first.
        const other = server.prepare({
          keyId: 0,
          writer: WRITER_G,
          amount: BigInt(5),
        })
        const signed = await signTabTip(other, signing)
        if (signed.kind !== 'signed')
          throw new Error('other tab could not sign')
        await commitAcceptedTip(server.submit(signed.submit), signing)
        throw refusal('TAB_STALE_PREPARE')
      }
      return submit(args)
    }
    const out = await runTabTip(deps, input)
    expect(requests).toHaveLength(2)
    expect(out).toMatchObject({ kind: 'accepted', amount: '1000000' })
    expect(server.pairs.get(`0|${WRITER_G}`)?.seq).toBe(2)
    expect(server.pairs.get(`0|${WRITER_G}`)?.cumulative).toBe(
      BigInt(1_000_005)
    )
  })

  it('shows the refusal when the second submit is refused too', async () => {
    const { deps } = await setup()
    deps.submitTip = async () => {
      throw refusal('TAB_OVER_BALANCE')
    }
    expect(await runTabTip(deps, input)).toEqual({
      kind: 'refused',
      code: 'TAB_OVER_BALANCE',
      message: 'TAB_OVER_BALANCE message',
    })
  })

  it('does not retry a bad voucher, and passes prepare refusals through', async () => {
    const { deps, requests } = await setup()
    deps.submitTip = async () => {
      throw refusal('TAB_INVALID_SIGNATURE')
    }
    expect(await runTabTip(deps, input)).toMatchObject({
      code: 'TAB_INVALID_SIGNATURE',
    })
    expect(requests).toHaveLength(1)
    deps.prepareTip = async () => {
      throw refusal('TAB_DAILY_LIMIT')
    }
    expect(await runTabTip(deps, input)).toMatchObject({
      kind: 'refused',
      code: 'TAB_DAILY_LIMIT',
    })
  })

  it('stops without signing when the library says stop', async () => {
    const { deps } = await setup()
    deps.sign = async () =>
      ({ kind: 'stop', reason: 'key_missing', message: 'gone' }) as never
    const submit = vi.fn()
    deps.submitTip = submit
    expect(await runTabTip(deps, input)).toEqual({
      kind: 'stopped',
      reason: 'key_missing',
      message: 'gone',
    })
    expect(submit).not.toHaveBeenCalled()
  })

  it('retries an unreachable prepare with the same requestId, then gives up', async () => {
    const { deps } = await setup()
    const seen: string[] = []
    deps.prepareTip = async ({ requestId }) => {
      seen.push(requestId)
      throw new TypeError('offline')
    }
    expect(await runTabTip(deps, input)).toEqual({ kind: 'unreachable' })
    expect(seen).toEqual(['req-1', 'req-1', 'req-1'])
  })
})

describe('convexErrorCode', () => {
  it('reads the code from object or JSON data, and ignores other errors', () => {
    expect(convexErrorCode(refusal('TAB_CLOSING'))).toEqual({
      code: 'TAB_CLOSING',
      message: 'TAB_CLOSING message',
    })
    expect(convexErrorCode({ data: '{"code":"X"}' })).toEqual({
      code: 'X',
      message: null,
    })
    expect(convexErrorCode(new Error('plain'))).toBeNull()
    expect(convexErrorCode({ data: 'not json' })).toBeNull()
  })
})
