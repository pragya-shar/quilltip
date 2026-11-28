// @vitest-environment happy-dom
/**
 * The balance remembers whether its account writes, so a writer keeps the
 * earnings layout through an outage. That memory is read only while the
 * figures may be shown: under another session's token, with the engine
 * still claimed for the last account, the balance never takes that
 * account's writer layout.
 */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pocket } from '../../components/pocket/Pocket'
import { writerMemory } from '../../components/pocket/writerMemory'
import { PocketSourceContext, unwiredSource } from '../../lib/pocket/source'
import { paymentsStore } from '../../lib/payments/store'
import { BalanceSourceContext } from '../../shell/balance'
import { A, B, tokenNames } from './sessionToken'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Styles play no part here, and the unit config does not load CSS.
vi.mock('../../components/pocket/pocket.css', () => ({}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/pocket',
  useRouter: () => ({ push: () => {} }),
}))

let root: Root | null = null
let detach: (() => void) | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  detach?.()
  detach = null
  window.localStorage.clear()
  paymentsStore.setAuth('loading')
  paymentsStore.setSession(null)
  writerMemory.forget()
})

const earnings = (container: ParentNode) =>
  container.querySelector(
    '[aria-labelledby="pocket-earnings"], .qt-pocket__earn'
  )

describe('the remembered writer layout', () => {
  it('stays for the account in the token during an outage', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    writerMemory.set(A, true)
    detach = paymentsStore.attachShell()
    tokenNames(A)
    paymentsStore.setAuth('signed-in')
    paymentsStore.claim(A)
    root = createRoot(el)
    await act(async () =>
      root!.render(
        h(
          BalanceSourceContext.Provider,
          {
            value: () => ({
              auth: 'signed-in' as const,
              available: null,
              status: 'unavailable' as const,
            }),
          },
          h(
            PocketSourceContext.Provider,
            { value: { ...unwiredSource, useWired: () => true } },
            h(Pocket)
          )
        )
      )
    )
    expect(earnings(el)).not.toBeNull()
  })

  it('is never taken under another session’s token', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    writerMemory.set(A, true)
    detach = paymentsStore.attachShell()
    tokenNames(B)
    paymentsStore.setAuth('signed-in')
    paymentsStore.claim(A)
    root = createRoot(el)
    await act(async () =>
      root!.render(
        h(
          BalanceSourceContext.Provider,
          {
            value: () => ({
              auth: 'signed-in' as const,
              available: null,
              status: 'unavailable' as const,
            }),
          },
          h(
            PocketSourceContext.Provider,
            { value: { ...unwiredSource, useWired: () => true } },
            h(Pocket)
          )
        )
      )
    )
    expect(earnings(el)).toBeNull()
  })
})
