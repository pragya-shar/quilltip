// @vitest-environment happy-dom
import { act, createElement, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@/system/components/Dialog'
import { Sheet } from '@/system/components/Sheet'
import { PRESS_HOLD_MS, pressesHeld, resetPresses } from '@/system/pressGuard'

// The real Sheet and Dialog with useModal and the page-wide click hold:
// what a surface gets when it deletes its own guard.
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let page: HTMLButtonElement
let pagePresses: number
let time = 1000

beforeEach(() => {
  time = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // The tip button under the sheet.
  page = document.createElement('button')
  page.textContent = 'Tip Tomás $1'
  pagePresses = 0
  page.addEventListener('click', () => pagePresses++)
  document.body.appendChild(page)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  page.remove()
  resetPresses()
  vi.restoreAllMocks()
})

const later = (ms: number) => {
  time += ms
}
/** A pointer click (detail 1) or a keyboard one (detail 0). */
const click = (el: Element, detail = 1) =>
  act(() => {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, detail })
    )
  })
const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent) === name
  )!
const reduceMotion = () =>
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  )

/** A sheet and a dialog that close themselves from their own controls. */
function Modals({ kind }: { kind: 'sheet' | 'dialog' }) {
  const [open, setOpen] = useState(true)
  const close = () => setOpen(false)
  const actions = [
    createElement('button', { key: 'c', onClick: close }, 'Cancel'),
    createElement('button', { key: 'o', onClick: close }, 'Add $10'),
  ]
  return kind === 'sheet'
    ? createElement(Sheet, {
        open,
        onClose: close,
        title: 'Add money',
        actions,
      })
    : createElement(Dialog, {
        open,
        onClose: close,
        title: 'Sign out?',
        actions,
      })
}
const render = (node: ReactNode) => act(() => root.render(node))

describe('a double tap that closes a modal', () => {
  for (const motion of ['full', 'reduced'] as const)
    for (const [kind, control] of [
      ['sheet', 'Close'],
      ['sheet', 'Cancel'],
      ['sheet', 'Add $10'],
      ['sheet', 'scrim'],
      ['dialog', 'Cancel'],
      ['dialog', 'Add $10'],
      ['dialog', 'scrim'],
    ] as const)
      it(`on the ${kind}'s ${control} (${motion} motion) never reaches the page`, () => {
        if (motion === 'reduced') reduceMotion()
        render(createElement(Modals, { kind }))
        const dialog = document.querySelector('dialog')!
        if (control === 'scrim') {
          act(() => {
            dialog.dispatchEvent(new Event('pointerdown', { bubbles: true }))
          })
          click(dialog)
        } else click(button(control))
        expect(
          document.querySelector('dialog[data-closing], dialog[open]') ===
            null ||
            !dialog.open ||
            dialog.dataset.closing !== undefined
        ).toBe(true)
        later(80)
        click(page) // the second tap
        expect(pagePresses).toBe(0)
      })
})

describe('the hold', () => {
  it('holds the lower sheet of a stack after the top one closes', () => {
    const view = (top: boolean) =>
      createElement(
        'div',
        null,
        createElement(Sheet, {
          key: 'lower',
          open: true,
          onClose: () => {},
          title: 'Lower',
          actions: createElement('button', null, 'Lower action'),
        }),
        createElement(Sheet, {
          key: 'top',
          open: top,
          onClose: () => {},
          title: 'Top',
        })
      )
    render(view(false))
    later(50)
    render(view(true))
    later(50)
    render(view(false))
    let lower = 0
    button('Lower action').addEventListener('click', () => lower++)
    later(100)
    click(button('Lower action'))
    expect(lower).toBe(0)
    later(PRESS_HOLD_MS)
    click(button('Lower action'))
    expect(lower).toBe(1)
  })

  it('holds the page until 400 ms after a sheet that opened and closed by script', () => {
    const two = (a: boolean, b: boolean) =>
      createElement(
        'div',
        null,
        createElement(Sheet, {
          key: 'a',
          open: a,
          onClose: () => {},
          title: 'A',
        }),
        createElement(Sheet, {
          key: 'b',
          open: b,
          onClose: () => {},
          title: 'B',
        })
      )
    render(two(true, false))
    render(two(false, false)) // A closes at 1000
    later(50)
    render(two(false, true)) // B opens
    later(50)
    render(two(false, false)) // B closes by script at 1100
    later(350) // 1450: past A's hold, inside B's
    click(page)
    expect(pagePresses).toBe(0)
    later(51) // 1501
    click(page)
    expect(pagePresses).toBe(1)
  })

  it('lets a sheet opened in the same commit take its press, not the page', () => {
    const two = (a: boolean, b: boolean) =>
      createElement(
        'div',
        null,
        createElement(Sheet, {
          key: 'a',
          open: a,
          onClose: () => {},
          title: 'A',
        }),
        createElement(Sheet, {
          key: 'b',
          open: b,
          onClose: () => {},
          title: 'B',
          actions: createElement('button', null, 'B action'),
        })
      )
    render(two(true, false))
    later(10)
    render(two(false, true))
    let b = 0
    button('B action').addEventListener('click', () => b++)
    later(10)
    click(button('B action'))
    expect(b).toBe(1)
    click(page)
    expect(pagePresses).toBe(0)
  })

  it('holds from the moment a modal unmounts, before effects flush', async () => {
    // A route change or an error boundary removes an open sheet in a normal
    // (not sync) render: the click is dispatched the moment the dialog
    // leaves the DOM, before React's passive effects run.
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    env.IS_REACT_ACT_ENVIRONMENT = false
    const settle = () => new Promise((done) => setTimeout(done, 30))
    try {
      root.render(createElement(Modals, { kind: 'sheet' }))
      await settle()
      expect(document.querySelector('dialog[open]')).not.toBeNull()
      resetPresses()
      later(PRESS_HOLD_MS + 1)
      let clickedAtRemoval = false
      const observer = new MutationObserver(() => {
        if (document.querySelector('dialog') || clickedAtRemoval) return
        clickedAtRemoval = true
        page.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            detail: 1,
          })
        )
      })
      observer.observe(host, { childList: true, subtree: true })
      root.render(null)
      await settle()
      observer.disconnect()
      expect(clickedAtRemoval).toBe(true)
      expect(pagePresses).toBe(0)
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true
    }
  })

  it('lets keyboard and assistive clicks through, and a key starts nothing', () => {
    render(createElement(Modals, { kind: 'sheet' }))
    const dialog = document.querySelector('dialog')!
    act(() => {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', bubbles: true })
      )
    })
    expect(pressesHeld()).toBe(false)
    click(button('Cancel'))
    click(page, 0) // Enter, Space or a screen reader
    expect(pagePresses).toBe(1)
  })

  it('ends 400 ms after the last close, anywhere on the page', () => {
    render(createElement(Modals, { kind: 'dialog' }))
    click(button('Cancel'))
    later(PRESS_HOLD_MS - 1)
    click(page)
    expect(pagePresses).toBe(0)
    later(2)
    click(page)
    expect(pagePresses).toBe(1)
  })

  it('extends with a second close 300 ms later', () => {
    const one = (open: boolean, key: string) =>
      createElement(Sheet, { key, open, onClose: () => {}, title: key })
    render(one(true, 'first'))
    render(one(false, 'first'))
    later(300)
    render(one(true, 'second'))
    render(one(false, 'second'))
    later(PRESS_HOLD_MS - 1)
    click(page)
    expect(pagePresses).toBe(0)
    later(2)
    click(page)
    expect(pagePresses).toBe(1)
  })
})
