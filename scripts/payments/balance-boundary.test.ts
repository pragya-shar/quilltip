// @vitest-environment happy-dom
/**
 * The payments boundary keeps the page: when the engine throws on its first
 * render or on a later one, the page beside it still renders
 * (`components/payments/PaymentsBoundary.tsx`, mounted by `PaymentsShell`
 * beside the page, never around it).
 */
import { act, createElement as h, Fragment, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaymentsBoundary } from '../../components/payments/PaymentsBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

const Page = () => h('p', { 'data-testid': 'page' }, 'Story time.')

function layout(engine: ReactNode, onError: (e: unknown) => void) {
  return h(Fragment, null, h(Page), h(PaymentsBoundary, { onError }, engine))
}

let setBroken: (broken: boolean) => void = () => {}
function LaterThrower() {
  const [broken, set] = useState(false)
  setBroken = set
  if (broken)
    throw new Error("Could not find public function for 'balance:session'")
  return h('span', { 'data-testid': 'engine' }, 'engine')
}
function FirstThrower(): ReactNode {
  throw new Error('Server Error')
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('payments boundary', () => {
  it('keeps the page when the engine throws on its first render', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = document.createElement('div')
    document.body.append(root)
    const onError = vi.fn()
    await act(async () => {
      createRoot(root).render(layout(h(FirstThrower), onError))
    })
    expect(root.querySelector('[data-testid="page"]')?.textContent).toBe(
      'Story time.'
    )
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('keeps the page when the engine throws on a later render', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = document.createElement('div')
    document.body.append(root)
    const onError = vi.fn()
    await act(async () => {
      createRoot(root).render(layout(h(LaterThrower), onError))
    })
    expect(root.querySelector('[data-testid="engine"]')).not.toBeNull()
    await act(async () => setBroken(true))
    expect(root.querySelector('[data-testid="page"]')?.textContent).toBe(
      'Story time.'
    )
    expect(root.querySelector('[data-testid="engine"]')).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
