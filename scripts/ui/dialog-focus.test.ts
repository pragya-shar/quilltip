// @vitest-environment happy-dom
/**
 * Where a dialog returns focus when it closes (components/ui/dialog-focus):
 * the opener, its re-rendered twin, the menu that held it, or what is left,
 * and never away from a control the page has already moved focus to. The
 * browser suites cover wrap and initial focus (e2e/helpers/dialogFocus.ts).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { dialogFocusHandlers } from '@/components/ui/dialog-focus'

type Handlers = ReturnType<typeof dialogFocusHandlers>

function dialogBox(): HTMLDivElement {
  const box = document.createElement('div')
  box.setAttribute('role', 'dialog')
  box.innerHTML = '<button>Inside</button>'
  document.body.append(box)
  return box
}

function handlersFor(box: HTMLDivElement): Handlers {
  return dialogFocusHandlers({ current: box }, { current: null }, {})
}

/** Opens with `opener` focused, removes the dialog, then closes. */
function openThenClose(
  opener: HTMLElement,
  between: () => void = () => undefined
) {
  opener.focus()
  const box = dialogBox()
  const handlers = handlersFor(box)
  handlers.onOpenAutoFocus(new Event('open', { cancelable: true }))
  box.querySelector('button')!.focus()
  between()
  box.remove()
  document.body.focus()
  const close = new Event('close', { cancelable: true })
  handlers.onCloseAutoFocus(close)
  return close
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('dialog close focus', () => {
  it('returns focus to the opener', () => {
    document.body.innerHTML = '<button id="opener">Tip article</button>'
    const opener = document.getElementById('opener')!
    const close = openThenClose(opener)
    expect(close.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(opener)
  })

  it('finds a re-rendered opener by its name', () => {
    document.body.innerHTML =
      '<section><button id="old">View your last tip</button></section>'
    const opener = document.getElementById('old')!
    openThenClose(opener, () => {
      opener.remove()
      const twin = document.createElement('button')
      twin.id = 'new'
      twin.textContent = 'View your last tip'
      document.querySelector('section')!.append(twin)
    })
    expect(document.activeElement?.id).toBe('new')
  })

  it('returns to the menu button when the opener was a menu item', () => {
    document.body.innerHTML = `
      <button id="menu-button">Photo options</button>
      <div role="menu" aria-labelledby="menu-button">
        <div role="menuitem" tabindex="-1" id="item">Upload a photo</div>
      </div>`
    const item = document.getElementById('item')!
    openThenClose(item, () => document.querySelector('[role="menu"]')!.remove())
    expect(document.activeElement?.id).toBe('menu-button')
  })

  it('falls back to a control near the opener, then to main, not the page', () => {
    document.body.innerHTML = `
      <main><section id="panel"><button id="opener">Send</button>
      <button id="other">Done</button></section></main>`
    const opener = document.getElementById('opener')!
    openThenClose(opener, () => opener.remove())
    expect(document.activeElement?.id).toBe('other')

    document.body.innerHTML =
      '<main><section><button id="only">Send</button></section></main>'
    const only = document.getElementById('only')!
    openThenClose(only, () => only.closest('section')!.remove())
    expect(document.activeElement?.tagName).toBe('MAIN')
  })

  it('leaves focus on a control the page moved it to before the close', () => {
    document.body.innerHTML =
      '<button id="opener">Connect wallet</button><button id="send">Send tip</button>'
    const opener = document.getElementById('opener')!
    opener.focus()
    const box = dialogBox()
    const handlers = handlersFor(box)
    handlers.onOpenAutoFocus(new Event('open', { cancelable: true }))
    box.remove()
    document.getElementById('send')!.focus()
    handlers.onCloseAutoFocus(new Event('close', { cancelable: true }))
    expect(document.activeElement?.id).toBe('send')
  })

  it('takes the pressed control as the opener when a click left focus on the page', () => {
    document.body.innerHTML = '<button id="opener">Tip passage</button>'
    const opener = document.getElementById('opener')!
    // Safari: a click does not focus the button.
    opener.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    document.body.focus()
    const box = dialogBox()
    const handlers = handlersFor(box)
    handlers.onOpenAutoFocus(new Event('open', { cancelable: true }))
    box.querySelector('button')!.focus()
    box.remove()
    document.body.focus()
    handlers.onCloseAutoFocus(new Event('close', { cancelable: true }))
    expect(document.activeElement).toBe(opener)
  })

  it('keeps a caller that handles close focus itself', () => {
    document.body.innerHTML =
      '<button id="opener">Remove</button><button id="named">Named</button>'
    const opener = document.getElementById('opener')!
    opener.focus()
    const box = dialogBox()
    const handlers = dialogFocusHandlers(
      { current: box },
      { current: null },
      {
        onCloseAutoFocus: (event) => {
          event.preventDefault()
          document.getElementById('named')!.focus()
        },
      }
    )
    handlers.onOpenAutoFocus(new Event('open', { cancelable: true }))
    box.remove()
    document.body.focus()
    handlers.onCloseAutoFocus(new Event('close', { cancelable: true }))
    expect(document.activeElement?.id).toBe('named')
  })
})
