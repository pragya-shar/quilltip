// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@/system/components/Dialog'
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
  vi.restoreAllMocks()
})

/** Reduced motion: a modal's exit finishes at once. */
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
const dialogModal = (open: boolean, title = 'Sign out?') =>
  createElement(Dialog, {
    open,
    onClose: () => {},
    title,
    actions: createElement('button', null, 'Stay'),
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

  it('holds with reduced motion too, for a sheet and a dialog', async () => {
    reduceMotion()
    render(sheet(true, 'Add money', createElement('button', null, 'Cancel')))
    pointerDown(dialog().querySelector('button')!)
    render(sheet(false))
    await settle()
    expect(pressesHeld()).toBe(true)
    releasePresses()
    act(() => root.unmount())
    root = createRoot(host)
    render(dialogModal(true))
    pointerDown(dialog().querySelector('button')!)
    render(dialogModal(false))
    await settle()
    expect(pressesHeld()).toBe(true)
  })

  it('counts a slow press from its end', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    render(sheet(true, 'Add money', createElement('button', null, 'Cancel')))
    const button = dialog().querySelector('button')!
    pointerDown(button)
    // Held for 1.1 s, then released: the window counts from here.
    now.mockReturnValue(2100)
    button.dispatchEvent(new Event('pointerup', { bubbles: true }))
    now.mockReturnValue(2150)
    render(sheet(false))
    await settle()
    expect(pressesHeld()).toBe(true)
  })

  it('holds when a dialog over a sheet closes with it, in any tree order', async () => {
    // The page's dialog comes first in the tree, the shell's sheet after.
    const both = (open: boolean, dialogOpen: boolean) =>
      createElement(
        'div',
        null,
        createElement(Dialog, {
          key: 'd',
          open: dialogOpen,
          onClose: () => {},
          title: 'Sign out?',
          actions: createElement('button', null, 'Stay'),
        }),
        createElement(Sheet, { key: 's', open, onClose: () => {}, title: 'S' })
      )
    render(both(true, false))
    render(both(true, true))
    const top = [...document.querySelectorAll('dialog')].find((d) =>
      d.textContent?.includes('Sign out?')
    )!
    pointerDown(top.querySelector('button')!)
    render(both(false, false))
    await settle()
    expect(pressesHeld()).toBe(true)
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
