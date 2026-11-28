// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignOutWarning } from '@/shell/signOut'
import { SignOutControl } from '@/shell/signOut/SignOutControl'
import { SignOutViewerContext } from '@/shell/signOut/viewer'
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
})

// Write's warning, as it would be: drafts on this device for this writer.
const drafts: SignOutWarning = {
  name: 'device drafts',
  check: async ({ userId }) =>
    userId === 'writer-1' ? '2 drafts are only on this device.' : null,
}

function control(
  signOut: () => Promise<void>,
  viewer?: () => Promise<string | null>
) {
  const node: ReactNode = createElement(SignOutControl, {
    signOut,
    warnings: [drafts],
    limitMs: 100,
  })
  return viewer
    ? createElement(SignOutViewerContext.Provider, { value: viewer }, node)
    : node
}
const signOutButton = () =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Sign out'
  )!
async function pressSignOut() {
  await act(async () => {
    signOutButton().click()
    await new Promise((done) => setTimeout(done, 150))
  })
}

describe('SignOutControl', () => {
  it("gives the warnings the signed-in user's id from the shell", async () => {
    const signOut = vi.fn(async () => {})
    act(() => root.render(control(signOut, async () => 'writer-1')))
    await pressSignOut()
    expect(document.body.textContent).toContain(
      '2 drafts are only on this device.'
    )
    expect(signOut).not.toHaveBeenCalled()
  })

  it('asks with no id when none is known, and signs out', async () => {
    const signOut = vi.fn(async () => {})
    act(() => root.render(control(signOut)))
    await pressSignOut()
    expect(document.body.textContent).not.toContain('only on this device')
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('never waits for an id that does not come', async () => {
    const signOut = vi.fn(async () => {})
    act(() => root.render(control(signOut, () => new Promise(() => {}))))
    await pressSignOut()
    await act(async () => {
      await new Promise((done) => setTimeout(done, 150))
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
