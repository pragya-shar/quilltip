// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useOwnTips } from '../../hooks/payments/useOwnTips'
import { money } from '../../lib/payments/money'
import { paymentsStore } from '../../lib/payments/store'
import type { OwnTipsView } from '../../lib/payments/types'
import { ownTipsViewOf } from '../../lib/payments/views'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// A reader's own tips on one article: the server's answer as the layer
// shows it, and what a screen reads before the engine has answered.

const LINE = { text: 'Leave it overnight.', startOffset: 40, endOffset: 59 }

afterEach(() => {
  paymentsStore.set({ ownTips: {} })
  paymentsStore.setAuth('loading')
})

describe("a reader's own tips on an article", () => {
  it('keeps each passage and writes each amount as the layer does', () => {
    expect(
      ownTipsViewOf({
        complete: false,
        tips: [
          {
            requestId: 'r1',
            passage: LINE,
            amountCents: 100,
            state: 'on-chain',
            at: 5,
          },
          {
            requestId: null,
            passage: null,
            amountCents: 25,
            state: 'accepted',
            at: 4,
          },
        ],
      })
    ).toEqual({
      status: 'ready',
      complete: false,
      tips: [
        {
          requestId: 'r1',
          passage: LINE,
          amount: money(100),
          state: 'on-chain',
          at: 5,
        },
        {
          requestId: null,
          passage: null,
          amount: money(25),
          state: 'accepted',
          at: 4,
        },
      ],
    })
  })

  it('reads loading, then signed out or the engine’s answer', async () => {
    const seen: OwnTipsView[] = []
    function Probe() {
      seen.push(useOwnTips('article-1'))
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(h(Probe)))
    expect(seen.at(-1)).toEqual({ status: 'loading', tips: [], complete: true })
    await act(async () => paymentsStore.setAuth('signed-out'))
    expect(seen.at(-1)?.status).toBe('signed-out')
    await act(async () => {
      paymentsStore.setAuth('signed-in')
      paymentsStore.claim('reader-1')
      paymentsStore.set({
        ownTips: {
          'article-1': { status: 'ready', tips: [], complete: true },
        },
      })
    })
    expect(seen.at(-1)?.status).toBe('ready')
    // Another reader's answer is not kept across a change of who is here.
    await act(async () => paymentsStore.setAuth('signed-out'))
    expect(seen.at(-1)?.status).toBe('signed-out')
    await act(async () => root.unmount())
  })
})
