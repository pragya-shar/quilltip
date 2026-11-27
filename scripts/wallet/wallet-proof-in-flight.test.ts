// @vitest-environment happy-dom
/**
 * `walletProofInFlight` (#511): a verify button marks a proof as intended
 * before it connects, so `WalletReverify` does not start a second proof while
 * the wallet connects. The proof itself is a stand-in the test settles.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { OwnershipResult } from '../../lib/stellar/v2/wallet-ownership'

const proof = vi.hoisted(() => ({
  settle: null as ((result: OwnershipResult) => void) | null,
}))

vi.mock('convex/react', () => ({ useMutation: () => vi.fn() }))
vi.mock('@/lib/stellar/v2/wallet-kit', () => ({ wallet: {} }))
vi.mock('@/lib/stellar/v2/wallet-ownership', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../lib/stellar/v2/wallet-ownership')
  >()),
  proveWalletOwnership: () =>
    new Promise<OwnershipResult>((resolve) => {
      proof.settle = resolve
    }),
}))

const { intendWalletProof, useWalletOwnership, walletProofInFlight } =
  await import('../../hooks/useWalletOwnership')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const PROVED = 'GPROVEDADDRESS'
const OTHER = 'GUNPROVEDADDRESS'

/** Mounts the hook and returns its `verify`. */
async function mountVerify() {
  let verify!: ReturnType<typeof useWalletOwnership>['verify']
  function Probe() {
    verify = useWalletOwnership().verify
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(createElement(Probe)))
  return { verify: () => verify(), unmount: () => root.unmount() }
}

afterEach(() => intendWalletProof(false))

describe('walletProofInFlight', () => {
  test('an intended proof counts as in flight for an unproved address', () => {
    expect(walletProofInFlight(OTHER)).toBe(false)
    intendWalletProof(true)
    expect(walletProofInFlight(OTHER)).toBe(true)
    expect(walletProofInFlight()).toBe(true)
    intendWalletProof(false)
    expect(walletProofInFlight(OTHER)).toBe(false)
  })

  test('starting the proof clears the intent; the proved address stays covered', async () => {
    const hook = await mountVerify()
    intendWalletProof(true)

    let done!: Promise<unknown>
    await act(async () => {
      done = hook.verify()
    })
    // Running now: in flight because of the proof, not the intent.
    expect(walletProofInFlight(OTHER)).toBe(true)

    await act(async () => {
      proof.settle!({ address: PROVED } as OwnershipResult)
      await done
    })
    // The intent was cleared when the proof started.
    expect(walletProofInFlight(OTHER)).toBe(false)
    expect(walletProofInFlight(PROVED)).toBe(true)
    hook.unmount()
  })
})
