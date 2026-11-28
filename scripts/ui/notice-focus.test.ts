// @vitest-environment happy-dom
/**
 * An announced payment notice and the dialog around it (#610): the notice
 * takes focus only after the dialog has placed its own first focus
 * (components/ui/dialog-focus marks it with data-focus-ready). One that
 * mounts with its dialog leaves first focus to the dialog and is announced.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentNotice } from '@/components/payments/PaymentNotice'

// The kit's stylesheet plays no part here, and the unit run has no PostCSS.
vi.mock('@/components/payments/payments.css', () => ({}))

const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
g.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

function renderInDialog(ready: boolean) {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.tabIndex = -1
  if (ready) dialog.setAttribute('data-focus-ready', '')
  document.body.append(dialog)
  // Nothing more specific holds focus, as after a Safari click.
  ;(document.activeElement as HTMLElement | null)?.blur()
  root = createRoot(dialog)
  act(() => {
    root!.render(
      createElement(PaymentNotice, {
        kind: 'refused',
        copy: { title: 'Too many tips in a short time', detail: 'Wait.' },
        announce: true,
      })
    )
  })
  return dialog
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('announced notice in a dialog', () => {
  it('takes focus once the dialog has placed its first focus', () => {
    const dialog = renderInDialog(true)
    const title = dialog.querySelector('h3')!
    expect(document.activeElement).toBe(title)
    act(() => vi.advanceTimersByTime(500))
    expect(dialog.querySelector('[role="status"]')!.textContent).toBe('')
  })

  it('leaves first focus to a dialog that is still opening, and is announced', () => {
    const dialog = renderInDialog(false)
    const title = dialog.querySelector('h3')!
    // Still a heading: the heading does not depend on focus.
    expect(title).not.toBeNull()
    expect(document.activeElement).not.toBe(title)
    act(() => vi.advanceTimersByTime(500))
    expect(dialog.querySelector('[role="status"]')!.textContent).toBe(
      'Too many tips in a short time. Wait.'
    )
  })
})
