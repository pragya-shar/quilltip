// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Sheet } from '@/system/components/Sheet'
import { pressesHeld, releasePresses } from '@/system/pressGuard'

// The real Sheet and useModal: what a surface's sheet does when it closes.
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  releasePresses()
})

const render = (node: ReactNode) => act(() => root.render(node))
const sheet = (open: boolean, title = 'Add money', body?: ReactNode) =>
  createElement(Sheet, { open, onClose: () => {}, title, children: body })
/** Lets the close's microtask run. */
const settle = () => act(async () => await Promise.resolve())
const dialog = () => document.querySelector('dialog')!
const pointerDown = (el: Element) =>
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }))

describe('a sheet that closes after a press inside it', () => {
  it('holds presses on the page, whoever closes it', async () => {
    render(sheet(true, 'Add money', createElement('button', null, 'Cancel')))
    pointerDown(dialog().querySelector('button')!)
    // Closed by its caller (a result, a Cancel handler), not by its Close.
    render(sheet(false))
    await settle()
    expect(pressesHeld()).toBe(true)
  })

  it('holds nothing after a close with no press inside it', async () => {
    render(sheet(true))
    render(sheet(false)) // a change of page, a timer
    await settle()
    expect(pressesHeld()).toBe(false)
  })

  it('holds nothing after a keyboard close', async () => {
    render(sheet(true))
    pointerDown(dialog())
    dialog().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    render(sheet(false))
    await settle()
    expect(pressesHeld()).toBe(false)
  })

  it('lets a sheet that opens after it take its own presses', async () => {
    render(sheet(true))
    pointerDown(dialog())
    render(sheet(false))
    await settle()
    expect(pressesHeld()).toBe(true)
    render(sheet(true, 'Another sheet'))
    expect(pressesHeld()).toBe(false)
  })

  it('lets a different sheet opened at once take its presses', async () => {
    const two = (first: boolean, second: boolean) =>
      createElement(
        'div',
        null,
        createElement(Sheet, {
          key: 'a',
          open: first,
          onClose: () => {},
          title: 'A',
        }),
        createElement(Sheet, {
          key: 'b',
          open: second,
          onClose: () => {},
          title: 'B',
        })
      )
    render(two(true, false))
    pointerDown(dialog())
    render(two(false, true))
    await settle()
    expect(pressesHeld()).toBe(false)
  })
})
