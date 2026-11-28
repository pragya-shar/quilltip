// @vitest-environment happy-dom
import { createElement, Suspense, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TipCodeBoundary,
  retryableLazy,
} from '../../components/tipping/v2/TipCodeBoundary'
import { TIP_CODE_FAILED } from '../../lib/copy/tip-flow'

// React reports caught render errors; they are the case under test.
vi.spyOn(console, 'error').mockImplementation(() => {})
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('tip form code that fails to load (#669)', () => {
  it('keeps the error inside the dialog and loads again on retry', async () => {
    let online = false
    const loader = retryableLazy(() =>
      online
        ? Promise.resolve({
            default: () => createElement('p', null, 'Tip form'),
          })
        : Promise.reject(
            new Error('Failed to fetch dynamically imported module')
          )
    )
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        createElement(
          'article',
          null,
          createElement('p', null, 'Article text'),
          createElement(TipCodeBoundary, {
            onRetry: loader.retry,
            children: () =>
              createElement(
                Suspense,
                { fallback: createElement('p', null, 'Loading') },
                createElement(loader.Component)
              ),
          })
        )
      )
    })
    await settle()

    expect(host.textContent).toContain('Article text')
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain(TIP_CODE_FAILED.title)
    expect(alert?.textContent).toContain(TIP_CODE_FAILED.detail)

    online = true
    const retry = host.querySelector('button')!
    expect(retry.textContent).toBe(TIP_CODE_FAILED.retry)
    await act(async () => retry.click())
    await settle()

    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).toContain('Tip form')
    expect(host.textContent).toContain('Article text')
    await act(async () => root.unmount())
  })

  it('stands in for the tip button on the page with one line and a retry', async () => {
    let online = false
    const loader = retryableLazy(() =>
      online
        ? Promise.resolve({
            default: () => createElement('button', null, 'Tip article'),
          })
        : Promise.reject(
            new Error('Failed to fetch dynamically imported module')
          )
    )
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(
          'article',
          null,
          createElement('p', null, 'Article text'),
          createElement(TipCodeBoundary, {
            variant: 'inline',
            onRetry: loader.retry,
            children: () =>
              createElement(
                Suspense,
                { fallback: null },
                createElement(loader.Component)
              ),
          })
        )
      )
    })
    await settle()
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.tagName).toBe('P')
    expect(alert?.textContent).toContain(TIP_CODE_FAILED.inline)
    expect(host.textContent).toContain('Article text')
    online = true
    const retry = host.querySelector('button')!
    retry.focus()
    await act(async () => retry.click())
    await settle()
    await settle()
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).toContain('Tip article')
    // Focus moves to the control that replaced Try again, not to the body.
    expect(document.activeElement?.textContent).toBe('Tip article')
    await act(async () => root.unmount())
  })

  it('does not take focus back after the reader moved on while the code loads', async () => {
    let online = false
    let release: () => void = () => {}
    const loader = retryableLazy(() =>
      online
        ? new Promise<{ default: () => ReturnType<typeof createElement> }>(
            (resolve) => {
              release = () =>
                resolve({
                  default: () => createElement('button', null, 'Tip article'),
                })
            }
          )
        : Promise.reject(
            new Error('Failed to fetch dynamically imported module')
          )
    )
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(
          'article',
          null,
          createElement('a', { href: '#elsewhere' }, 'A link in the article'),
          createElement(TipCodeBoundary, {
            variant: 'inline',
            onRetry: loader.retry,
            children: () =>
              createElement(
                Suspense,
                { fallback: createElement('p', null, 'Loading') },
                createElement(loader.Component)
              ),
          })
        )
      )
    })
    await settle()
    online = true
    const retry = host.querySelector('button')!
    retry.focus()
    await act(async () => retry.click())
    await settle()
    // The reader moves on while the code is still loading.
    const link = host.querySelector('a')!
    link.focus()
    await act(async () => release())
    await settle()
    await settle()
    expect(host.textContent).toContain('Tip article')
    expect(document.activeElement).toBe(link)
    await act(async () => root.unmount())
  })

  it('a plain lazy import stays rejected, which is why retry makes a new one', async () => {
    let calls = 0
    const loader = retryableLazy(() => {
      calls += 1
      return Promise.reject(new Error('offline'))
    })
    const first = loader.Component
    loader.retry()
    expect(loader.Component).not.toBe(first)
    expect(calls).toBe(0)
  })
})
