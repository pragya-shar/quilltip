// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TipControl } from '@/system/components/TipControl'
import type { TipControlPhase } from '@/system/money/tip'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const three = { cents: 300, display: '$3.00', short: '$3' }
let root: Root
let host: HTMLDivElement
let sent: number

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  sent = 0
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const render = (state: TipControlPhase) =>
  act(() =>
    root.render(
      createElement(TipControl, {
        state,
        amount: three,
        amounts: [three],
        onAmountChange: () => {},
        onTip: () => {
          sent++
        },
        recipient: 'Tomás Reyes',
      })
    )
  )
const tipButton = () =>
  [...host.querySelectorAll('button')].find((b) =>
    /Tip|Try again/.test(b.textContent ?? '')
  )!
const press = () => act(() => tipButton().click())
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))

describe('the tip button that becomes Try again', () => {
  it('ignores a press for a moment after it changes', () => {
    render({ phase: 'idle' })
    render({ phase: 'sending', amount: three })
    render({ phase: 'failed', amount: three })
    expect(tipButton().textContent).toMatch(/Try again/)
    // The second tap of a double tap that sent the first.
    press()
    expect(sent).toBe(0)
    wait(600)
    press()
    expect(sent).toBe(1)
  })

  it('takes a press at once when it is drawn as Try again', () => {
    render({ phase: 'failed', amount: three })
    press()
    expect(sent).toBe(1)
  })
})
