import { describe, expect, it, vi } from 'vitest'
import {
  runTabOperation,
  type OperationDeps,
} from '../../lib/tab-ui/operation-flow'

const ctx = {
  tabContractId: 'CTAB',
  tokenContractId: 'CTOKEN',
  readerAddress: 'GREADER',
  networkPassphrase: 'Test SDF Network ; September 2015',
  currentLedger: 100,
}

function deps(extra: Partial<OperationDeps> = {}): OperationDeps {
  return {
    prepare: async () => ctx,
    call: { method: 'deposit', amount: '10' },
    expected: {
      networkPassphrase: ctx.networkPassphrase,
      tabContractId: 'CTAB',
      address: 'GREADER',
    },
    send: vi.fn(async (_req, onStep) => {
      onStep('simulating')
      onStep('signing')
      onStep('sending')
      return { status: 'sent', hash: 'h1' } as const
    }),
    poll: vi.fn(async () => 'SUCCESS' as const),
    nowSeconds: () => 1_000,
    ...extra,
  }
}

describe('runTabOperation', () => {
  it('prepares, sends with maxTime = now + 300 s and polls', async () => {
    const steps: string[] = []
    const onSent = vi.fn()
    const d = deps({ onStep: (s) => steps.push(s), onSent })
    expect(await runTabOperation(d)).toEqual({
      kind: 'sent',
      hash: 'h1',
      maxTime: 1_300,
      poll: 'SUCCESS',
    })
    expect(steps).toEqual(['preparing', 'simulating', 'signing', 'sending'])
    expect(onSent).toHaveBeenCalledWith('h1', 1_300)
    expect(d.send).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'GREADER',
        tabContractId: 'CTAB',
        maxTime: 1_300,
        call: { method: 'deposit', amount: '10' },
      }),
      expect.any(Function)
    )
  })

  it('refuses before the wallet on a Convex refusal or a mismatched prepare', async () => {
    const refused = deps({
      prepare: async () => {
        throw Object.assign(new Error(), {
          data: { code: 'TAB_NO_ACCOUNT', message: 'Open a tab first.' },
        })
      },
    })
    expect(await runTabOperation(refused)).toEqual({
      kind: 'refused',
      code: 'TAB_NO_ACCOUNT',
      message: 'Open a tab first.',
    })
    expect(refused.send).not.toHaveBeenCalled()
    for (const [field, patch] of [
      [
        'network',
        { networkPassphrase: 'Public Global Stellar Network ; September 2015' },
      ],
      ['contract', { tabContractId: 'COTHER' }],
      ['address', { readerAddress: 'GOTHER' }],
    ] as const) {
      const d = deps({ prepare: async () => ({ ...ctx, ...patch }) })
      expect(await runTabOperation(d)).toEqual({ kind: 'mismatch', field })
      expect(d.send).not.toHaveBeenCalled()
    }
    expect(
      await runTabOperation(
        deps({
          prepare: async () => {
            throw new TypeError('offline')
          },
        })
      )
    ).toEqual({ kind: 'unreachable' })
  })

  it('returns a wallet or simulation stop without polling', async () => {
    const d = deps({
      send: async () =>
        ({ status: 'wallet_failed', error: { kind: 'rejected' } }) as never,
    })
    expect(await runTabOperation(d)).toMatchObject({
      kind: 'not-sent',
      outcome: { status: 'wallet_failed' },
    })
    expect(d.poll).not.toHaveBeenCalled()
  })

  it('runs claim with no prepare', async () => {
    const d = deps({ prepare: null, call: { method: 'claim' } })
    expect(await runTabOperation(d)).toMatchObject({ kind: 'sent' })
  })
})
